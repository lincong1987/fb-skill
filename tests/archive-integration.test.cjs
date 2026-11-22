const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const W = require('../skills/create-fb-feature/scripts/workflow.cjs')
const I = require('../skills/create-fb-feature/scripts/lib/identity.cjs')
const { prepareArchive, applyArchive } = require('../skills/create-fb-feature/scripts/archive.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-archive-integration-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function setup(root) {
  // Temporary regression simulation only. No user/home/repository approval is created.
  I.saveProfile({ projectRoot: root, name: '归档回归员', confirmationText: '确认仅按当前方案执行', sourceRef: 'isolated-regression-identity' })
  const operator = I.readIdentity({ projectRoot: root, profileRoot: path.join(root, 'isolated-profile') }).operator
  const result = W.createPlan({ projectRoot: root, id: 'archive-case', kind: 'feature', summary: 'Temporary artifact integration check', files: ['src/page.vue', 'docs/features/archive-case.md', 'CHANGELOG.md'], acceptance: ['Preserve old content', 'Do not turn a failed check into success'] })
  W.recordApproval({ projectRoot: root, id: result.id, planHash: result.hash, operator, evidence: { kind: 'user-message', reference: 'isolated-regression-approval', text: '确认，按此计划执行' } })
  return result
}

function input() {
  return { title: 'Artifact integration regression', summary: 'Temporary changes only', files: [{ path: 'src/page.vue', change: 'Added', description: 'regression fixture' }], interfaces: [], todos: ['Runtime not tested in this artifact regression'], verification: [{ name: 'compile simulation', status: 'fail', exitCode: 1, evidence: 'temporary-output' }, { name: 'runtime', status: 'not-run', detail: 'This is an artifact integration test' }] }
}

test('real workflow API integrates with artifact apply, preserving content and recording partial validation', t => {
  const root = fixture(t)
  setup(root)
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Existing\n\n## [Unreleased]\n\n- Keep old entry\n')
  const preview = prepareArchive({ projectRoot: root, id: 'archive-case', input: input() })
  const result = applyArchive(preview)
  assert.equal(result.ok, true)
  const document = fs.readFileSync(path.join(root, 'docs/features/archive-case.md'), 'utf8')
  assert.ok(document.includes('验证未通过'))
  assert.ok(document.includes('归档回归员'))
  assert.ok(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').includes('- Keep old entry'))
  const workflow = W.readWorkflow({ projectRoot: root, id: 'archive-case' })
  assert.equal(workflow.chain.ok, true)
  assert.ok(workflow.events.filter(event => event.type === 'note').every(event => event.actor === '归档回归员'))
  assert.ok(W.verifyAll({ projectRoot: root, id: 'archive-case' }).ok)
})

test('changed destination and revised plan reject archive writes', t => {
  const root = fixture(t)
  setup(root)
  let preview = prepareArchive({ projectRoot: root, id: 'archive-case', input: input() })
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), 'Unreviewed edit\n')
  assert.throws(() => applyArchive(preview), /changed/)
  assert.equal(fs.existsSync(path.join(root, 'docs/features/archive-case.md')), false)
  preview = prepareArchive({ projectRoot: root, id: 'archive-case', input: input() })
  W.createPlan({ projectRoot: root, id: 'archive-case', kind: 'feature', summary: 'Revision after approval', files: ['src/page.vue', 'docs/features/archive-case.md', 'CHANGELOG.md'], acceptance: ['New acceptance'] })
  assert.throws(() => applyArchive(preview), error => error.code === 'SUPERSEDED' || error.code === 'NOT_APPROVED')
  assert.equal(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), 'Unreviewed edit\n')
})

test('manual preview destination alteration cannot target a business file', t => {
  const root = fixture(t)
  setup(root)
  const preview = prepareArchive({ projectRoot: root, id: 'archive-case', input: input() })
  preview.files[0].path = 'src/page.vue'
  preview.files[0].file = path.join(root, 'src/page.vue')
  assert.throws(() => applyArchive(preview), /artifact scope/)
  assert.equal(fs.existsSync(path.join(root, 'src/page.vue')), false)
})
