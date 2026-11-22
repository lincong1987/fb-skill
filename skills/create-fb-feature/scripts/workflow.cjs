#!/usr/bin/env node
'use strict'

// workflow.cjs — FB Feature 计划/批准/审计门禁（CLI + 可导入 API）。
//
// 能力：
//   * createPlan：不可变计划版本（revision 递增、wx 独占创建），绑定
//     realpath 项目根 + 相对文件范围 + 验收条件，SHA-256 内容哈希；每次修订
//     产生新版本，旧批准不再授权新方案。
//   * recordApproval：已确认操作人 + 真实来源证据 → 独占锁内重验计划 hash
//     与审计链后追加 approval 事件（TOCTOU 防护）。
//   * assertApproved：门禁——当前修订必须有匹配 planHash 的批准事件，计划
//     文件与审计链未被篡改，项目根一致。
//   * appendEvent / verifyAudit / readWorkflow：追加式审计链（seq+prevHash+
//     hash）与纯日志推导的状态；不存在可被改写的 approved:true 状态文件。
//
// 定位与限制（README 需注明）：
//   * 这是本地防误操作与审计门禁，不冒充企业 IAM、数字签名或不可绕过的
//     安全边界；能绕开本工具直接写文件的人不在防护范围内。
//   * 审批证据检测的是「非空、肯定、非示例/模拟措辞 + 来源引用」，无法
//     鉴别宿主之外伪造的同文本消息；计划/档案均为本地 JSON，本地可篡改
//     （检测依赖内容哈希与日志链，重算链的本地篡改者不可检）。
//   * 本 CLI 不提供 auto-approve / test-approval 之类的旁路；fixture 身份
//     一律拒绝，不写入任何真实档案。
//
// 退出码：0 成功；2 严重拒绝（参数/校验/篡改/fixture/身份未确认/TTY 缺失）；
//         3 check 类命令处于「无批准」的正常业务状态。

const fs = require('fs')
const path = require('path')
const readline = require('readline')
const F = require('./lib/files.cjs')
const A = require('./lib/audit.cjs')
const I = require('./lib/identity.cjs')

const PLAN_SCHEMA = 'fb-feature-plan/v1'
const EVIDENCE_KINDS = ['user-message', 'terminal', 'host-plan']
const BENIGN_CHECK_CODES = ['PLAN_NOT_FOUND', 'NOT_APPROVED', 'SUPERSEDED']
const LIFECYCLE_STATUS = {
  'implementation-start': 'implementing',
  'implementation-complete': 'completed',
  'verification': 'verified',
  'blocked': 'blocked',
  'skipped': 'skipped'
}

function pathsFor (projectRoot, id) {
  const root = F.resolveRoot(projectRoot)
  F.assertSlug(id)
  return {
    root: root,
    dir: A.workflowDir(root, id),
    plansDir: A.plansDir(root, id),
    events: A.eventsPath(root, id),
    lock: A.lockPath(root, id)
  }
}

function listRevisions (plansDirReal) {
  let entries
  try {
    entries = fs.readdirSync(plansDirReal)
  } catch (e) {
    if (e.code === 'ENOENT') return []
    throw new F.FbError('READ_FAILED', '读取计划目录失败：' + F.firstLine(e.message))
  }
  const revs = []
  for (const name of entries) {
    const m = /^plan-v(\d+)\.json$/.exec(name)
    if (m) revs.push({ revision: parseInt(m[1], 10), file: path.join(plansDirReal, name) })
  }
  revs.sort(function (a, b) { return a.revision - b.revision })
  return revs
}

function requireText (value, field, maxLen) {
  const max = maxLen || 2000
  if (typeof value !== 'string' || !value.trim()) {
    throw new F.FbError('BAD_' + field.toUpperCase(), field + ' 必须是非空字符串')
  }
  const t = value.trim()
  if (t.length > max) throw new F.FbError('BAD_' + field.toUpperCase(), field + ' 过长（>' + max + '）')
  if (F.CONTROL_RE.test(t)) throw new F.FbError('BAD_' + field.toUpperCase(), field + ' 含控制字符')
  return t
}

function normalizeAcceptance (input) {
  const arr = Array.isArray(input) ? input : [input]
  if (!arr.length) throw new F.FbError('BAD_ACCEPTANCE', 'acceptance 不能为空')
  return arr.map(function (item, i) {
    if (typeof item !== 'string' || !item.trim()) {
      throw new F.FbError('BAD_ACCEPTANCE', 'acceptance 第 ' + (i + 1) + ' 项必须是非空字符串')
    }
    return item.trim()
  })
}

// 读取某工作流的（指定/最新）修订；重算内容 hash 判定是否被篡改。
// 不抛 NOT_FOUND 当整个工作流为空（返回 plan:null），便于 readWorkflow 报告 missing。
function loadPlan (rootReal, id, revision) {
  const revs = listRevisions(A.plansDir(rootReal, id))
  const latestRevision = revs.length ? revs[revs.length - 1].revision : null
  if (!revs.length) {
    if (revision) throw new F.FbError('PLAN_NOT_FOUND', '工作流 ' + id + ' 不存在修订 v' + revision)
    return { revisions: revs, latestRevision: null, plan: null, revision: null, file: null, hashOk: false }
  }
  const chosen = revision
    ? revs.find(function (r) { return r.revision === revision })
    : revs[revs.length - 1]
  if (!chosen) throw new F.FbError('PLAN_NOT_FOUND', '工作流 ' + id + ' 不存在修订 v' + revision)
  const parsed = F.readJson(chosen.file) // JSON 损坏 → PLAN_CORRUPT 之外再抛 JSON_CORRUPT（严重）
  const plan = parsed.value
  if (!plan || typeof plan !== 'object' || plan.schema !== PLAN_SCHEMA) {
    throw new F.FbError('PLAN_CORRUPT', '计划文件 schema 不符：' + chosen.file)
  }
  if (plan.id !== id) throw new F.FbError('PLAN_CORRUPT', '计划文件 id 与目录不一致：' + chosen.file)
  const recomputed = F.hashObject(F.withoutHash(plan))
  return {
    revisions: revs,
    latestRevision: latestRevision,
    plan: plan,
    revision: chosen.revision,
    file: chosen.file,
    recomputedHash: recomputed,
    hashOk: recomputed === plan.hash
  }
}

// 创建计划新修订。整个「排号→写文件→记事件」在独占锁内完成（可重入锁）。
function createPlan (opts) {
  const o = opts || {}
  const root = F.resolveRoot(o.projectRoot)
  const id = F.safeSlug(o.id)
  const kind = requireText(o.kind, 'kind', 40)
  const summary = requireText(o.summary, 'summary', 2000)
  if (!Array.isArray(o.files) || o.files.length === 0) {
    throw new F.FbError('BAD_FILES', 'files 必须是非空字符串数组（项目内相对路径，/ 分隔）')
  }
  const seen = new Set()
  const files = []
  for (const f of o.files) {
    const v = F.assertRelativeFileInRoot(root, f)
    if (!seen.has(v.rel)) {
      seen.add(v.rel)
      files.push(v.rel)
    }
  }
  const acceptance = normalizeAcceptance(o.acceptance)
  let metadata = o.metadata === undefined ? {} : o.metadata
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new F.FbError('BAD_METADATA', 'metadata 必须是对象')
  }
  const now = F.nowIso(o.now)
  return F.withLock(A.lockPath(root, id), function () {
    const checked = verifyAll({ projectRoot: root, id })
    if (!checked.chain.ok) throw new F.FbError('CHAIN_BROKEN', '既有审计链损坏，拒绝创建修订')
    if (!checked.ok) throw new F.FbError('PLAN_TAMPERED', '既有计划损坏，拒绝创建修订')
    const revs = listRevisions(A.plansDir(root, id))
    const revision = revs.length ? revs[revs.length - 1].revision + 1 : 1
    const body = {
      schema: PLAN_SCHEMA,
      id: id,
      revision: revision,
      kind: kind,
      summary: summary,
      files: files,
      acceptance: acceptance,
      metadata: metadata,
      projectRoot: root,
      createdAt: now.atLocal,
      createdAtUtc: now.at
    }
    const plan = Object.assign({}, body, { hash: F.hashObject(body) })
    const file = path.join(A.plansDir(root, id), 'plan-v' + revision + '.json')
    F.writeJsonImmutable(file, plan) // wx：不可变，冲突即失败
    // 事件追加失败时计划文件已存在但无事件（状态停留在 draft），可重试/如实报告。
    const rec = A.appendEvent({
      projectRoot: root,
      id: id,
      type: revision === 1 ? 'plan-created' : 'revision-created',
      actor: o.actor === undefined ? null : o.actor,
      details: { revision: revision, hash: plan.hash, kind: kind, files: files.length }
    })
    return {
      ok: true,
      id: id,
      revision: revision,
      hash: plan.hash,
      file: file,
      plan: plan,
      event: { seq: rec.seq, hash: rec.hash }
    }
  })
}

function hostScopeMatches (receipt, plan) {
  const scopes = receipt.scopes
  if (!Array.isArray(scopes)) return false
  return scopes.some(scope => scope && scope.id === plan.id && scope.kind === plan.kind &&
    scope.projectRoot === plan.projectRoot && scope.revision === plan.revision && scope.summary === plan.summary && Array.isArray(scope.files) &&
    F.hashObject(scope.files) === F.hashObject(plan.files) &&
    Array.isArray(scope.acceptance) && F.hashObject(scope.acceptance) === F.hashObject(plan.acceptance) &&
    scope.metadataHash === F.hashObject(Object.fromEntries(Object.entries(plan.metadata).filter(([key]) => key !== 'hostApproval'))))
}

// 记录批准。要求：已确认操作人（schema+确认块，host-plan 身份确认绑定本工程根）、
// 真实来源证据、planHash 匹配。
// fixture 一律拒绝；权威复核（计划 hash/根绑定）在锁内 guard 中执行（TOCTOU）。
function recordApproval (opts) {
  const o = opts || {}
  const root = F.resolveRoot(o.projectRoot)
  const id = F.assertSlug(o.id)
  if (o.fixture === true || (o.evidence && o.evidence.fixture === true)) {
    throw new F.FbError('FIXTURE_REJECTED', 'fixture/合成审批一律拒绝，不写入真实审计')
  }
  const op = o.operator
  const opv = I.validateOperatorSchema(op, { projectRoot: root })
  if (!opv.ok) throw new F.FbError(opv.code || 'OPERATOR_INVALID', 'operator 校验失败：' + opv.reason)
  if (op.profilePath) {
    const currentProfile = I.readProfileFile(op.profilePath)
    if (!currentProfile.exists || currentProfile.corrupt || currentProfile.hash !== op.profileHash) throw new F.FbError('OPERATOR_CHANGED', '操作人档案在确认后变化，拒绝批准')
  }
  const ev = o.evidence || {}
  if (!EVIDENCE_KINDS.includes(ev.kind)) {
    throw new F.FbError('EVIDENCE_KIND_INVALID', 'evidence.kind 必须是 user-message|terminal|host-plan')
  }
  if (typeof ev.reference !== 'string' || !ev.reference.trim() || ev.reference.length > 200 || F.CONTROL_RE.test(ev.reference)) {
    throw new F.FbError('SOURCE_REF_REQUIRED', 'evidence.reference 缺失或非法（human message id / terminal 引用）')
  }
  const tv = ev.kind === 'host-plan'
    ? I.validateHostApproval(ev.hostApproval, { projectRoot: root, displayName: op.name })
    : I.validateConfirmationText(ev.text)
  if (!tv.ok || ev.kind === 'host-plan' && (ev.text !== tv.text || ev.reference !== ev.hostApproval.reference || ev.derivedPlanHash !== o.planHash)) throw new F.FbError('EVIDENCE_TEXT_REJECTED', '批准证据被拒绝：' + (tv.reason || '宿主来源或派生方案 hash 不符'))
  const revision = o.revision === undefined ? undefined : o.revision
  if (revision !== undefined && (!Number.isInteger(revision) || revision < 1)) {
    throw new F.FbError('BAD_REVISION', 'revision 必须是正整数')
  }
  if (typeof o.planHash !== 'string' || !/^[0-9a-f]{64}$/.test(o.planHash)) {
    throw new F.FbError('BAD_PLAN_HASH', 'planHash 必须是 64 位十六进制（来自 createPlan 的 hash）')
  }
  // 预检（非权威）；权威复核在锁内 guard 中再执行一遍。
  const pre = loadPlan(root, id, revision)
  if (!pre.plan) throw new F.FbError('PLAN_NOT_FOUND', '工作流不存在：' + id)
  if (pre.revision !== pre.latestRevision) throw new F.FbError('SUPERSEDED', '旧修订已被替代，拒绝批准旧方案')
  if (o.planHash !== pre.plan.hash) {
    throw new F.FbError('PLAN_HASH_MISMATCH', 'planHash 与计划不符：期望 ' + pre.plan.hash + '，收到 ' + o.planHash, { expected: pre.plan.hash })
  }
  if (ev.kind === 'host-plan' && F.hashObject(pre.plan.metadata.hostApproval || {}) !== F.hashObject(ev.hostApproval)) throw new F.FbError('HOST_APPROVAL_MISMATCH', '派生方案未绑定该宿主批准记录')
  if (ev.kind === 'host-plan' && !hostScopeMatches(ev.hostApproval, pre.plan)) throw new F.FbError('HOST_APPROVAL_SCOPE_MISMATCH', '本地派生 scope 未绑定本计划；宿主只批准已展示的原方案')
  const rec = A.appendEvent({
    projectRoot: root,
    id: id,
    type: 'approval',
    actor: op.name,
    now: o.now,
    details: {
      revision: pre.revision,
      planHash: pre.plan.hash,
      operator: {
        schema: op.schema,
        status: op.status,
        fixture: false,
        name: op.name,
        email: op.email || null,
        scope: op.scope || null,
        profileHash: op.profileHash || null,
        confirmation: JSON.parse(JSON.stringify(op.confirmation))
      },
      evidence: { kind: ev.kind, reference: ev.reference.trim(), text: tv.text,
        ...(ev.kind === 'host-plan' ? { hostApproval: ev.hostApproval, derivedPlanHash: ev.derivedPlanHash } : {}) }
    },
    guard: function () {
      const lp = loadPlan(root, id, pre.revision)
      const checked = verifyAll({ projectRoot: root, id })
      if (!checked.ok) throw new F.FbError('PLAN_TAMPERED', '至少一份既有方案损坏，拒绝批准')
      if (op.profilePath) {
        const currentProfile = I.readProfileFile(op.profilePath)
        if (!currentProfile.exists || currentProfile.corrupt || currentProfile.hash !== op.profileHash) throw new F.FbError('OPERATOR_CHANGED', '批准前操作人档案变化，拒绝批准')
      }
      if (lp.latestRevision !== pre.revision) throw new F.FbError('SUPERSEDED', '批准前计划已修订，拒绝旧方案')
      if (!lp.plan || !lp.hashOk || lp.plan.hash !== pre.plan.hash) {
        throw new F.FbError('PLAN_TAMPERED', '锁内复核失败：计划文件在批准过程中被修改')
      }
      if (lp.plan.projectRoot !== root) {
        throw new F.FbError('ROOT_MISMATCH', '计划绑定其他项目根：' + lp.plan.projectRoot)
      }
    }
  })
  return { ok: true, event: rec, revision: pre.revision, planHash: pre.plan.hash, plan: pre.plan }
}

// 只认可含完整身份确认与批准证据的匹配事件，事件名本身不是批准。
function matchesApproval (record, plan, revision) {
  const details = record.details
  if (record.type !== 'approval' || !details || details.revision !== revision || details.planHash !== plan.hash) return false
  if (!I.validateOperatorSchema(details.operator, { projectRoot: plan.projectRoot }).ok || record.actor !== details.operator.name) return false
  const evidence = details.evidence
  if (evidence && evidence.kind === 'host-plan') {
    return evidence.fixture !== true && I.validateHostApproval(evidence.hostApproval, { projectRoot: plan.projectRoot, displayName: details.operator.name }).ok &&
      hostScopeMatches(evidence.hostApproval, plan) &&
      evidence.reference === evidence.hostApproval.reference && evidence.text === evidence.hostApproval.resultText &&
      evidence.derivedPlanHash === plan.hash && F.hashObject(plan.metadata.hostApproval || {}) === F.hashObject(evidence.hostApproval)
  }
  return !!(evidence && evidence.fixture !== true && EVIDENCE_KINDS.includes(evidence.kind) &&
    typeof evidence.reference === 'string' && evidence.reference.trim() && evidence.reference.length <= 200 &&
    !F.CONTROL_RE.test(evidence.reference) && I.validateConfirmationText(evidence.text).ok)
}

function verificationStatus (details) {
  const result = details.status || details.result
  if (details.ok === false || result === 'fail' || details.exitCode !== undefined && details.exitCode !== 0) return 'blocked'
  if (result === 'skipped' || result === 'not-run') return 'skipped'
  if ((details.ok === true || result === 'pass') && typeof details.evidence === 'string' && details.evidence.trim()) return 'verified'
  return 'completed'
}

function appendEvent (input) {
  if (!input || !A.CLI_ALLOWED_EVENT_TYPES.includes(input.type)) throw new F.FbError('BAD_EVENT_TYPE', '公开事件接口只接受非批准类事件；批准必须经 recordApproval')
  const root = F.resolveRoot(input.projectRoot)
  const id = F.assertSlug(input.id)
  return F.withLock(A.lockPath(root, id), function () {
    let details = input.details === undefined ? {} : input.details
    if (!details || typeof details !== 'object' || Array.isArray(details)) throw new F.FbError('BAD_DETAILS', '事件 details 必须是对象')
    if (['implementation-start', 'implementation-complete', 'verification'].includes(input.type)) {
      const plan = assertApproved({ projectRoot: root, id })
      if (details.revision !== undefined && details.revision !== plan.revision || details.planHash !== undefined && details.planHash !== plan.hash) throw new F.FbError('SUPERSEDED', '事件绑定的方案不是当前批准版本')
      if (input.type === 'verification' && (details.ok === true || details.status === 'pass' || details.result === 'pass') && verificationStatus(details) !== 'verified') throw new F.FbError('BAD_VERIFICATION', '通过声明需要证据且退出码不能非零')
      details = Object.assign({}, details, { revision: plan.revision, planHash: plan.hash })
    }
    return A.appendEvent(Object.assign({}, input, { projectRoot: root, id, details }))
  })
}

// 门禁断言：返回已批准的当前计划；任何不满足都以 FbError 抛出。
function assertApproved (opts) {
  const o = opts || {}
  const root = F.resolveRoot(o.projectRoot)
  const id = F.assertSlug(o.id)
  const lp = loadPlan(root, id, o.revision)
  if (!lp.plan) throw new F.FbError('PLAN_NOT_FOUND', '工作流不存在：' + id)
  const all = verifyAll({ projectRoot: root, id })
  if (!all.chain.ok) throw new F.FbError('CHAIN_BROKEN', '审计链损坏，拒绝使用批准')
  if (!all.ok) throw new F.FbError('PLAN_TAMPERED', '至少一份历史方案损坏，拒绝使用批准')
  if (lp.plan.projectRoot !== root) {
    throw new F.FbError('ROOT_MISMATCH', '计划绑定其他项目根（复制/移动目录不延续批准）：' + lp.plan.projectRoot)
  }
  if (!lp.hashOk) throw new F.FbError('PLAN_TAMPERED', '计划文件与自身 hash 不符（疑似篡改）：' + lp.file)
  if (o.kind !== undefined && o.kind !== lp.plan.kind) {
    throw new F.FbError('KIND_MISMATCH', 'kind 不匹配：计划 ' + lp.plan.kind + '，请求 ' + o.kind)
  }
  const audit = A.readAuditRecords(root, id)
  const chain = A.verifyChain(audit.records)
  if (!chain.ok) throw new F.FbError('CHAIN_BROKEN', '审计链校验失败：' + chain.errors.join('；'))
  if (o.revision !== undefined && o.revision !== lp.latestRevision) {
    throw new F.FbError('SUPERSEDED', '修订 v' + o.revision + ' 已被 v' + lp.latestRevision + ' 取代，旧批准不再授权新方案')
  }
  const approvals = audit.records.filter(function (r) {
    return matchesApproval(r, lp.plan, lp.revision)
  })
  if (!approvals.length) {
    throw new F.FbError('NOT_APPROVED', '工作流 ' + id + ' v' + lp.revision + ' 没有有效批准')
  }
  return lp.plan
}

// 读状态：全部由不可变计划 + 审计日志推导，无独立可改写的状态文件。
function readWorkflow (opts) {
  const o = opts || {}
  const root = F.resolveRoot(o.projectRoot)
  const id = F.assertSlug(o.id)
  const lp = loadPlan(root, id, o.revision)
  const audit = A.readAuditRecords(root, id)
  const chain = A.verifyChain(audit.records)
  const approvals = []
  const events = []
  for (const r of audit.records) {
    events.push({ seq: r.seq, type: r.type, actor: r.actor, at: r.at, atLocal: r.atLocal, hash: r.hash })
    if (r.type !== 'approval') continue
    approvals.push({
      seq: r.seq,
      actor: r.actor,
      revision: r.details ? r.details.revision : null,
      planHash: r.details ? r.details.planHash : null,
      evidenceReference: r.details && r.details.evidence ? r.details.evidence.reference : null,
      evidenceKind: r.details && r.details.evidence ? r.details.evidence.kind : null,
      at: r.at,
      atLocal: r.atLocal,
      valid: !!(lp.plan && matchesApproval(r, lp.plan, lp.revision))
    })
  }
  const revisionSummaries = []
  for (const r of lp.revisions) {
    const parsed = F.readJson(r.file)
    const p = parsed.exists && parsed.value && typeof parsed.value === 'object' ? parsed.value : null
    revisionSummaries.push({
      revision: r.revision,
      file: r.file,
      hash: p ? p.hash : null,
      hashOk: p ? F.hashObject(F.withoutHash(p)) === p.hash : false,
      createdAt: p ? p.createdAt : null,
      kind: p ? p.kind : null
    })
  }
  let status = 'missing'
  let validApproval = null
  if (lp.plan && lp.hashOk && lp.plan.projectRoot === root && chain.ok && lp.revision === lp.latestRevision && revisionSummaries.every(r => r.hashOk)) {
    const matches = approvals.filter(function (a) {
      return a.valid
    })
    if (matches.length) {
      validApproval = matches[matches.length - 1]
      status = 'approved'
    } else {
      status = 'draft'
    }
    if (validApproval) {
      for (const r of audit.records) {
        if (r.seq <= validApproval.seq || r.details && (r.details.revision !== undefined && r.details.revision !== lp.revision || r.details.planHash !== undefined && r.details.planHash !== lp.plan.hash)) continue
        if (r.type === 'verification') {
          status = verificationStatus(r.details || {})
        } else if (LIFECYCLE_STATUS[r.type]) status = LIFECYCLE_STATUS[r.type]
      }
    }
  } else if (lp.plan) status = 'blocked'
  return {
    ok: true,
    id: id,
    root: root,
    exists: !!lp.plan,
    latestRevision: lp.latestRevision,
    revision: lp.revision,
    plan: lp.plan,
    file: lp.file,
    hashOk: lp.hashOk,
    chain: { ok: chain.ok, count: chain.count, headHash: chain.headHash, errors: chain.errors },
    approvals: approvals,
    validApproval: validApproval,
    status: status,
    events: events,
    revisions: revisionSummaries
  }
}

// 完整校验：审计链 + 每个修订的计划文件 hash。
function verifyAll (opts) {
  const o = opts || {}
  const root = F.resolveRoot(o.projectRoot)
  const id = F.assertSlug(o.id)
  const chain = A.verifyAudit({ projectRoot: root, id: id })
  const plans = []
  for (const r of listRevisions(A.plansDir(root, id))) {
    const parsed = F.readJson(r.file)
    const p = parsed.exists && parsed.value && typeof parsed.value === 'object' ? parsed.value : null
    const ok = !!(p && p.schema === PLAN_SCHEMA && p.id === id && p.revision === r.revision && F.hashObject(F.withoutHash(p)) === p.hash)
    plans.push({ revision: r.revision, ok: ok, hash: p ? p.hash : null, file: r.file })
  }
  return {
    ok: chain.ok && plans.every(function (p) { return p.ok }),
    chain: chain,
    plans: plans
  }
}

// 由 readWorkflow 结果渲染 Markdown 报告（只读；不写任何文件，除显式 --out）。
function renderReport (wf) {
  const lines = []
  const plan = wf.plan
  lines.push('# FB Feature 工作流报告：' + wf.id)
  lines.push('')
  lines.push('- 项目根：`' + wf.root + '`')
  if (plan) {
    lines.push('- 类型：' + plan.kind)
    lines.push('- 状态：' + wf.status)
    lines.push('- 最新修订：v' + plan.revision + '（hash `' + String(plan.hash).slice(0, 12) + '`）')
    lines.push('- 创建时间：' + plan.createdAt)
  } else {
    lines.push('- 状态：missing（尚无计划）')
  }
  lines.push('- 审计链：' + (wf.chain.ok ? '完整' : '损坏') + '（' + wf.chain.count + ' 条事件，head `' + String(wf.chain.headHash).slice(0, 12) + '`）')
  lines.push('- 生成时间：' + F.nowIso().atLocal)
  lines.push('')
  lines.push('> 说明：本报告由本地门禁工具从 `.agents/fb-feature/workflows/' + wf.id + '/` 的不可变计划与追加式审计日志推导；')
  lines.push('> 这是本地防误操作与审计门禁，不代表企业 IAM、数字签名或不可绕过的安全边界；')
  lines.push('> 本工具不会自动改写 docs/features 或 CHANGELOG。')
  lines.push('')
  if (plan) {
    lines.push('## 摘要')
    lines.push('')
    lines.push(plan.summary)
    lines.push('')
    lines.push('## 文件范围（' + plan.files.length + '）')
    lines.push('')
    for (const f of plan.files) lines.push('- `' + f + '`')
    lines.push('')
    lines.push('## 验收条件')
    lines.push('')
    plan.acceptance.forEach(function (a, i) { lines.push(String(i + 1) + '. ' + a) })
    lines.push('')
    lines.push('## 修订历史')
    lines.push('')
    for (const r of wf.revisions) {
      lines.push('- v' + r.revision + ' · hash `' + String(r.hash).slice(0, 12) + '`' + (r.hashOk ? '' : '（文件被篡改！）') + ' · ' + (r.createdAt || '') + ' · ' + (r.kind || ''))
    }
    lines.push('')
    lines.push('## 批准记录')
    lines.push('')
    if (!wf.approvals.length) lines.push('（无批准记录）')
    for (const a of wf.approvals) {
      lines.push('- v' + a.revision + ' · ' + (a.actor || '?') + ' · ' + a.atLocal + ' · 来源 `' + (a.evidenceReference || '?') + '`（' + a.evidenceKind + '）· planHash `' + String(a.planHash).slice(0, 12) + '`' + (wf.validApproval && a.seq === wf.validApproval.seq ? '（当前有效）' : ''))
    }
  }
  lines.push('')
  lines.push('## 事件流水')
  lines.push('')
  lines.push('| seq | 时间(本地) | 类型 | 操作者 |')
  lines.push('| --- | --------- | ---- | ------ |')
  for (const r of wf.events) {
    lines.push('| ' + r.seq + ' | ' + r.atLocal + ' | ' + r.type + ' | ' + (r.actor === null || r.actor === undefined ? '-' : String(r.actor)) + ' |')
  }
  lines.push('')
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const CLI_SPECS = {
  plan: {
    flags: { '--project-root': 1, '--input': 1, '--id': 1, '--profile-root': 1 },
    required: ['--project-root', '--input']
  },
  approve: {
    flags: { '--project-root': 1, '--id': 1, '--revision': 1, '--plan-hash': 1, '--evidence-text': 1, '--source-ref': 1, '--evidence-kind': 1, '--host-approval': 1, '--profile-root': 1 },
    required: ['--project-root', '--id', '--plan-hash']
  },
  check: {
    flags: { '--project-root': 1, '--id': 1, '--kind': 1, '--revision': 1 },
    required: ['--project-root', '--id']
  },
  event: {
    flags: { '--project-root': 1, '--id': 1, '--type': 1, '--details': 1, '--actor': 1, '--profile-root': 1 },
    required: ['--project-root', '--id', '--type', '--details']
  },
  verify: {
    flags: { '--project-root': 1, '--id': 1 },
    required: ['--project-root', '--id']
  },
  report: {
    flags: { '--project-root': 1, '--id': 1, '--out': 1 },
    required: ['--project-root', '--id']
  }
}

const USAGE = [
  '用法：node workflow.cjs <command> [options]',
  '',
  '命令：',
  '  plan    --project-root <dir> --input <file|-> [--id <slug>] [--profile-root <dir>]',
  '          input JSON: { "id", "kind", "summary", "files": ["相对/路径", ...],',
  '                        "acceptance": [...] | "…", "metadata": {} }',
  '          id 可来自 --id 或 input.id；两者同时给出且不一致则报错。',
  '  approve --project-root <dir> --id <slug> --plan-hash <64hex>',
  '          (--evidence-text "<用户确认原话>" --source-ref "<消息ID/terminal:引用>"',
  '           | --evidence-kind terminal   # 仅真实 TTY 交互反问，不能免确认自批准)',
  '          [--revision <n>] [--profile-root <dir>]',
  '          或 --evidence-kind host-plan --host-approval <根内真实宿主结果.json>',
  '  check   --project-root <dir> --id <slug> [--kind <k>] [--revision <n>]',
  '  event   --project-root <dir> --id <slug> --type <note|implementation-start|',
  '          implementation-complete|verification|blocked|skipped> --details <JSON|@file>',
  '          [--actor <name>] [--profile-root <dir>]   # approval 不可经此伪造',
  '  verify  --project-root <dir> --id <slug>',
  '  report  --project-root <dir> --id <slug> [--out <file>]   # --out 已存在即拒绝',
  '',
  '退出码：0 成功；2 严重拒绝（参数/校验/篡改/fixture/身份未确认/TTY 缺失）；',
  '        3 check 处于「无批准」状态（PLAN_NOT_FOUND / NOT_APPROVED / SUPERSEDED）。',
  '说明：本地防误操作与审计门禁，非企业 IAM/数字签名/硬隔离；审批证据检测',
  '      无法鉴别宿主外伪造的同文本消息。',
  ''
].join('\n')

// 严格解析：未知/重复/缺参即抛；支持 --flag value 与 --flag=value。
function parseCliArgs (argv, spec) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    let name = raw
    let inlineValue
    const eq = raw.indexOf('=')
    if (eq > 2) {
      name = raw.slice(0, eq)
      inlineValue = raw.slice(eq + 1)
    }
    if (!(name in spec.flags)) throw new F.FbError('UNKNOWN_ARG', '未知参数：' + raw)
    if (name in out) throw new F.FbError('DUP_ARG', '重复参数：' + name)
    if (spec.flags[name] === 0) {
      if (inlineValue !== undefined) throw new F.FbError('BAD_ARG', name + ' 不接受取值')
      out[name] = true
      continue
    }
    const value = inlineValue !== undefined ? inlineValue : argv[++i]
    if (value === undefined || value === '' || value.startsWith('--')) throw new F.FbError('MISSING_VALUE', name + ' 缺少取值')
    out[name] = value
  }
  for (const req of spec.required) {
    if (!(req in out)) throw new F.FbError('MISSING_ARG', '缺少参数：' + req)
  }
  return out
}

function optionalInt (args, name) {
  if (args[name] === undefined) return undefined
  if (!/^[1-9]\d*$/.test(args[name])) throw new F.FbError('BAD_REVISION', name + ' 必须是正整数')
  const n = Number(args[name])
  if (!Number.isSafeInteger(n)) throw new F.FbError('BAD_REVISION', name + ' 必须是安全正整数')
  return n
}

function loadIdentityFor (args) {
  return I.loadIdentity({ projectRoot: args['--project-root'], profileRoot: args['--profile-root'] })
}

function cmdPlan (args) {
  let inputRaw
  if (args['--input'] === '-') {
    inputRaw = fs.readFileSync(0, 'utf8')
  } else {
    inputRaw = fs.readFileSync(args['--input'], 'utf8')
  }
  let input
  try {
    input = JSON.parse(inputRaw)
  } catch (e) {
    throw new F.FbError('BAD_INPUT', '--input JSON 解析失败：' + F.firstLine(e.message))
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new F.FbError('BAD_INPUT', '--input 顶层必须是 JSON 对象')
  }
  let planId = input.id
  if (args['--id'] !== undefined) {
    if (planId !== undefined && F.safeSlug(planId) !== F.safeSlug(args['--id'])) {
      throw new F.FbError('BAD_INPUT', '--id 与 input.id 不一致：' + JSON.stringify(args['--id']) + ' vs ' + JSON.stringify(planId))
    }
    planId = args['--id']
  }
  const ident = loadIdentityFor(args)
  const result = createPlan({
    projectRoot: args['--project-root'],
    id: planId,
    kind: input.kind,
    summary: input.summary,
    files: input.files,
    acceptance: input.acceptance,
    metadata: input.metadata,
    actor: ident.operator ? ident.operator.name : null
  })
  return { ok: true, id: result.id, revision: result.revision, hash: result.hash, file: result.file }
}

function cmdApprove (args) {
  const root = args['--project-root']
  const ident = loadIdentityFor(args)
  if (!ident.operator) {
    throw new F.FbError('OPERATOR_NOT_CONFIRMED', '没有有效操作人档案，拒绝批准。请先核对实际 --project-root，并运行 node resolve-identity.cjs --project-root <dir> 查看档案与候选；仅无有效档案时首次确认显示名后 --save 一次，有效档案直接复用。身份登记不代替当前方案批准。')
  }
  const kind = args['--evidence-kind'] === undefined ? 'user-message' : args['--evidence-kind']
  const revision = optionalInt(args, '--revision')
  if (kind === 'terminal') {
    if (args['--evidence-text'] !== undefined || args['--source-ref'] !== undefined) {
      throw new F.FbError('BAD_ARGS', 'terminal 模式在真实 TTY 上交互采集确认语句，不接受 --evidence-text/--source-ref')
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new F.FbError('TTY_REQUIRED', 'terminal 模式需要真实 TTY 交互；非交互场景请用 --evidence-kind user-message --evidence-text "<消息原文>" --source-ref "<消息ID>"（不能免确认自批准）')
    }
    const lp = loadPlan(F.resolveRoot(root), F.assertSlug(args['--id']), revision)
    if (!lp.plan) throw new F.FbError('PLAN_NOT_FOUND', '工作流不存在：' + args['--id'])
    fs.writeSync(2, '待批准计划 v' + lp.revision + '（hash ' + lp.plan.hash.slice(0, 12) + '）：' + lp.plan.summary + '\n')
    fs.writeSync(2, '文件范围：' + lp.plan.files.join(', ') + '\n')
    const ask = new Promise(function (resolve) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
      rl.question('请输入批准语句（需包含 确认/同意/批准 等肯定词）：', function (answer) {
        rl.close()
        resolve(answer)
      })
    })
    return ask.then(function (answer) {
      const now = F.nowIso()
      return recordApproval({
        projectRoot: root,
        id: args['--id'],
        revision: revision,
        planHash: args['--plan-hash'],
        operator: ident.operator,
        evidence: { kind: 'terminal', reference: 'terminal:' + now.atLocal, text: answer }
      })
    })
  }
  if (kind === 'host-plan') {
    if (!args['--host-approval'] || args['--evidence-text'] !== undefined || args['--source-ref'] !== undefined) throw new F.FbError('BAD_ARGS', 'host-plan 仅接受 --host-approval 根内真实批准记录，不接受聊天证据参数')
    const receipt = F.readJson(F.assertRelativeFileInRoot(F.resolveRoot(root), args['--host-approval']).abs).value
    return recordApproval({ projectRoot: root, id: args['--id'], revision,
      planHash: args['--plan-hash'], operator: ident.operator,
      evidence: { kind, reference: receipt && receipt.reference, text: receipt && receipt.resultText,
        hostApproval: receipt, derivedPlanHash: args['--plan-hash'] } })
  }
  if (kind !== 'user-message') {
    throw new F.FbError('EVIDENCE_KIND_INVALID', '--evidence-kind 只支持 user-message|terminal|host-plan')
  }
  if (args['--evidence-text'] === undefined) {
    throw new F.FbError('MISSING_ARG', 'user-message 模式需要 --evidence-text（真实用户消息原文）')
  }
  if (args['--source-ref'] === undefined) {
    throw new F.FbError('MISSING_ARG', 'user-message 模式需要 --source-ref（human message id）')
  }
  const r = recordApproval({
    projectRoot: root,
    id: args['--id'],
    revision: revision,
    planHash: args['--plan-hash'],
    operator: ident.operator,
    evidence: { kind: 'user-message', reference: args['--source-ref'], text: args['--evidence-text'] }
  })
  return { ok: true, id: args['--id'], revision: r.revision, planHash: r.planHash, actor: r.event.actor, seq: r.event.seq }
}

function cmdCheck (args) {
  const revision = optionalInt(args, '--revision')
  const plan = assertApproved({
    projectRoot: args['--project-root'],
    id: args['--id'],
    revision: revision,
    kind: args['--kind']
  })
  const wf = readWorkflow({ projectRoot: args['--project-root'], id: args['--id'] })
  return { ok: true, approved: true, id: plan.id, revision: plan.revision, hash: plan.hash, kind: plan.kind, status: wf.status }
}

function cmdEvent (args) {
  const type = args['--type']
  if (!A.CLI_ALLOWED_EVENT_TYPES.includes(type)) {
    throw new F.FbError('BAD_EVENT_TYPE', 'event 命令只允许非批准类事件：' + A.CLI_ALLOWED_EVENT_TYPES.join(', ') + '（approval/plan-created/revision-created 由工具内部产生，不可经 CLI 伪造）')
  }
  let detailsRaw = args['--details']
  if (detailsRaw.charAt(0) === '@') {
    const root = F.resolveRoot(args['--project-root'])
    const file = F.assertRelativeFileInRoot(root, detailsRaw.slice(1)).abs
    F.assertNoLinks(file)
    detailsRaw = fs.readFileSync(file, 'utf8')
  }
  let details
  try {
    details = JSON.parse(detailsRaw)
  } catch (e) {
    throw new F.FbError('BAD_DETAILS', '--details JSON 解析失败：' + F.firstLine(e.message))
  }
  if (details === null || typeof details !== 'object' || Array.isArray(details)) {
    throw new F.FbError('BAD_DETAILS', '--details 必须是 JSON 对象')
  }
  const ident = loadIdentityFor(args)
  const actor = args['--actor'] !== undefined ? args['--actor'] : (ident.operator ? ident.operator.name : null)
  if (['implementation-start', 'implementation-complete', 'verification'].includes(type)) {
    const plan = assertApproved({ projectRoot: args['--project-root'], id: args['--id'] })
    details = Object.assign({}, details, { revision: plan.revision, planHash: plan.hash })
  }
  const rec = appendEvent({
    projectRoot: args['--project-root'],
    id: args['--id'],
    type: type,
    actor: actor,
    details: details
  })
  return { ok: true, event: { seq: rec.seq, hash: rec.hash, type: rec.type } }
}

function cmdVerify (args) {
  const v = verifyAll({ projectRoot: args['--project-root'], id: args['--id'] })
  return {
    ok: v.ok,
    chain: { ok: v.chain.ok, count: v.chain.count, headHash: v.chain.headHash, errors: v.chain.errors },
    plans: v.plans
  }
}

function cmdReport (args) {
  const wf = readWorkflow({ projectRoot: args['--project-root'], id: args['--id'] })
  const md = renderReport(wf)
  if (args['--out'] !== undefined) {
    const outputRoot = F.resolveRoot(args['--project-root'])
    const absolute = path.resolve(outputRoot, args['--out'])
    const relative = path.relative(outputRoot, absolute).split(path.sep).join('/')
    F.assertRelativeFileInRoot(outputRoot, relative)
    F.writeTextExclusive(absolute, md)
    return { ok: true, id: wf.id, out: absolute, status: wf.status }
  }
  return { __markdown: true, markdown: md }
}

function emit (obj) {
  fs.writeSync(1, JSON.stringify(obj) + '\n')
}

function main () {
  const argv = process.argv.slice(2)
  const command = argv[0]
  if (command === undefined || command === '--help' || command === '-h') {
    fs.writeSync(1, USAGE)
    if (command === undefined) process.exit(2)
    return
  }
  if (!(command in CLI_SPECS)) {
    emit({ ok: false, code: 'UNKNOWN_COMMAND', error: '未知命令：' + command + '；可用：' + Object.keys(CLI_SPECS).join(', ') })
    process.exit(2)
    return
  }
  if (argv.length === 2 && argv[1] === '--help') {
    fs.writeSync(1, USAGE)
    return
  }
  let args
  try {
    args = parseCliArgs(argv.slice(1), CLI_SPECS[command])
  } catch (e) {
    emit({ ok: false, code: e.code, error: e.message, details: e.details })
    process.exit(2)
    return
  }
  let result
  try {
    if (command === 'plan') result = cmdPlan(args)
    else if (command === 'approve') result = cmdApprove(args)
    else if (command === 'check') result = cmdCheck(args)
    else if (command === 'event') result = cmdEvent(args)
    else if (command === 'verify') result = cmdVerify(args)
    else if (command === 'report') result = cmdReport(args)
  } catch (e) {
    const benign = command === 'check' && BENIGN_CHECK_CODES.includes(e.code)
    const out = { ok: false, code: e.code || 'ERROR', error: e.message, details: e.details }
    if (command === 'check') out.approved = false
    emit(out)
    process.exit(benign ? 3 : 2)
    return
  }
  Promise.resolve(result).then(function (r) {
    if (r && r.__markdown) {
      fs.writeSync(1, r.markdown)
      return
    }
    emit(r)
    if (r && r.ok === false) process.exitCode = 2
  }).catch(function (e) {
    const out = { ok: false, code: e.code || 'ERROR', error: e.message, details: e.details }
    if (command === 'check') out.approved = false
    const benign = command === 'check' && BENIGN_CHECK_CODES.includes(e.code)
    emit(out)
    process.exit(benign ? 3 : 2)
  })
}

if (require.main === module) main()

module.exports = {
  FbError: F.FbError,
  PLAN_SCHEMA: PLAN_SCHEMA,
  EVIDENCE_KINDS: EVIDENCE_KINDS,
  KNOWN_EVENT_TYPES: A.KNOWN_EVENT_TYPES,
  CLI_ALLOWED_EVENT_TYPES: A.CLI_ALLOWED_EVENT_TYPES,
  slugify: F.safeSlug,
  assertSlug: F.assertSlug,
  canonicalJson: F.canonicalJson,
  hashObject: F.hashObject,
  withoutHash: F.withoutHash,
  pathsFor: pathsFor,
  listRevisions: listRevisions,
  loadPlan: loadPlan,
  createPlan: createPlan,
  recordApproval: recordApproval,
  assertApproved: assertApproved,
    appendEvent: appendEvent,
  readWorkflow: readWorkflow,
  verifyAudit: A.verifyAudit,
  verifyAll: verifyAll,
  renderReport: renderReport,
  CLI_SPECS: CLI_SPECS,
  parseCliArgs: parseCliArgs,
  main: main
}
