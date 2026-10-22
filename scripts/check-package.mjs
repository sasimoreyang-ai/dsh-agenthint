import assert from 'node:assert/strict'
import { readFile, access, readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { posix, join } from 'node:path'

const pkg = JSON.parse(await readFile('package.json', 'utf8'))
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
assert.equal(lock.version, pkg.version, 'lockfile version mismatch')
assert.equal(lock.packages[''].version, pkg.version, 'lockfile package version mismatch')

// Removed artefacts must not come back through a stale build directory.
for (const path of ['lib/types/inherit.js', 'lib/types/inherit.d.ts']) {
  await assert.rejects(access(path), { code: 'ENOENT' })
}

// The core is inlined at build time, never resolved as a package at runtime.
// Declaring it as a runtime dependency would make pnpm/git installs look for an
// unpublished version, and `bundleDependencies` silently drops it when the
// packer runs without node_modules.
assert.equal(pkg.dependencies?.['@sasimoreyang-ai/agenthint-core'], undefined,
  'core must not be a runtime dependency; it is vendored into lib/vendor')
assert.equal(pkg.bundleDependencies, undefined,
  'bundleDependencies is unreliable across package managers; vendor instead')

const npm = process.env.npm_execpath
assert.ok(npm, 'Run this check through npm run check')
const pack = JSON.parse(execFileSync(process.execPath,
  [npm, 'pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' }))[0]
const files = new Set(pack.files.map(file => file.path))

for (const path of [
  'lib/types/index.js', 'lib/types/index.d.ts', 'lib/types/chat-adapter.js', 'lib/types/adapter.js',
  'lib/client.js', 'lib/types/client/index.d.ts', 'cordis.patch.yml',
  'docs/transport.md', 'docs/endpoint-inheritance.md', 'docs/reliability.md',
]) assert.ok(files.has(path), `Missing packaged asset: ${path}`)

// Vendored core: entry, declarations, optional HTTP sub-entry and the state
// machine. A missing file here means the plugin cannot load at runtime.
const VENDOR = 'lib/vendor/agenthint-core'
for (const path of [
  `${VENDOR}/index.js`, `${VENDOR}/index.d.ts`,
  `${VENDOR}/coordinator.js`, `${VENDOR}/coordinator.d.ts`,
  `${VENDOR}/hint.js`, `${VENDOR}/errors.js`, `${VENDOR}/transport.js`, `${VENDOR}/types.js`,
  `${VENDOR}/http/index.js`, `${VENDOR}/http/index.d.ts`,
]) assert.ok(files.has(path), `Missing vendored core asset: ${path}`)

// Licence assets for the inlined component travel with it.
assert.ok(files.has(`${VENDOR}/LICENSE`), 'Missing vendored core LICENSE')
assert.ok(files.has('LICENSE'), 'Missing package LICENSE')

// Every emitted module outside the vendor tree must use a relative specifier.
// A leftover package import only fails on a machine without the workspace link,
// which is exactly the install path users take.
async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full))
    else out.push(full)
  }
  return out
}
const SPECIFIER = /(?:from|import)\s*\(?\s*['"]@sasimoreyang-ai\/agenthint-core/
for (const file of await walk('lib')) {
  if (!file.endsWith('.js') && !file.endsWith('.d.ts')) continue
  if (file.split(/[\\/]/).includes('vendor')) continue
  const offending = (await readFile(file, 'utf8')).split('\n')
    .filter(line => SPECIFIER.test(line) && !line.trim().startsWith('*') && !line.trim().startsWith('//'))
  assert.equal(offending.length, 0, `Dangling core import in ${file}: ${offending[0]?.trim()}`)
}

for (const path of ['README.md', 'README.en.md', 'README.zh.md', 'docs/transport.md',
  'docs/endpoint-inheritance.md', 'docs/reliability.md', 'docs/sdk.md',
  'docs/adapter-contract.md', 'docs/migration.md', 'docs/integration-baseline.md',
  'docs/acceptance-matrix.md']) {
  const content = await readFile(path, 'utf8')
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const link = match[1]
    if (/^(https?:|#)/.test(link)) continue
    const target = posix.normalize(posix.join(posix.dirname(path), link.split('#')[0]))
    await access(new URL(target, pathToFileURL(process.cwd() + '/')))
    assert.ok(files.has(target), `Documentation link missing from package: ${target}`)
  }
}

console.log(`Package ${pkg.version}: ${files.size} files, exports, vendored core, licence assets, `
  + 'current docs and lock metadata verified')
