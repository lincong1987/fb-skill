'use strict'

// workflow.test.cjs — 计划/批准/审计门禁回归（node:test；全部隔离在 os.tmpdir()）。
//
// 约束：
//   * 不触碰真实 HOME / globalprofile（identity 读取一律传隔离 profileRoot）；
//   * 不构造任何「当前会话的真实批准」：批准人/语句/来源引用均为临时 fixture，
//     只存在于 os.tmpdir() 下的隔离项目里，模拟用途在命名与注释中明示；
//   * fixture 身份只用于验证「被拒绝」，不写入任何真实档案。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync, spawn } = require('node:child_process')

const W = require('../skills/create-fb-feature/scripts/workflow.cjs')
const A = require('../skills/create-fb-feature/scripts/lib/audit.cjs')
const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')
const I = require('../skills/create-fb-feature/scripts/lib/identity.cjs')

const WORKFLOW_CLI = path.join(__dirname, '..', 'skills', 'create-fb-feature', 'scripts', 'workflow.cjs')
const RESOLVE_CLI = path.join(__dirname, '..', 'skills', 'create-fb-feature', 'scripts', 'resolve-identity.cjs')

let seq = 0
function tmpProject () {
  seq += 1
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-wf-' + seq + '-'))
  return { root: root, profileRoot: path.join(root, 'isolated-global-profile') }
}

function rm (dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

// 回归 fixture（临时目录内；非真实身份；非当前会话批准——模拟用途明示）
const CONFIRM_TEXT = '我确认，同意按此方案执行'
const FIXTURE_OPERATOR_NAME = '门禁回归员'

// 在隔离项目里写入已确认档案并返回 operator（用于需要"已批准"路径的用例）。
function confirmFixtureOperator (root, profileRoot) {
  I.saveProfile({
    projectRoot: root,
    scope: 'project',
    name: FIXTURE_OPERATOR_NAME,
    confirmationText: CONFIRM_TEXT,
    sourceRef: 'msg-wf-regression-0001'
  })
  const ident = I.readIdentity({ projectRoot: root, profileRoot: profileRoot })
  assert.ok(ident.operator, '测试前置：fixture 确认档案应生效')
  return ident.operator
}

function planV1 (root, overrides) {
  return W.createPlan(Object.assign({
    projectRoot: root,
    id: 'demo-feature',
    kind: 'feature',
    summary: '为示例模块新增入口',
    files: ['src/demo/Demo.java'],
    acceptance: ['编译通过', '接口返回 200']
  }, overrides || {}))
}

function latestPlanHash (root, id) {
  const wf = W.readWorkflow({ projectRoot: root, id: id })
  assert.ok(wf.plan, '测试前置：计划应存在')
  return wf.plan.hash
}

function approve (root, operator, opts) {
  const o = opts || {}
  return W.recordApproval({
    projectRoot: root,
    id: o.id || 'demo-feature',
    revision: o.revision,
    planHash: o.planHash,
    operator: operator,
    evidence: Object.assign({
      kind: 'user-message',
      reference: 'msg-wf-' + (o.refSeq || '0001'),
      text: CONFIRM_TEXT
    }, o.evidence || {})
  })
}

function wfDir (root, id) {
  return path.join(root, '.agents', 'fb-feature', 'workflows', id)
}

function planFile (root, id, rev) {
  return path.join(wfDir(root, id), 'plans', 'plan-v' + rev + '.json')
}

function eventsFile (root, id) {
  return path.join(wfDir(root, id), 'events.jsonl')
}

// ---------------------------------------------------------------------------

test('不可变写入保留任意源码字节且拒绝覆盖', function () {
  const { root } = tmpProject()
  try {
    const file = path.join(root, 'source.bin')
    const bytes = Buffer.from([0x00, 0x7f, 0x80, 0xff, 0xc3, 0x28])
    F.writeTextExclusive(file, bytes)
    assert.deepEqual(fs.readFileSync(file), bytes)
    assert.throws(function () { F.writeTextExclusive(file, Buffer.from('replacement')) }, function (e) { return e.code === 'FILE_EXISTS' })
    assert.deepEqual(fs.readFileSync(file), bytes)
  } finally { rm(root) }
})

test('createPlan：hash/revision/不可变文件/绑定 realpath', function () {
  const { root } = tmpProject()
  try {
    const r = planV1(root)
    assert.equal(r.revision, 1)
    assert.equal(r.id, 'demo-feature')
    assert.match(r.hash, /^[0-9a-f]{64}$/)
    const file = planFile(root, 'demo-feature', 1)
    assert.ok(fs.existsSync(file))
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(stored.hash, r.hash)
    assert.equal(stored.projectRoot, fs.realpathSync(root))
    assert.deepEqual(stored.files, ['src/demo/Demo.java'])
    // 同一 id 再建 → v2，v1 原样不可变
    const r2 = planV1(root, { summary: '修订版' })
    assert.equal(r2.revision, 2)
    const stored1 = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.equal(stored1.hash, r.hash)
    // 直接覆写已有修订文件被 wx 拒绝
    assert.throws(function () { F.writeJsonImmutable(file, stored1) }, function (e) { return e.code === 'FILE_EXISTS' })
    // 内容哈希可复算
    assert.equal(W.hashObject(W.withoutHash(stored)), r.hash)
  } finally { rm(root) }
})

test('plan id slug 化；文件范围拒绝 ../绝对/反斜杠/盘符；installer 命名空间路径放行', function () {
  const { root } = tmpProject()
  try {
    const r = W.createPlan({
      projectRoot: root, id: 'Device Scrap!!', kind: 'feature',
      summary: 's', files: ['a.txt'], acceptance: 'ok'
    })
    assert.equal(r.id, 'device-scrap')
    assert.throws(function () {
      W.createPlan({ projectRoot: root, id: '///', kind: 'f', summary: 's', files: ['a.txt'], acceptance: 'ok' })
    }, function (e) { return e.code === 'BAD_PLAN_ID' })
    const bad = [['../out.txt'], ['/abs.txt'], ['C:/x.txt'], ['a\\b.txt'], ['a/../../b.txt'], ['a/./b.txt'], [''], ['a//b']]
    for (const f of bad) {
      assert.throws(function () {
        W.createPlan({ projectRoot: root, id: 'path-case', kind: 'f', summary: 's', files: f, acceptance: 'ok' })
      }, function (e) { return e.code === 'BAD_FILE_SCOPE' }, JSON.stringify(f))
    }
    // installer/归档涉及的命名空间路径必须放行（相对、无 ..）
    const okPaths = [['.agents/fb-feature/install-manifest.json'], ['skills/create-fb-feature/SKILL.md'], ['src/newpkg/New.java']]
    for (const f of okPaths) {
      W.createPlan({ projectRoot: root, id: 'ns-case', kind: 'f', summary: 's', files: f, acceptance: 'ok' })
    }
  } finally { rm(root) }
})

test('未确认身份（git/OS/SVN 候选、缺确认块的对象）不能通过门禁', function () {
  const { root, profileRoot } = tmpProject()
  try {
    const r = planV1(root)
    // 模拟"git/SVN/OS 只给候选"：这些 operator 形状缺少确认档案要素
    const attempts = [
      { name: 'Git线索人', source: 'git-config' },
      { name: 'os-person', source: 'os-user' },
      { name: 'SVN最后提交人', source: 'svn-last-author' },
      { name: '缺schema', status: 'confirmed' },
      { name: '缺确认块', schema: 'fb-feature-identity/v1', status: 'confirmed' }
    ]
    for (const op of attempts) {
      assert.throws(function () {
        approve(root, op, { planHash: r.hash })
      }, function (e) { return /^OPERATOR_/.test(e.code) }, JSON.stringify(op.name))
    }
    // 审计里没有任何 approval 事件
    const audit = A.verifyAudit({ projectRoot: root, id: 'demo-feature' })
    assert.ok(audit.ok)
    assert.equal(audit.count, 1) // 仅 plan-created
    assert.ok(!fs.readFileSync(eventsFile(root, 'demo-feature'), 'utf8').includes('"approval"'))
    // 隔离 profileRoot 全程未产生 operator
    const ident = I.readIdentity({ projectRoot: root, profileRoot: profileRoot })
    assert.equal(ident.operator, null)
  } finally { rm(root) }
})

test('fixture 标记的操作人/证据一律拒绝且不写入', function () {
  const { root, profileRoot } = tmpProject()
  try {
    const r = planV1(root)
    const op = confirmFixtureOperator(root, profileRoot)
    assert.throws(function () {
      W.recordApproval({
        projectRoot: root, id: 'demo-feature', planHash: r.hash, operator: op,
        evidence: { kind: 'user-message', reference: 'msg-f', text: CONFIRM_TEXT }, fixture: true
      })
    }, function (e) { return e.code === 'FIXTURE_REJECTED' })
    assert.throws(function () {
      W.recordApproval({
        projectRoot: root, id: 'demo-feature', planHash: r.hash,
        operator: Object.assign({}, op, { fixture: true }),
        evidence: { kind: 'user-message', reference: 'msg-f1', text: CONFIRM_TEXT }
      })
    }, function (e) { return e.code === 'OPERATOR_FIXTURE' })
    assert.throws(function () {
      W.recordApproval({
        projectRoot: root, id: 'demo-feature', planHash: r.hash, operator: op,
        evidence: { kind: 'user-message', reference: 'msg-f2', text: 'fixture：我同意' }
      })
    }, function (e) { return e.code === 'EVIDENCE_TEXT_REJECTED' })
    const audit = A.verifyAudit({ projectRoot: root, id: 'demo-feature' })
    assert.equal(audit.count, 1)
  } finally { rm(root) }
})

test('批准语句：空/否定/示例/缺来源引用拒绝；肯定通过并持久化', function () {
  const { root, profileRoot } = tmpProject()
  try {
    planV1(root)
    const op = confirmFixtureOperator(root, profileRoot)
    const hash = latestPlanHash(root, 'demo-feature')
    const rejects = [
      { kind: 'user-message', reference: 'm1', text: '' },
      { kind: 'user-message', reference: 'm2', text: 'maybe' },
      { kind: 'user-message', reference: 'm3', text: '我不同意' },
      { kind: 'user-message', reference: 'm4', text: '暂不，先改改' },
      { kind: 'user-message', reference: 'm5', text: '示例：同意按此执行' },
      { kind: 'weird', reference: 'm6', text: CONFIRM_TEXT },
      { kind: 'user-message', reference: '', text: CONFIRM_TEXT },
      { kind: 'user-message', text: CONFIRM_TEXT }
    ]
    for (const ev of rejects) {
      assert.throws(function () {
        W.recordApproval({ projectRoot: root, id: 'demo-feature', planHash: hash, operator: op, evidence: ev })
      }, function (e) { return /^(EVIDENCE_|SOURCE_REF_)/.test(e.code) }, JSON.stringify(ev))
    }
    const ok = W.recordApproval({
      projectRoot: root, id: 'demo-feature', planHash: hash, operator: op,
      evidence: { kind: 'user-message', reference: 'msg-ok-9', text: '确认，按此方案执行' }
    })
    assert.equal(ok.event.type, 'approval')
    assert.equal(W.assertApproved({ projectRoot: root, id: 'demo-feature' }).hash, hash)
    // 审计里保存了证据原文与引用（可追查）
    const raw = fs.readFileSync(eventsFile(root, 'demo-feature'), 'utf8')
    assert.ok(raw.includes('msg-ok-9'))
    assert.ok(raw.includes('确认，按此方案执行'))
  } finally { rm(root) }
})

test('host-plan：当前派生方案绑定界面批准，保留来源和原文', function () {
  const { root, profileRoot } = tmpProject()
  try {
    const planText = '本隔离测试仅执行a.txt，采用显示标签界面回归员。'
    const receipt = {
      schema: 'fb-host-plan-approval/v1', host: 'zcode', sourceTool: 'ExitPlanMode',
      reference: 'isolated-host-plan-regression', resultText: I.HOST_PLAN_RESULT,
      projectRoot: fs.realpathSync(root), displayName: '界面回归员',
      planText, planTextHash: F.sha256Hex(planText), recordedAt: new Date().toISOString(),
      scopes: [{ id: 'demo-feature', kind: 'feature', revision: 1, summary: '为示例模块新增入口', projectRoot: fs.realpathSync(root),
        files: ['a.txt'], acceptance: ['编译通过', '接口返回 200'], metadataHash: F.hashObject({}) }]
    }
    receipt.hash = F.hashObject(receipt)
    I.saveProfile({ projectRoot: root, name: receipt.displayName, method: 'host-plan',
      confirmationText: receipt.resultText, sourceRef: receipt.reference, hostApproval: receipt })
    const operator = I.readIdentity({ projectRoot: root, profileRoot }).operator
    const plan = planV1(root, { files: ['a.txt'], metadata: { hostApproval: receipt } })
    W.recordApproval({ projectRoot: root, id: plan.id, planHash: plan.hash, operator,
      evidence: { kind: 'host-plan', reference: receipt.reference, text: receipt.resultText,
        hostApproval: receipt, derivedPlanHash: plan.hash } })
    assert.equal(W.assertApproved({ projectRoot: root, id: plan.id }).hash, plan.hash)
    assert.equal(W.readWorkflow({ projectRoot: root, id: plan.id }).validApproval.evidenceKind, 'host-plan')
  } finally { rm(root) }
})

test('host-plan rejects a receipt replayed for an unrelated current plan', function () {
  const { root, profileRoot } = tmpProject()
  try {
    const planText = '本隔离测试仅执行a.txt，采用显示标签界面回归员。'
    const receipt = { schema: 'fb-host-plan-approval/v1', host: 'zcode', sourceTool: 'ExitPlanMode',
      reference: 'isolated-host-replay', resultText: I.HOST_PLAN_RESULT,
      projectRoot: fs.realpathSync(root), displayName: '界面回归员', planText,
      planTextHash: F.sha256Hex(planText), recordedAt: new Date().toISOString() }
    receipt.hash = F.hashObject(receipt)
    I.saveProfile({ projectRoot: root, name: receipt.displayName, method: 'host-plan',
      confirmationText: receipt.resultText, sourceRef: receipt.reference, hostApproval: receipt })
    const operator = I.readIdentity({ projectRoot: root, profileRoot }).operator
    const unrelated = planV1(root, { id: 'unrelated-feature', files: ['unapproved.txt'], metadata: { hostApproval: receipt } })
    assert.throws(function () { W.recordApproval({ projectRoot: root, id: unrelated.id,
      planHash: unrelated.hash, operator, evidence: { kind: 'host-plan', reference: receipt.reference,
        text: receipt.resultText, hostApproval: receipt, derivedPlanHash: unrelated.hash } })
    }, function (error) { return error.code === 'HOST_APPROVAL_SCOPE_MISMATCH' })
    assert.equal(W.readWorkflow({ projectRoot: root, id: unrelated.id }).status, 'draft')
  } finally { rm(root) }
})

test('host-plan cannot approve a different operator, revision or unbound plan', function () {
  const { root, profileRoot } = tmpProject()
  try {
    const operator = confirmFixtureOperator(root, profileRoot)
    const planText = '批准门禁回归员执行a.txt。'
    const receipt = { schema: 'fb-host-plan-approval/v1', host: 'zcode', sourceTool: 'ExitPlanMode',
      reference: 'isolated-negative-host-plan', resultText: I.HOST_PLAN_RESULT,
      projectRoot: fs.realpathSync(root), displayName: '门禁回归员', planText,
      planTextHash: F.sha256Hex(planText), recordedAt: new Date().toISOString(),
      scopes: [{ id: 'demo-feature', kind: 'feature', revision: 1, summary: '为示例模块新增入口',
        projectRoot: fs.realpathSync(root), files: ['a.txt'], acceptance: ['编译通过', '接口返回 200'], metadataHash: F.hashObject({}) }] }
    receipt.hash = F.hashObject(receipt)
    const first = planV1(root, { files: ['a.txt'] })
    const evidence = { kind: 'host-plan', reference: receipt.reference, text: receipt.resultText, hostApproval: receipt }
    assert.throws(function () { W.recordApproval({ projectRoot: root, id: first.id,
      planHash: first.hash, operator, evidence: { ...evidence, derivedPlanHash: first.hash } })
    }, function (error) { return error.code === 'HOST_APPROVAL_MISMATCH' })
    const second = planV1(root, { files: ['a.txt'], metadata: { hostApproval: receipt } })
    assert.throws(function () { W.recordApproval({ projectRoot: root, id: second.id,
      planHash: second.hash, operator, evidence: { ...evidence, derivedPlanHash: second.hash } })
    }, function (error) { return error.code === 'HOST_APPROVAL_SCOPE_MISMATCH' })
    assert.throws(function () { W.recordApproval({ projectRoot: root, id: second.id,
      planHash: second.hash, operator: { ...operator, name: '另一个回归员' },
      evidence: { ...evidence, derivedPlanHash: second.hash } })
    }, function (error) { return error.code === 'EVIDENCE_TEXT_REJECTED' })
    assert.equal(W.readWorkflow({ projectRoot: root, id: second.id }).status, 'draft')
  } finally { rm(root) }
})

test('recordApproval 拒绝他根档案 operator（host-plan 身份确认绑定工程根）', function () {
  const rootA = tmpProject()
  const { root: rootB } = tmpProject()
  try {
    const planText = '本隔离测试采用显示标签跨根操作员，执行A工程文件范围。'
    const receipt = {
      schema: 'fb-host-plan-approval/v1', host: 'zcode', sourceTool: 'ExitPlanMode',
      reference: 'isolated-host-operator-crossroot', resultText: I.HOST_PLAN_RESULT,
      projectRoot: fs.realpathSync(rootA.root), displayName: '跨根操作员', planText,
      planTextHash: F.sha256Hex(planText), recordedAt: new Date().toISOString()
    }
    receipt.hash = F.hashObject(receipt)
    I.saveProfile({ projectRoot: rootA.root, name: receipt.displayName, method: 'host-plan',
      confirmationText: receipt.resultText, sourceRef: receipt.reference, hostApproval: receipt })
    const operatorA = I.readIdentity({ projectRoot: rootA.root, profileRoot: rootA.profileRoot }).operator
    assert.ok(operatorA, '前置：rootA 档案应确认 operator')
    planV1(rootB)
    const hashB = latestPlanHash(rootB, 'demo-feature')
    assert.throws(function () {
      W.recordApproval({ projectRoot: rootB, id: 'demo-feature', planHash: hashB,
        operator: operatorA,
        evidence: { kind: 'user-message', reference: 'msg-crossroot-op', text: CONFIRM_TEXT } })
    }, function (e) { return e.code === 'EVIDENCE_TEXT_REJECTED' && /其他工程根/.test(e.message) })
    const audit = A.verifyAudit({ projectRoot: rootB, id: 'demo-feature' })
    assert.equal(audit.count, 1, '拒绝时不得写入任何 approval 事件')
  } finally { rm(rootA.root); rm(rootB) }
})

test('planHash 不匹配/非法 hash 拒绝', function () {
  const { root, profileRoot } = tmpProject()
  try {
    planV1(root)
    const op = confirmFixtureOperator(root, profileRoot)
    assert.throws(function () {
      approve(root, op, { planHash: '0'.repeat(64) })
    }, function (e) { return e.code === 'PLAN_HASH_MISMATCH' })
    assert.throws(function () {
      approve(root, op, { planHash: 'zz-not-a-hash' })
    }, function (e) { return e.code === 'BAD_PLAN_HASH' })
    const audit = A.verifyAudit({ projectRoot: root, id: 'demo-feature' })
    assert.equal(audit.count, 1)
  } finally { rm(root) }
})

test('批准持久后 assertApproved 通过；事件链 seq/prevHash 连续；状态纯日志推导', function () {
  const { root, profileRoot } = tmpProject()
  try {
    const r = planV1(root)
    const op = confirmFixtureOperator(root, profileRoot)
    approve(root, op, { planHash: r.hash, refSeq: '0010' })
    const plan = W.assertApproved({ projectRoot: root, id: 'demo-feature', kind: 'feature' })
    assert.equal(plan.hash, r.hash)
    assert.throws(function () {
      W.assertApproved({ projectRoot: root, id: 'demo-feature', kind: 'chore' })
    }, function (e) { return e.code === 'KIND_MISMATCH' })
    let wf = W.readWorkflow({ projectRoot: root, id: 'demo-feature' })
    assert.equal(wf.status, 'approved')
    assert.equal(wf.chain.count, 2)
    assert.equal(wf.validApproval.evidenceReference, 'msg-wf-0010')
    // 生命周期事件推导（读日志，无状态文件）
    W.appendEvent({ projectRoot: root, id: 'demo-feature', type: 'implementation-start', actor: op.name, details: { note: '开始实施' } })
    W.appendEvent({ projectRoot: root, id: 'demo-feature', type: 'verification', actor: op.name, details: { result: 'pass', evidence: 'isolated test command passed, not business validation' } })
    wf = W.readWorkflow({ projectRoot: root, id: 'demo-feature' })
    assert.equal(wf.status, 'verified')
    assert.ok(!fs.existsSync(path.join(wfDir(root, 'demo-feature'), 'state.json')))
    // 链结构：genesis + prevHash 串接
    const recs = A.readAuditRecords(fs.realpathSync(root), 'demo-feature').records
    assert.equal(recs[0].prevHash, F.GENESIS_HASH)
    for (let i = 1; i < recs.length; i++) {
      assert.equal(recs[i].prevHash, recs[i - 1].hash)
      assert.equal(recs[i].seq, i + 1)
    }
    const v = A.verifyAudit({ projectRoot: root, id: 'demo-feature' })
    assert.ok(v.ok)
    assert.ok(recs[0].atOffset.match(/^[+-]\d{2}:\d{2}$/))
    assert.ok(recs[0].atLocal.includes(recs[0].atOffset))
  } finally { rm(root) }
})

test('新修订使旧批准失效（SUPERSEDED / NOT_APPROVED），批准 v2 后恢复', function () {
  const { root, profileRoot } = tmpProject()
  try {
    const r1 = planV1(root)
    const op = confirmFixtureOperator(root, profileRoot)
    approve(root, op, { planHash: r1.hash, refSeq: '0020' })
    assert.equal(W.assertApproved({ projectRoot: root, id: 'demo-feature' }).revision, 1)
    const r2 = planV1(root, { summary: '修订：调整入口' })
    assert.equal(r2.revision, 2)
    assert.throws(function () {
      W.assertApproved({ projectRoot: root, id: 'demo-feature' })
    }, function (e) { return e.code === 'NOT_APPROVED' })
    assert.throws(function () {
      W.assertApproved({ projectRoot: root, id: 'demo-feature', revision: 1 })
    }, function (e) { return e.code === 'SUPERSEDED' })
    approve(root, op, { planHash: r2.hash, revision: 2, refSeq: '0021' })
    assert.equal(W.assertApproved({ projectRoot: root, id: 'demo-feature' }).revision, 2)
    const wf = W.readWorkflow({ projectRoot: root, id: 'demo-feature' })
    assert.equal(wf.latestRevision, 2)
    assert.equal(wf.validApproval.revision, 2)
  } finally { rm(root) }
})

test('复制到另一个项目根后批准不延续（ROOT_MISMATCH）', function () {
  const { root, profileRoot } = tmpProject()
  const root2 = root + '-copy'
  try {
    const r = planV1(root)
    const op = confirmFixtureOperator(root, profileRoot)
    approve(root, op, { planHash: r.hash, refSeq: '0030' })
    fs.cpSync(root, root2, { recursive: true })
    assert.throws(function () {
      W.assertApproved({ projectRoot: root2, id: 'demo-feature' })
    }, function (e) { return e.code === 'ROOT_MISMATCH' })
  } finally { rm(root); rm(root2) }
})

test('计划文件被篡改 → assertApproved/verifyAll 检出（PLAN_TAMPERED）', function () {
  const { root, profileRoot } = tmpProject()
  try {
    const r = planV1(root)
    const op = confirmFixtureOperator(root, profileRoot)
    approve(root, op, { planHash: r.hash, refSeq: '0040' })
    const file = planFile(root, 'demo-feature', 1)
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'))
    stored.summary = '被篡改的摘要'
    fs.writeFileSync(file, JSON.stringify(stored, null, 2), 'utf8')
    assert.throws(function () {
      W.assertApproved({ projectRoot: root, id: 'demo-feature' })
    }, function (e) { return e.code === 'PLAN_TAMPERED' })
    const v = W.verifyAll({ projectRoot: root, id: 'demo-feature' })
    assert.equal(v.ok, false)
    assert.equal(v.plans[0].ok, false)
    assert.equal(v.chain.ok, true)
  } finally { rm(root) }
})

test('审计行被篡改 → 链校验失败；追加亦被拒绝（CHAIN_BROKEN）', function () {
  const { root, profileRoot } = tmpProject()
  try {
    const r = planV1(root)
    const op = confirmFixtureOperator(root, profileRoot)
    approve(root, op, { planHash: r.hash, refSeq: '0050' })
    const file = eventsFile(root, 'demo-feature')
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
    const rec = JSON.parse(lines[1])
    rec.actor = '冒名者'
    lines[1] = JSON.stringify(rec)
    fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8')
    const v = A.verifyAudit({ projectRoot: root, id: 'demo-feature' })
    assert.equal(v.ok, false)
    assert.ok(v.errors.some(function (e) { return e.includes('hash') }))
    assert.throws(function () {
      W.assertApproved({ projectRoot: root, id: 'demo-feature' })
    }, function (e) { return e.code === 'CHAIN_BROKEN' })
    assert.throws(function () {
      W.appendEvent({ projectRoot: root, id: 'demo-feature', type: 'note', actor: 'x', details: {} })
    }, function (e) { return e.code === 'CHAIN_BROKEN' })
  } finally { rm(root) }
})

test('并发 CLI event：seq 严格递增、链完整（独占锁生效）', { skip: false }, async function () {
  const { root } = tmpProject()
  try {
    planV1(root)
    const N = 6
    const kids = []
    for (let i = 0; i < N; i++) {
      kids.push(spawn(process.execPath, [
        WORKFLOW_CLI, 'event',
        '--project-root', root,
        '--id', 'demo-feature',
        '--type', 'note',
        '--details', JSON.stringify({ note: '并发回归 ' + i })
      ], { stdio: ['ignore', 'pipe', 'pipe'] }))
    }
    const codes = await Promise.all(kids.map(function (k) {
      return new Promise(function (resolve) { k.on('close', function (code) { resolve(code) }) })
    }))
    for (const c of codes) assert.equal(c, 0)
    const recs = A.readAuditRecords(fs.realpathSync(root), 'demo-feature').records
    assert.equal(recs.length, 1 + N)
    for (let i = 0; i < recs.length; i++) assert.equal(recs[i].seq, i + 1)
    const v = A.verifyAudit({ projectRoot: root, id: 'demo-feature' })
    assert.ok(v.ok)
    assert.ok(!fs.existsSync(path.join(wfDir(root, 'demo-feature'), '.lock')))
  } finally { rm(root) }
})

test('CLI event 拒绝 approval / 系统事件类型（不可经 CLI 伪造批准）', function () {
  const { root } = tmpProject()
  try {
    planV1(root)
    for (const type of ['approval', 'plan-created', 'revision-created']) {
      const r = spawnSync(process.execPath, [
        WORKFLOW_CLI, 'event', '--project-root', root, '--id', 'demo-feature',
        '--type', type, '--details', '{}'
      ], { encoding: 'utf8' })
      assert.equal(r.status, 2, type)
      assert.equal(JSON.parse(r.stdout.trim()).code, 'BAD_EVENT_TYPE')
    }
    const audit = A.verifyAudit({ projectRoot: root, id: 'demo-feature' })
    assert.equal(audit.count, 1)
  } finally { rm(root) }
})

test('CLI 端到端：resolve身份 → plan(--id) → approve(user-message) → check exit 0', function () {
  const { root, profileRoot } = tmpProject()
  try {
    const rs = spawnSync(process.execPath, [
      RESOLVE_CLI, '--project-root', root, '--profile-root', profileRoot,
      '--save', '--name', '端到端回归员', '--confirmation-text', CONFIRM_TEXT, '--source-ref', 'msg-e2e-1'
    ], { encoding: 'utf8' })
    assert.equal(rs.status, 0, rs.stdout + rs.stderr)

    const inputFile = path.join(root, 'input.json')
    fs.writeFileSync(inputFile, JSON.stringify({
      kind: 'feature', summary: '端到端模拟工作流（fixture，非真实批准）',
      files: ['src/E2E.java'], acceptance: ['通过']
    }))
    const ps = spawnSync(process.execPath, [
      WORKFLOW_CLI, 'plan', '--project-root', root, '--profile-root', profileRoot,
      '--id', 'e2e-flow', '--input', inputFile
    ], { encoding: 'utf8' })
    assert.equal(ps.status, 0, ps.stdout + ps.stderr)
    const pj = JSON.parse(ps.stdout.trim())
    assert.equal(pj.id, 'e2e-flow')
    assert.match(pj.hash, /^[0-9a-f]{64}$/)

    const as = spawnSync(process.execPath, [
      WORKFLOW_CLI, 'approve', '--project-root', root, '--profile-root', profileRoot,
      '--id', 'e2e-flow', '--plan-hash', pj.hash,
      '--evidence-text', CONFIRM_TEXT, '--source-ref', 'msg-e2e-2'
    ], { encoding: 'utf8' })
    assert.equal(as.status, 0, as.stdout + as.stderr)

    const cs = spawnSync(process.execPath, [
      WORKFLOW_CLI, 'check', '--project-root', root, '--id', 'e2e-flow'
    ], { encoding: 'utf8' })
    assert.equal(cs.status, 0, cs.stdout + cs.stderr)
    const cj = JSON.parse(cs.stdout.trim())
    assert.equal(cj.approved, true)
    assert.equal(cj.status, 'approved')
    assert.equal(cj.hash, pj.hash)
  } finally { rm(root) }
})

test('CLI approve：无已确认身份 → exit 2（OPERATOR_NOT_CONFIRMED）', function () {
  const { root, profileRoot } = tmpProject()
  try {
    const r = planV1(root)
    const as = spawnSync(process.execPath, [
      WORKFLOW_CLI, 'approve', '--project-root', root, '--profile-root', profileRoot,
      '--id', 'demo-feature', '--plan-hash', r.hash,
      '--evidence-text', CONFIRM_TEXT, '--source-ref', 'msg-no-id'
    ], { encoding: 'utf8' })
    assert.equal(as.status, 2)
    const j = JSON.parse(as.stdout.trim())
    assert.equal(j.code, 'OPERATOR_NOT_CONFIRMED')
    const audit = A.verifyAudit({ projectRoot: root, id: 'demo-feature' })
    assert.equal(audit.count, 1)
  } finally { rm(root) }
})

test('CLI approve terminal 模式在非 TTY 下拒绝（不能免交互自批准）', function () {
  const { root, profileRoot } = tmpProject()
  try {
    const r = planV1(root)
    confirmFixtureOperator(root, profileRoot)
    const as = spawnSync(process.execPath, [
      WORKFLOW_CLI, 'approve', '--project-root', root, '--profile-root', profileRoot,
      '--id', 'demo-feature', '--plan-hash', r.hash, '--evidence-kind', 'terminal'
    ], { encoding: 'utf8' })
    assert.equal(as.status, 2)
    assert.equal(JSON.parse(as.stdout.trim()).code, 'TTY_REQUIRED')
    // terminal 与 user-message 参数互斥
    const as2 = spawnSync(process.execPath, [
      WORKFLOW_CLI, 'approve', '--project-root', root, '--profile-root', profileRoot,
      '--id', 'demo-feature', '--plan-hash', r.hash, '--evidence-kind', 'terminal',
      '--evidence-text', CONFIRM_TEXT
    ], { encoding: 'utf8' })
    assert.equal(as2.status, 2)
    assert.equal(JSON.parse(as2.stdout.trim()).code, 'BAD_ARGS')
  } finally { rm(root) }
})

test('CLI event：details 文件只从当前工程读取，拒绝越界且不追加事件', function () {
  const { root, profileRoot } = tmpProject()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-wf-details-'))
  try {
    planV1(root)
    fs.mkdirSync(path.join(root, 'evidence'))
    fs.writeFileSync(path.join(root, 'evidence', 'details.json'), '{"note":"inside-project"}')
    const accepted = spawnSync(process.execPath, [WORKFLOW_CLI, 'event', '--project-root', root,
      '--profile-root', profileRoot, '--id', 'demo-feature', '--type', 'note', '--details', '@evidence/details.json'], { encoding: 'utf8', cwd: outside })
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr)
    const before = fs.readFileSync(eventsFile(root, 'demo-feature'))
    const outsideFile = path.join(outside, 'details.json')
    fs.writeFileSync(outsideFile, '{"note":"outside-project"}')
    for (const value of ['@' + outsideFile, '@../details.json']) {
      const refused = spawnSync(process.execPath, [WORKFLOW_CLI, 'event', '--project-root', root,
        '--profile-root', profileRoot, '--id', 'demo-feature', '--type', 'note', '--details', value], { encoding: 'utf8', cwd: outside })
      assert.equal(refused.status, 2, refused.stdout + refused.stderr)
      assert.deepEqual(fs.readFileSync(eventsFile(root, 'demo-feature')), before)
    }
  } finally { rm(root); rm(outside) }
})

test('CLI 严格解析：未知命令/未知参数/缺参数 exit 2', function () {
  const { root } = tmpProject()
  try {
    const r1 = spawnSync(process.execPath, [WORKFLOW_CLI, 'nope'], { encoding: 'utf8' })
    assert.equal(r1.status, 2)
    assert.equal(JSON.parse(r1.stdout.trim()).code, 'UNKNOWN_COMMAND')
    const r2 = spawnSync(process.execPath, [WORKFLOW_CLI, 'check', '--project-root', root, '--id', 'x', '--zzz', '1'], { encoding: 'utf8' })
    assert.equal(r2.status, 2)
    assert.equal(JSON.parse(r2.stdout.trim()).code, 'UNKNOWN_ARG')
    const r3 = spawnSync(process.execPath, [WORKFLOW_CLI, 'approve', '--project-root', root, '--id', 'x'], { encoding: 'utf8' })
    assert.equal(r3.status, 2)
    assert.equal(JSON.parse(r3.stdout.trim()).code, 'MISSING_ARG')
    const r4 = spawnSync(process.execPath, [WORKFLOW_CLI], { encoding: 'utf8' })
    assert.equal(r4.status, 2)
  } finally { rm(root) }
})

test('CLI check：不存在的工作流 exit 3（PLAN_NOT_FOUND）；未批准 exit 3', function () {
  const { root } = tmpProject()
  try {
    const r1 = spawnSync(process.execPath, [WORKFLOW_CLI, 'check', '--project-root', root, '--id', 'no-such'], { encoding: 'utf8' })
    assert.equal(r1.status, 3)
    assert.equal(JSON.parse(r1.stdout.trim()).code, 'PLAN_NOT_FOUND')
    planV1(root)
    const r2 = spawnSync(process.execPath, [WORKFLOW_CLI, 'check', '--project-root', root, '--id', 'demo-feature'], { encoding: 'utf8' })
    assert.equal(r2.status, 3)
    assert.equal(JSON.parse(r2.stdout.trim()).code, 'NOT_APPROVED')
  } finally { rm(root) }
})

test('CLI check：计划被篡改 exit 2（严重拒绝）', function () {
  const { root, profileRoot } = tmpProject()
  try {
    const r = planV1(root)
    const op = confirmFixtureOperator(root, profileRoot)
    approve(root, op, { planHash: r.hash, refSeq: '0060' })
    const file = planFile(root, 'demo-feature', 1)
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'))
    stored.acceptance = ['被篡改的验收']
    fs.writeFileSync(file, JSON.stringify(stored, null, 2), 'utf8')
    const cs = spawnSync(process.execPath, [WORKFLOW_CLI, 'check', '--project-root', root, '--id', 'demo-feature'], { encoding: 'utf8' })
    assert.equal(cs.status, 2)
    assert.equal(JSON.parse(cs.stdout.trim()).code, 'PLAN_TAMPERED')
  } finally { rm(root) }
})

test('report：stdout markdown；--out 新文件成功；已存在拒绝；不碰 docs/CHANGELOG', function () {
  const { root, profileRoot } = tmpProject()
  try {
    const r = planV1(root)
    const op = confirmFixtureOperator(root, profileRoot)
    approve(root, op, { planHash: r.hash, refSeq: '0070' })
    const r1 = spawnSync(process.execPath, [WORKFLOW_CLI, 'report', '--project-root', root, '--id', 'demo-feature'], { encoding: 'utf8' })
    assert.equal(r1.status, 0, r1.stdout + r1.stderr)
    assert.ok(r1.stdout.includes('# FB Feature 工作流报告：demo-feature'))
    assert.ok(r1.stdout.includes(FIXTURE_OPERATOR_NAME))
    assert.ok(r1.stdout.includes('src/demo/Demo.java'))
    assert.ok(r1.stdout.includes('本地防误操作与审计门禁'))
    const outExisting = path.join(root, 'existing.md')
    fs.writeFileSync(outExisting, 'x', 'utf8')
    const r2 = spawnSync(process.execPath, [WORKFLOW_CLI, 'report', '--project-root', root, '--id', 'demo-feature', '--out', outExisting], { encoding: 'utf8' })
    assert.equal(r2.status, 2)
    assert.equal(JSON.parse(r2.stdout.trim()).code, 'FILE_EXISTS')
    const outNew = path.join(root, 'report-out.md')
    const r3 = spawnSync(process.execPath, [WORKFLOW_CLI, 'report', '--project-root', root, '--id', 'demo-feature', '--out', outNew], { encoding: 'utf8' })
    assert.equal(r3.status, 0)
    assert.ok(fs.readFileSync(outNew, 'utf8').includes('demo-feature'))
    assert.ok(!fs.existsSync(path.join(root, 'docs')))
    assert.ok(!fs.existsSync(path.join(root, 'CHANGELOG.md')))
  } finally { rm(root) }
})

test('symlink/junction 越界：文件范围经链接逃逸被拒绝（SYMLINK_ESCAPE）', function (t) {
  const { root } = tmpProject()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-out-'))
  try {
    const link = path.join(root, 'jump')
    let made = true
    try {
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    } catch (e) {
      made = false
    }
    if (!made) return t.skip('当前环境无法创建 symlink/junction')
    assert.throws(function () {
      W.createPlan({ projectRoot: root, id: 'escape', kind: 'f', summary: 's', files: ['jump/secret.txt'], acceptance: 'ok' })
    }, function (e) { return e.code === 'SYMLINK_ESCAPE' })
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'x', 'utf8')
    assert.throws(function () {
      W.createPlan({ projectRoot: root, id: 'escape2', kind: 'f', summary: 's', files: ['jump/secret.txt'], acceptance: 'ok' })
    }, function (e) { return e.code === 'SYMLINK_ESCAPE' })
  } finally { rm(root); rm(outside) }
})

test('批准后修订再以旧 hash 批准 → PLAN_HASH_MISMATCH（含锁内复核路径）', function () {
  const { root, profileRoot } = tmpProject()
  try {
    const r1 = planV1(root)
    const op = confirmFixtureOperator(root, profileRoot)
    approve(root, op, { planHash: r1.hash, refSeq: '0080' })
    const r2 = planV1(root, { summary: 'v2 修订' })
    assert.throws(function () {
      approve(root, op, { planHash: r1.hash, revision: 2, refSeq: '0081' })
    }, function (e) { return e.code === 'PLAN_HASH_MISMATCH' })
    assert.equal(r2.revision, 2)
  } finally { rm(root) }
})

test('appendEvent 拒绝非法 id / 未知类型；verifyAll 全绿通过', function () {
  const { root } = tmpProject()
  try {
    planV1(root)
    assert.throws(function () {
      W.appendEvent({ projectRoot: root, id: '../escape', type: 'note', details: {} })
    }, function (e) { return e.code === 'BAD_PLAN_ID' })
    assert.throws(function () {
      W.appendEvent({ projectRoot: root, id: 'demo-feature', type: 'not-a-type', details: {} })
    }, function (e) { return e.code === 'BAD_EVENT_TYPE' })
    W.appendEvent({ projectRoot: root, id: 'demo-feature', type: 'note', actor: '回归', details: { k: 1 } })
    const v = W.verifyAll({ projectRoot: root, id: 'demo-feature' })
    assert.ok(v.ok)
    assert.equal(v.plans.length, 1)
    assert.equal(v.chain.count, 2)
  } finally { rm(root) }
})
