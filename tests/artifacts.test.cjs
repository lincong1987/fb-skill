const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseFrontmatter, checkSkillDirectory } = require('../skills/create-fb-feature/scripts/lib/skill-format.cjs')
const { prepareArchive, validateInput, safeFile, changelogEntry } = require('../skills/create-fb-feature/scripts/archive.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-artifacts-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function workflow() {
  // Pure rendering fixture. No real approval is written and apply never consumes this mock.
  return {
    id: 'rendering-fixture', revision: 1, hashOk: true,
    plan: { summary: 'Synthetic rendering', hash: 'a'.repeat(64), files: ['src/list.vue', 'docs/features/rendering-fixture.md', 'CHANGELOG.md'] },
    validApproval: { actor: { name: 'Synthetic display only' }, evidenceKind: 'fixture-not-a-real-approval', evidenceReference: 'unit-test-only', at: '2000-01-01T00:00:00.000Z' },
    chain: { ok: true, headHash: 'b'.repeat(64) }, events: []
  }
}

function input() {
  return { title: 'Rendering fixture', summary: 'Only tests rendering and preservation', files: [{ path: 'src/list.vue', change: 'Changed', description: 'fixture' }], interfaces: [], todos: ['Real browser not run'], verification: [{ name: 'static-fixture', status: 'pass', exitCode: 0, evidence: 'test-only' }, { name: 'browser', status: 'not-run', detail: 'Rendering unit test only' }] }
}

test('frontmatter parser follows the bundle scalar contract', () => {
  const result = parseFrontmatter('---\nname: example\ndescription: "Use for example: validation"\n---\n# Example')
  assert.equal(result.fields.name, 'example')
  assert.equal(result.fields.description, 'Use for example: validation')
  assert.throws(() => parseFrontmatter('---\nname: example\nname: duplicate\ndescription: example\n---'), /Duplicate/)
  assert.throws(() => parseFrontmatter('---\nname: example\ndescription: folded: value\n---'), /Quote/)
})

test('skill check catches broken links and leaked test files', t => {
  const root = fixture(t)
  const directory = path.join(root, 'example')
  fs.mkdirSync(directory)
  fs.writeFileSync(path.join(directory, 'SKILL.md'), '---\nname: example\ndescription: Example\n---\n[missing](references/missing.md)\n')
  assert.throws(() => checkSkillDirectory(directory), /Broken/)
  fs.mkdirSync(path.join(directory, 'references'))
  fs.writeFileSync(path.join(directory, 'references/missing.md'), '# Reference')
  assert.equal(checkSkillDirectory(directory).name, 'example')
  fs.writeFileSync(path.join(directory, 'leaked.test.cjs'), '')
  assert.throws(() => checkSkillDirectory(directory), /Development\/test/)
})

test('archive preview preserves existing documents and does not write', t => {
  const root = fixture(t)
  fs.mkdirSync(path.join(root, 'docs/features'), { recursive: true })
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Existing\r\n\r\n## [Unreleased]\r\n\r\n- Previous change\r\n')
  fs.writeFileSync(path.join(root, 'docs/features/rendering-fixture.md'), '# Existing history\n\nPrevious event.\n')
  const preview = prepareArchive({ projectRoot: root, id: 'rendering-fixture', input: input(), workflow: workflow(), now: '2000-01-02T00:00:00.000Z' })
  assert.ok(preview.files[0].content.startsWith('# Existing history\n\nPrevious event.\n'))
  assert.ok(preview.files[1].content.includes('- Previous change\r\n'))
  assert.ok(preview.files[0].content.includes('部分验证'))
  assert.equal(fs.readFileSync(path.join(root, 'docs/features/rendering-fixture.md'), 'utf8'), '# Existing history\n\nPrevious event.\n')
})

test('identical archive input is idempotent; new input appends a revision section', t => {
  const root = fixture(t)
  const options = { projectRoot: root, id: 'rendering-fixture', input: input(), workflow: workflow(), now: '2000-01-02T00:00:00.000Z' }
  const first = prepareArchive(options)
  for (const file of first.files) {
    fs.mkdirSync(path.dirname(file.file), { recursive: true })
    fs.writeFileSync(file.file, file.content)
  }
  const repeated = prepareArchive(options)
  assert.deepEqual(repeated.files.map(file => file.content), first.files.map(file => file.content))
  const changed = prepareArchive({ ...options, input: { ...input(), summary: 'Updated fixture summary' } })
  assert.ok(changed.files[0].content.includes('Only tests rendering and preservation'))
  assert.ok(changed.files[0].content.includes('Updated fixture summary'))
})

test('unapproved plan, missing scope, traversal and fabricated pass are refused', t => {
  const root = fixture(t)
  assert.throws(() => prepareArchive({ projectRoot: root, id: 'rendering-fixture', input: input(), workflow: { ...workflow(), validApproval: null } }), /approval/)
  assert.throws(() => prepareArchive({ projectRoot: root, id: 'rendering-fixture', input: input(), workflow: { ...workflow(), plan: { ...workflow().plan, files: [] } } }), /scope/)
  assert.throws(() => safeFile(root, '../escape.md'), /safe/)
  assert.throws(() => validateInput({ ...input(), verification: [{ name: 'wrong', status: 'pass', exitCode: 1, evidence: 'not-a-pass' }] }), /Non-zero/)
  assert.throws(() => validateInput({ ...input(), verification: [{ name: 'wrong', status: 'pass' }] }), /evidence/)
})

test('changelog updates do not replace released sections', () => {
  const old = '# Changelog\n\n## [Unreleased]\n\n### Added\n- Old\n\n## [1.0.0]\n- Released\n'
  const result = changelogEntry(old, '<!-- unique -->\n- New', '<!-- unique -->')
  assert.ok(result.indexOf('- New') < result.indexOf('## [1.0.0]'))
  assert.ok(result.includes('### Added\n- Old'))
  assert.equal(changelogEntry(result, '<!-- unique -->\n- New', '<!-- unique -->'), result)
})
