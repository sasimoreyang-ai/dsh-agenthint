/**
 * Inline the compiled AgentHint Core into this package's own `lib/vendor`.
 *
 * Why this exists: `bundleDependencies` only copies a dependency that is
 * physically present in `node_modules` at pack time. A clean clone (CI, or a
 * `pnpm add git+…` install) has no such directory, so the bundled copy silently
 * disappears and the plugin fails at runtime with MODULE_NOT_FOUND.
 *
 * Vendoring the compiled output into our own tree removes the package reference
 * from the runtime graph entirely, so the artifact resolves the same way under
 * npm, pnpm and the DSH CLI, from a tarball or from Git.
 *
 * Source still imports `@sasimoreyang-ai/agenthint-core` for type checking and
 * local development; only the emitted JavaScript and declarations are rewritten.
 */
import { cp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const coreLib = join(root, 'packages', 'agenthint-core', 'lib')
const outRoot = join(root, 'lib')
const vendorDir = join(outRoot, 'vendor', 'agenthint-core')

/** Import specifier prefix used in source. */
const PKG = '@sasimoreyang-ai/agenthint-core'
/** Subpath that maps to the optional HTTP transport. */
const HTTP_SUBPATH = `${PKG}/http`

async function exists(path) {
  try { await stat(path); return true } catch { return false }
}

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full))
    else out.push(full)
  }
  return out
}

/** Rewrite one emitted file's core specifiers to a relative vendor path. */
async function rewrite(file) {
  const source = await readFile(file, 'utf8')
  if (!source.includes(PKG)) return false
  const depth = relative(dirname(file), vendorDir).split(sep).join('/')
  const base = depth.length === 0 ? '.' : depth
  // Longest specifier first so `/http` is not shadowed by the bare package.
  const rewritten = source
    .split(`'${HTTP_SUBPATH}'`).join(`'${base}/http/index.js'`)
    .split(`"${HTTP_SUBPATH}"`).join(`"${base}/http/index.js"`)
    .split(`'${PKG}'`).join(`'${base}/index.js'`)
    .split(`"${PKG}"`).join(`"${base}/index.js"`)
  if (rewritten === source) return false
  await writeFile(file, rewritten)
  return true
}

if (!await exists(coreLib)) {
  console.error('vendor-core: packages/agenthint-core/lib is missing; build the core package first')
  process.exit(1)
}
if (!await exists(outRoot)) {
  console.error('vendor-core: lib is missing; run tsc first')
  process.exit(1)
}

await rm(vendorDir, { recursive: true, force: true })
await cp(coreLib, vendorDir, { recursive: true })

// Drop the core's own build metadata; it is not part of our artifact contract.
await rm(join(vendorDir, 'core.tsbuildinfo'), { force: true })

// Licence assets must travel with the inlined code, not just the source package.
const coreRoot = join(root, 'packages', 'agenthint-core')
for (const asset of ['LICENSE', 'NOTICE']) {
  const from = join(coreRoot, asset)
  if (await exists(from)) await cp(from, join(vendorDir, asset))
}

let rewritten = 0
for (const file of await walk(outRoot)) {
  if (file.startsWith(vendorDir + sep)) continue
  if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue
  if (await rewrite(file)) rewritten++
}

const vendored = await walk(vendorDir)
console.log(`vendor-core: ${vendored.length} files inlined, ${rewritten} import sites rewritten`)
