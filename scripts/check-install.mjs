#!/usr/bin/env node
/** Read-only verification. Import the installed server entry without starting DSH. */
import { readFile, realpath } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PLUGIN = '@sasimoreyang-ai/dsh-llm-agent-hint'

export async function checkInstallation(profileDir) {
  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok, detail })
  try {
    const profile = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'))
    check('profile bundle', profile.dsh?.profile?.bundles?.includes(PLUGIN) === true,
      'The installed package must also be listed in dsh.profile.bundles')
    const packageDir = await realpath(join(profileDir, 'node_modules', PLUGIN))
    const pkg = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
    check('package identity', pkg.name === PLUGIN, `version=${pkg.version}`)
    // A fresh process resolves peers from the actual installed artifact, not
    // from this verifier's checkout. This catches the symlink/peer failure.
    const entry = pathToFileURL(join(packageDir, pkg.main ?? 'lib/types/index.js')).href
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e',
      `const m=await import(${JSON.stringify(entry)});if(m.name!=='llm-agent-hint'||typeof m.apply!=='function')throw Error('Invalid server entry')`],
    { cwd: profileDir, encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 })
    check('server entry imports', probe.status === 0 && probe.error === undefined,
      probe.status === 0 ? 'Server import only; no inference or DSH activation'
        : String(probe.error?.message ?? probe.stderr).slice(0, 4000))
    const client = await readFile(join(packageDir, 'lib/client.js'), 'utf8')
    check('browser bundle present', client.includes('__ModuleLoader__'),
      'Presence only; live browser activation is a separate integration check')
    const patch = await readFile(join(packageDir, 'cordis.patch.yml'), 'utf8')
    check('route patch present', patch.includes('llm-agent-hint'), 'cordis.patch.yml')
  } catch (error) {
    check('installed layout readable', false, String(error.message))
  }
  return checks
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const index = process.argv.indexOf('--profile-dir')
  if (index < 0 || !process.argv[index + 1]) {
    console.error('Usage: node scripts/check-install.mjs --profile-dir <absolute-profile-directory>')
    process.exitCode = 2
  } else {
    const checks = await checkInstallation(resolve(process.argv[index + 1]))
    for (const row of checks) console.log(`${row.ok ? 'PASS' : 'FAIL'} ${row.name}: ${row.detail}`)
    process.exitCode = checks.every(row => row.ok) ? 0 : 1
  }
}
