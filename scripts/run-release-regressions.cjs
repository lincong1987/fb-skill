#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')

const ROOT = path.resolve(__dirname, '..')
const NODES = {
  node18: 'C:/Users/linyifan/AppData/Roaming/nvm/v18.20.8/node.exe',
  node20: path.join(ROOT, '.validation-output/release-validation/node20/runtime/node-v20.19.6-win-x64/node.exe'),
  node24: 'C:/Users/linyifan/AppData/Roaming/nvm/v24.16.0/node.exe'
}
const SOURCE_ROOT = 'D:/projects/SOL07_FMKS_docus/MINE_CODE/gov/trunk/mine-gov-ui'
const SCREEN_ROOT = 'D:/projects/T20240246-GMRHCP/T20240246-GMRHCP-Code/branches/V3.51-20261116/mew-manage-ui'

function run(name, outputId, withSources) {
  F.assertSlug(outputId)
  if (!NODES[name]) throw new Error('Choose node18, node20 or node24')
  const node = NODES[name]
  F.assertNoLinks(node)
  const directory = path.join(ROOT, '.validation-output/release-validation', outputId, name)
  F.ensureDir(path.dirname(directory))
  fs.mkdirSync(directory)
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('FB_')) delete env[key]
  if (withSources) {
    env.FBJS_DEPS_ROOT = SOURCE_ROOT
    env.FB_SCREEN_DEPS_ROOT = SCREEN_ROOT
  }
  env.FB_JAVA_JAVAC = 'C:/Program Files/Eclipse Adoptium/jdk-17.0.16.8-hotspot/bin/javac.exe'
  env.FB_JAVA_JAVA = 'C:/Program Files/Eclipse Adoptium/jdk-17.0.16.8-hotspot/bin/java.exe'
  const version = spawnSync(node, ['--version'], { encoding: 'utf8', shell: false, timeout: 30000 })
  if (version.status !== 0) throw new Error('Node did not start: ' + version.stderr)
  const startedAt = F.nowIso().atLocal
  const result = spawnSync(node, [path.join(ROOT, 'scripts/run-tests.cjs')], {
    cwd: ROOT, env, encoding: 'utf8', shell: false, timeout: 600000, maxBuffer: 16 * 1024 * 1024
  })
  const log = path.join(directory, 'tests.log')
  F.writeTextExclusive(log, String(result.stdout || '') + String(result.stderr || ''))
  const raw = String(result.stdout || '') + String(result.stderr || '')
  const count = label => {
    const matches = [...raw.matchAll(new RegExp('(?:^|\\n)(?:#|ℹ)\\s+' + label + '\\s+(\\d+)', 'g'))]
    return matches.length ? Number(matches[matches.length - 1][1]) : null
  }
  const counts = Object.fromEntries(['tests', 'pass', 'fail', 'skipped', 'cancelled'].map(label => [label, count(label)]))
  const body = { nature: 'same-source-local-regression-not-fullstack-acceptance', name,
    version: version.stdout.trim(), node, startedAt, finishedAt: F.nowIso().atLocal,
    withExplicitSourceRoots: !!withSources, parserRoot: env.FBJS_DEPS_ROOT || null,
    screenRoot: env.FB_SCREEN_DEPS_ROOT || null,
    java: 'Synthetic JDK compile only; legacy reference fixture is not loaded',
    databaseExecution: false, log, logSha256: F.sha256Hex(fs.readFileSync(log)),
    exitCode: result.status, signal: result.signal, error: result.error ? result.error.message : null,
    counts }
  body.status = result.status === 0 && counts.tests > 0 && counts.fail === 0 && counts.cancelled === 0 ? 'pass-with-explicit-skips' : 'fail'
  body.hash = F.hashObject(body)
  F.writeJsonImmutable(path.join(directory, 'report.json'), body)
  process.stdout.write(JSON.stringify(body, null, 2) + '\n')
  return body
}

if (require.main === module) {
  try {
    const [name, outputId, mode] = process.argv.slice(2)
    if (mode !== 'with-source' && mode !== 'no-extra-source') throw new Error('Choose with-source or no-extra-source')
    const result = run(name, outputId, mode === 'with-source')
    process.exitCode = result.exitCode === 0 && result.status !== 'fail' ? 0 : 1
  } catch (error) {
    process.stderr.write(error.message + '\n')
    process.exitCode = 2
  }
}
module.exports = { run }
