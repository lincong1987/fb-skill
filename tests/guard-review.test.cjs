const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const W = require('../skills/create-fb-feature/scripts/workflow.cjs')
const A = require('../skills/create-fb-feature/scripts/lib/audit.cjs')
const I = require('../skills/create-fb-feature/scripts/lib/identity.cjs')
const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')
const CLI = path.join(__dirname, '../skills/create-fb-feature/scripts/workflow.cjs')

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-guard-review-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function plan(root) {
  return W.createPlan({ projectRoot: root, id: 'review-case', kind: 'feature', summary: 'Isolated review regression, no real business approval', files: ['src/example.vue'], acceptance: ['Check actual guard behavior'] })
}

function approve(root, result) {
  I.saveProfile({ projectRoot: root, name: '边界回归员', confirmationText: '我叫边界回归员', sourceRef: 'isolated-identity-source' })
  const operator = I.readIdentity({ projectRoot: root, profileRoot: path.join(root, 'isolated-profile') }).operator
  W.recordApproval({ projectRoot: root, id: result.id, planHash: result.hash, operator, evidence: { kind: 'user-message', reference: 'isolated-approval-source', text: '同意按此方案执行' } })
}

test('questions, denials, pending and conditional statements are not approval', () => {
  for (const text of ['未批准', '还没同意', '是否同意？', '同意吗', '如果通过就执行', 'They said yes', 'Pending approval', 'I do not approve']) assert.equal(I.validateConfirmationText(text).ok, false, text)
  assert.equal(I.validateConfirmationText('同意按此方案执行').ok, true)
  assert.equal(I.validateIdentityText('我叫边界回归员', '边界回归员').ok, true)
})

test('profile content change is not silently trusted as confirmed identity', t => {
  const root = temporary(t)
  const saved = I.saveProfile({ projectRoot: root, name: '身份回归员', confirmationText: '我叫身份回归员', sourceRef: 'isolated-identity-ref' })
  const stored = JSON.parse(fs.readFileSync(saved.file, 'utf8'))
  stored.name = 'Changed without confirmation'
  fs.writeFileSync(saved.file, JSON.stringify(stored))
  assert.equal(I.readIdentity({ projectRoot: root, profileRoot: path.join(root, 'isolated-profile') }).operator, null)
  assert.throws(() => I.saveProfile({ projectRoot: root, name: '身份回归员', confirmationText: '确认', sourceRef: 'another-ref', expectHash: saved.hash }), error => error.code === 'PROFILE_CORRUPT')
})

test('audit namespace junction cannot redirect profile or plan writes', t => {
  const root = temporary(t)
  const outside = temporary(t)
  fs.mkdirSync(path.join(root, '.agents'))
  try { fs.symlinkSync(outside, path.join(root, '.agents/fb-feature'), process.platform === 'win32' ? 'junction' : 'dir') } catch (error) {
    if (error.code === 'EPERM') { t.skip('Directory link creation not allowed by platform'); return }
    throw error
  }
  assert.throws(() => plan(root), error => error.code === 'SYMLINK_ESCAPE')
  assert.throws(() => I.saveProfile({ projectRoot: root, name: '链路回归员', confirmationText: '确认', sourceRef: 'isolated-ref' }), error => error.code === 'SYMLINK_ESCAPE')
  assert.deepEqual(fs.readdirSync(outside), [])
})

test('NTFS stream paths and reserved names are refused before plan writes', t => {
  const root = temporary(t)
  for (const file of ['src/file.txt:secret', 'src/NUL.txt', 'src/name.', 'src/name ']) assert.throws(() => W.createPlan({ projectRoot: root, id: 'bad-path', kind: 'feature', summary: 'safe check', files: [file], acceptance: ['safe'] }), error => error.code === 'BAD_FILE_SCOPE')
})

test('old lock age never authorizes deletion of an active lock', t => {
  const root = temporary(t)
  const lock = path.join(root, 'active.lock')
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token: 'other-owner' }))
  fs.utimesSync(lock, new Date(0), new Date(0))
  assert.throws(() => F.withLock(lock, () => assert.fail('must not acquire'), { timeoutMs: 40, staleMs: 1 }), error => error.code === 'LOCK_TIMEOUT')
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).token, 'other-owner')
})

test('failed verification is blocked, never verified; draft events cannot fabricate implementation', t => {
  const root = temporary(t)
  const result = plan(root)
  A.appendEvent({ projectRoot: root, id: result.id, type: 'verification', details: { status: 'pass' } })
  assert.equal(W.readWorkflow({ projectRoot: root, id: result.id }).status, 'draft')
  approve(root, result)
  A.appendEvent({ projectRoot: root, id: result.id, type: 'verification', details: { status: 'fail', exitCode: 1 } })
  assert.equal(W.readWorkflow({ projectRoot: root, id: result.id }).status, 'blocked')
  W.createPlan({ projectRoot: root, id: result.id, kind: 'feature', summary: 'New revision', files: ['src/example.vue'], acceptance: ['Changed scope'] })
  assert.equal(W.readWorkflow({ projectRoot: root, id: result.id }).status, 'draft')
})

test('broken audit chain refuses a new revision before writing it', t => {
  const root = temporary(t)
  plan(root)
  const file = path.join(root, '.agents/fb-feature/workflows/review-case/events.jsonl')
  const record = JSON.parse(fs.readFileSync(file, 'utf8').trim())
  record.actor = 'unreviewed-edit'
  fs.writeFileSync(file, `${JSON.stringify(record)}\n`)
  assert.throws(() => plan(root), error => error.code === 'CHAIN_BROKEN')
  assert.equal(fs.existsSync(path.join(root, '.agents/fb-feature/workflows/review-case/plans/plan-v2.json')), false)
})

test('CLI implementation event without current approval cannot pass', t => {
  const root = temporary(t)
  plan(root)
  const result = spawnSync(process.execPath, [CLI, 'event', '--project-root', root, '--profile-root', path.join(root, 'isolated'), '--id', 'review-case', '--type', 'implementation-start', '--details', '{}'], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  assert.equal(JSON.parse(result.stdout).code, 'NOT_APPROVED')
})

test('public event API cannot bypass approval recording or start a draft', t => {
  const root = temporary(t)
  const result = plan(root)
  assert.throws(() => W.appendEvent({ projectRoot: root, id: result.id, type: 'approval', actor: 'not confirmed', details: { revision: result.revision, planHash: result.hash } }), error => error.code === 'BAD_EVENT_TYPE')
  assert.throws(() => W.appendEvent({ projectRoot: root, id: result.id, type: 'implementation-start', details: {} }), error => error.code === 'NOT_APPROVED')
  assert.equal(W.readWorkflow({ projectRoot: root, id: result.id }).events.length, 1)
})

test('a low-level approval-shaped event without identity and evidence is not valid approval', t => {
  const root = temporary(t)
  const result = plan(root)
  A.appendEvent({ projectRoot: root, id: result.id, type: 'approval', actor: 'unconfirmed annotation', details: { revision: result.revision, planHash: result.hash } })
  assert.throws(() => W.assertApproved({ projectRoot: root, id: result.id }), error => error.code === 'NOT_APPROVED')
  assert.equal(W.readWorkflow({ projectRoot: root, id: result.id }).validApproval, null)
})

test('contradictory nonzero verification exit code never becomes verified', t => {
  const root = temporary(t)
  const result = plan(root)
  approve(root, result)
  A.appendEvent({ projectRoot: root, id: result.id, type: 'verification', details: { revision: result.revision, planHash: result.hash, status: 'pass', exitCode: 1, evidence: 'isolated failed command output' } })
  assert.equal(W.readWorkflow({ projectRoot: root, id: result.id }).status, 'blocked')
})

test('verification pass without evidence is rejected by the public event API', t => {
  const root = temporary(t)
  const result = plan(root)
  approve(root, result)
  assert.throws(() => W.appendEvent({ projectRoot: root, id: result.id, type: 'verification', details: { status: 'pass', exitCode: 0 } }), error => error.code === 'BAD_VERIFICATION')
  assert.equal(W.readWorkflow({ projectRoot: root, id: result.id }).status, 'approved')
})

test('workflow subcommand help is usable without business parameters', t => {
  const result = spawnSync(process.execPath, [CLI, 'plan', '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /--input/)
})
