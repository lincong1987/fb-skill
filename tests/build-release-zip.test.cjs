const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

// Pure CLI-behavior tests for the release ZIP builder.
// Seam: `python -I scripts/build-release-zip.py --manifest <json> --output <zip>` exit code + stderr/stdout.
// Fixtures are synthetic; no real pack artifacts or approvals are touched.

const ROOT = path.resolve(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'build-release-zip.py')

function makePackFixture(t, members) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-release-zip-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const stage = path.join(root, 'stage', 'package')
  const bundle = path.join(root, 'bundle')
  for (const member of members) {
    for (const base of [stage, bundle]) {
      const target = path.join(base, ...member.path.split('/'))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, member.content)
    }
  }
  const tgz = path.join(root, 'fb-skill-0.2.1.tgz')
  // Relative args + cwd, like pack-release-validation.cjs: GNU tar treats "D:/..." as a remote host.
  const tar = spawnSync('tar', ['-czf', 'fb-skill-0.2.1.tgz', '-C', 'stage', 'package'], { cwd: root, encoding: 'utf8' })
  assert.equal(tar.status, 0, 'fixture tar failed: ' + tar.stderr)
  const manifest = {
    name: 'fb-skill', version: '0.2.1', bundle, file: tgz,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(tgz)).digest('hex'),
    packedFiles: members.map(member => ({ path: member.path, size: Buffer.byteLength(member.content), mode: 420 }))
  }
  const manifestPath = path.join(root, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  return { manifestPath, output: path.join(root, 'fb-skill-0.2.1-validation.zip') }
}

function runBuilder(manifestPath, output) {
  return spawnSync('python', ['-I', SCRIPT, '--manifest', manifestPath, '--output', output], { encoding: 'utf8' })
}

const HAPPY_MEMBERS = [
  { path: 'package.json', content: '{"name":"fb-skill","version":"0.2.1"}\n' },
  { path: 'README.md', content: '# Fixture readme\n' },
  { path: 'docs/validation.md', content: '# Fixture validation\n' }
]

test('builder creates a verified zip for a clean reviewed manifest and refuses overwrite', t => {
  const fixture = makePackFixture(t, HAPPY_MEMBERS)
  const first = runBuilder(fixture.manifestPath, fixture.output)
  assert.equal(first.status, 0, 'expected exit 0, stderr: ' + first.stderr)
  const summary = JSON.parse(first.stdout)
  assert.equal(summary.verified, true)
  assert.equal(summary.files, HAPPY_MEMBERS.length)
  assert.ok(fs.existsSync(fixture.output))
  const second = runBuilder(fixture.manifestPath, fixture.output)
  assert.notEqual(second.status, 0, 'wx exclusive creation must refuse an existing output')
  assert.match(second.stderr, /Output already exists/)
})

test('builder rejects duplicate manifest packedFiles paths instead of silently deduplicating', t => {
  const duplicated = [...HAPPY_MEMBERS, { path: 'README.md', content: '# Fixture readme\n' }]
  const fixture = makePackFixture(t, duplicated)
  const result = runBuilder(fixture.manifestPath, fixture.output)
  assert.notEqual(result.status, 0, 'duplicate manifest paths must fail, got exit ' + result.status)
  assert.match(result.stderr, /Duplicate package member path/)
  assert.ok(!fs.existsSync(fixture.output), 'no zip may be written for a rejected manifest')
})

// Same forbidden-material blacklist as scripts/pack-release-validation.cjs.
const FORBIDDEN_PATHS = [
  '.agents/fb-feature/host-approvals/release-validation-20261122.json',
  'tests/build-release-zip.test.cjs',
  'evals/reverse-requirements/case.json',
  '.validation-output/release-validation/consumer-pack-05/manifest.json',
  'node_modules/fb-skill/index.js',
  'evil.zip',
  'docs/legacy/fb-skill-old.tgz',
  'docs/reverse-requirements-feasibility.md',
  'docs/features/reverse-requirements-pilot.md',
  'notes/release-validation-draft.md'
]

test('builder rejects forbidden development, validation and private reverse material', t => {
  for (const forbidden of FORBIDDEN_PATHS) {
    const fixture = makePackFixture(t, [{ path: forbidden, content: '# leaked fixture\n' }])
    const result = runBuilder(fixture.manifestPath, fixture.output)
    assert.notEqual(result.status, 0, forbidden + ' must be rejected, got exit ' + result.status)
    assert.match(result.stderr, /Forbidden package member/, forbidden + ' must name the blacklist as the cause')
    assert.ok(!fs.existsSync(fixture.output), 'no zip may be written for ' + forbidden)
  }
})
