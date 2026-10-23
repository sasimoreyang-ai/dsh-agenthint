#!/usr/bin/env node
/**
 * Post-install verification for the AgentHint plugin.
 *
 * Exists because two failure modes were hit in practice and both are silent:
 *
 * 1. **pnpm caches by package name + version.** Installing a rebuilt artifact
 *    that keeps the same version reports `downloaded 0` and leaves the old
 *    build in place.
 * 2. **`rm -rf` + `dsh plugin add` drops the bundle entry.** The plugin stays
 *    in `dependencies` but leaves `dsh.profile.bundles`, so DSH never loads it
 *    and the only symptom is `no adapter registered for provider
 *    "deepseek-agent-hint"`.
 *
 * Run on the target host:
 *   node scripts/check-install.mjs --profile verify [--expect-digest <hex16>]
 *
 * Exit code 0 only when every check passes.
 */

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const PLUGIN = '@sasimoreyang-ai/dsh-llm-agent-hint'

/** Minimal argument parsing; no dependency on a CLI library. */
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i += 1 }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const profile = args['profile']
const dshHome = process.env['DSH_HOME']

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`  ${mark}  ${name}${detail === undefined ? '' : `  (${detail})`}`)
}

if (profile === undefined || typeof profile !== 'string') {
  console.error('check-install: --profile <name> is required')
  process.exit(2)
}
if (dshHome === undefined) {
  console.error('check-install: DSH_HOME is not set')
  process.exit(2)
}

const profileDir = join(dshHome, 'profiles', profile)
const packageDir = join(profileDir, 'node_modules', PLUGIN)

console.log(`check-install: profile=${profile}`)
console.log(`  DSH_HOME=${dshHome}`)

// ---- 1. the package is installed --------------------------------------
if (!existsSync(join(packageDir, 'package.json'))) {
  check('package installed', false, packageDir)
  console.log('\ncheck-install: aborting, nothing else can be verified')
  process.exit(1)
}
check('package installed', true, packageDir)

const pkg = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
check('package name', pkg.name === PLUGIN, pkg.name)
console.log(`  INFO  version: ${pkg.version}`)

// ---- 2. the bundle entry exists ---------------------------------------
// This is the check that catches the `rm -rf` failure mode.
const profilePkgPath = join(profileDir, 'package.json')
if (!existsSync(profilePkgPath)) {
  check('profile package.json', false, profilePkgPath)
} else {
  const profilePkg = JSON.parse(await readFile(profilePkgPath, 'utf8'))
  const bundles = profilePkg?.dsh?.profile?.bundles ?? []
  const inBundles = bundles.includes(PLUGIN)
  check('listed in dsh.profile.bundles', inBundles, inBundles ? undefined : `bundles=${JSON.stringify(bundles)}`)
  if (!inBundles) {
    console.log(`  HINT  repair with: dsh plugin --profile ${profile} add <artifact>`)
    console.log('  HINT  or add the entry to dsh.profile.bundles manually, before @deepseek-ai/dsh-web-app')
  }
  const inDeps = Object.keys(profilePkg?.dependencies ?? {}).includes(PLUGIN)
  check('listed in dependencies', inDeps, inDeps ? undefined : 'not in dependencies')
}

// ---- 3. the plugin declares its own cordis patch ---------------------
const patchPath = join(packageDir, 'cordis.patch.yml')
const hasPatch = existsSync(patchPath)
check('ships cordis.patch.yml', hasPatch, hasPatch ? undefined : 'zero-config install will not register the route')
if (hasPatch) {
  const patch = await readFile(patchPath, 'utf8')
  check('patch inserts llm-agent-hint', patch.includes('llm-agent-hint'))
}

// ---- 4. artifact identity --------------------------------------------
// Hash the file *contents* in sorted order. Hashing the paths too would make
// two identical installs look different purely because their directories
// differ.
const libDir = join(packageDir, 'lib')
if (!existsSync(libDir)) {
  check('lib directory', false, libDir)
} else {
  async function walk(dir, prefix = '') {
    const entries = await readdir(dir, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) files.push(...await walk(join(dir, entry.name), rel))
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) files.push(rel)
    }
    return files
  }
  const files = (await walk(libDir)).sort()
  const hash = createHash('sha256')
  for (const rel of files) hash.update(await readFile(join(libDir, rel)))
  const digest = hash.digest('hex')
  console.log(`  INFO  lib files: ${files.length}`)
  console.log(`  INFO  content digest: ${digest.slice(0, 16)}…`)
  if (typeof args['expect-digest'] === 'string') {
    check('content digest matches expected', digest.startsWith(args['expect-digest']), args['expect-digest'])
  }

  // The vendored core is optional: only the core-split builds ship it.
  const vendorDir = join(libDir, 'vendor', 'agenthint-core')
  if (existsSync(vendorDir)) {
    const vendorFiles = await walk(vendorDir)
    check('vendored core present', vendorFiles.length > 0, `${vendorFiles.length} files`)
    // A core-split build that forgot to vendor its core fails at import time
    // on the target host, not here — so check for the entry module.
    check('vendored core entry', existsSync(join(vendorDir, 'index.js')), 'index.js')
  } else {
    console.log('  INFO  no vendored core (main-style build; self-contained)')
  }

  // A dangling package import means the core was split but never vendored.
  let dangling = false
  for (const rel of files) {
    const text = await readFile(join(libDir, rel), 'utf8')
    if (text.includes(`from '@sasimoreyang-ai/agenthint-core'`)) { dangling = true; break }
  }
  check('no dangling agenthint-core import', !dangling, dangling ? 'vendoring did not rewrite every import' : undefined)
}

// ---- 5. runtime dependencies -----------------------------------------
const runtimeDeps = Object.keys(pkg.dependencies ?? {})
check('no runtime dependency on agenthint-core',
  !runtimeDeps.includes('@sasimoreyang-ai/agenthint-core'),
  runtimeDeps.join(', ') || 'none')
check('no bundleDependencies trap',
  pkg.bundleDependencies === undefined,
  pkg.bundleDependencies === undefined ? undefined : JSON.stringify(pkg.bundleDependencies))

// ---- summary ---------------------------------------------------------
const failed = results.filter(r => !r.ok)
console.log('')
if (failed.length === 0) {
  console.log(`check-install: ${results.length} checks passed`)
  process.exit(0)
}
console.log(`check-install: ${failed.length} of ${results.length} checks FAILED`)
for (const item of failed) console.log(`  FAILED: ${item.name}${item.detail ? ` (${item.detail})` : ''}`)
process.exit(1)
