#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const crypto = require('crypto')
const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')

function pack(root, name) {
  F.assertSlug(name)
  const base = path.join(root, '.validation-output', 'release-validation', name)
  fs.mkdirSync(base, { recursive: false })
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  const packed = spawnSync(process.execPath,
    [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', base],
    { cwd: root, encoding: 'utf8', shell: false, timeout: 120000 })
  fs.writeFileSync(path.join(base, 'pack.log'), packed.stdout + packed.stderr, { flag: 'wx' })
  if (packed.status !== 0) throw new Error('npm pack failed: ' + packed.status)
  const result = JSON.parse(packed.stdout)
  if (result.length !== 1 || result[0].name !== 'fb-skill' || result[0].version !== '0.2.1') throw new Error('Wrong packed package')
  const forbidden = result[0].files.filter(file => /^(?:tests|evals|\.validation-output|node_modules|\.agents)\/|reverse-requirements-feasibility|reverse-requirements-pilot|release-validation|\.zip$|\.tgz$/.test(file.path))
  if (forbidden.length) throw new Error('Development material leaked: ' + JSON.stringify(forbidden))
  const file = path.join(base, result[0].filename)
  const bytes = fs.readFileSync(file)
  const unpacked = path.join(base, 'unpacked')
  fs.mkdirSync(unpacked)
  const members = spawnSync('tar', ['-tzf', path.basename(file)], { cwd: base, encoding: 'utf8', timeout: 30000 })
  if (members.status !== 0 || members.stdout.trim().split(/\r?\n/).some(member => !member.startsWith('package/') || member.includes('..') || member.includes('\\') || member.includes(':'))) throw new Error('Unsafe tar members')
  const extracted = spawnSync('tar', ['--no-same-owner', '-xzf', path.basename(file), '-C', 'unpacked'], { cwd: base, encoding: 'utf8', timeout: 30000 })
  if (extracted.status !== 0) throw new Error('tar extraction failed: ' + extracted.stderr)
  const bundle = path.join(unpacked, 'package')
  const actualFiles = []
  function visit(dir) {
    F.assertNoLinks(dir)
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      F.assertNoLinks(abs)
      if (entry.isDirectory()) visit(abs)
      else if (entry.isFile()) actualFiles.push(path.relative(bundle, abs).split(path.sep).join('/'))
      else throw new Error('Unexpected package member: ' + abs)
    }
  }
  visit(bundle)
  const expectedFiles = result[0].files.map(entry => entry.path).sort()
  if (JSON.stringify(actualFiles.sort()) !== JSON.stringify(expectedFiles)) throw new Error('Unpacked file set differs from npm pack manifest')
  for (const relative of expectedFiles) {
    if (!fs.readFileSync(path.join(root, relative)).equals(fs.readFileSync(path.join(bundle, relative)))) throw new Error('Unpacked bytes differ from reviewed source: ' + relative)
  }
  const { check } = require(path.join(bundle, 'scripts/check-skills.cjs'))
  const structure = check(bundle)
  const manifest = { name: result[0].name, version: result[0].version, file, bundle,
    bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    packedFiles: result[0].files, structure, recordedAt: F.nowIso().atLocal, published: false }
  F.writeJsonImmutable(path.join(base, 'manifest.json'), manifest)
  fs.writeSync(1, JSON.stringify({ base, file, bundle, count: result[0].files.length, sha256: manifest.sha256 }) + '\n')
  return manifest
}
if (require.main === module) {
  try { pack(path.resolve(__dirname, '..'), process.argv[2]) }
  catch (error) { fs.writeSync(2, error.message + '\n'); process.exitCode = 1 }
}
module.exports = { pack }
