#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')
const I = require('../skills/create-fb-feature/scripts/lib/identity.cjs')
const W = require('../skills/create-fb-feature/scripts/workflow.cjs')
const E = require('./eval-reverse-requirements.cjs')

// 本轮宿主确实返回的批准结果。来源索引使用实际会话计划引用，不冒充聊天消息ID。
const ROOT = path.resolve(__dirname, '..')
const SOURCE_PLAN = 'D:/projects/fb-rules/.zcode/plans/plan-sess_bb4bb986-9bb0-4645-90f0-c1c30aecf7ca.md'
const RECEIPT_REL = '.agents/fb-feature/host-approvals/release-validation-20261122.json'
const CASE = 'evals/reverse-requirements/smsnotice-release'
const ID = 'smsnotice-release-20261122'

function main() {
  const root = F.resolveRoot(ROOT)
  F.assertNoLinks(SOURCE_PLAN)
  const planText = fs.readFileSync(SOURCE_PLAN, 'utf8')
  if (F.sha256Hex(planText) !== 'e3112e515ba2d79878e6ba6837cc60e3d100bff183a76c95dd32bd192d4dcd9c') throw new F.FbError('HOST_PLAN_CHANGED', '宿主计划已不是本轮批准范围')
  const receipt = {
    schema: 'fb-host-plan-approval/v1', host: 'zcode', sourceTool: 'ExitPlanMode',
    reference: 'zcode:ExitPlanMode:plan-sess_bb4bb986-9bb0-4645-90f0-c1c30aecf7ca:release-validation-20261122',
    resultText: I.HOST_PLAN_RESULT, projectRoot: root, displayName: '当前请求人',
    planText, planTextHash: F.sha256Hex(planText), recordedAt: F.nowIso().atLocal
  }
  receipt.hash = F.hashObject(receipt)
  const receiptPath = F.assertRelativeFileInRoot(root, RECEIPT_REL).abs
  F.writeJsonImmutable(receiptPath, receipt)
  let operator = I.loadIdentity({ projectRoot: root }).operator
  if (!operator) {
    I.saveProfile({ projectRoot: root, name: receipt.displayName, method: 'host-plan',
      confirmationText: receipt.resultText, sourceRef: receipt.reference, hostApproval: receipt })
    operator = I.loadIdentity({ projectRoot: root }).operator
  }
  if (!operator) throw new F.FbError('OPERATOR_NOT_CONFIRMED', '没有有效操作人')
  const source = path.join(root, 'evals/reverse-requirements/smsnotice')
  const directory = F.assertRelativeFileInRoot(root, CASE + '/requirements.md').abs
  const contracts = JSON.parse(fs.readFileSync(path.join(source, 'contracts.json'), 'utf8'))
  contracts.status = 'host-approved-mock-evaluation'
  const c10 = contracts.rules.find(rule => rule.id === 'C10')
  c10.controlApi = {
    global: 'window.__smsnoticeMock',
    methods: {
      reset: 'reset(): restore mockNotices/permissions/counters/modes/stale=false; does not itself query or remount UI',
      setMode: "setMode(operation, mode, delayMs=0): operation list/view/add/update/delete/fileByReferId; mode success/business-failure/reject",
      setPermissions: 'setPermissions(codes): exact permission-code string array; updates reactive permission state',
      setStaleDetail: 'setStaleDetail(enabled): true makes MOCK-N001 draft list row return published detail',
      snapshot: 'snapshot(): deep JSON copy {counters,requests,notices,permissions,modes,staleDetail}; requests record operation/method/path/params or data/outcome'
    },
    boundary: 'These local diagnostic methods are not business APIs. No real backend, native file picker or external preview. Direct UI handler calls are only for checking permission protection.'
  }
  const confirmedAt = F.nowIso().atLocal
  for (const decision of contracts.decisions) {
    decision.status = 'confirmed'
    decision.confirmation = { decisionId: decision.id,
      decisionHash: F.hashObject({ id: decision.id, requirementIds: decision.requirementIds || [], proposal: decision.proposal }),
      kind: 'host-plan', reference: receipt.reference, text: receipt.resultText,
      confirmedAt, operator, hostApproval: receipt }
  }
  const requirements = fs.readFileSync(path.join(source, 'requirements.md'), 'utf8')
    .replace('# 公告管理对照试点需求 · v1（待确认）', '# 公告管理对照试点需求 · 本轮已批准')
    .replace('下面的试点约定尚未获得需求确认，不因总体安排获批就开始生成。', '本轮宿主计划明确确认以下试点规则与生成范围；仍仅为本地mock演练。')
    .replace(/（后两项为试点建议，待确认。）/g, '（本轮已确认。）')
    .replace(/待确认/g, '本轮已确认')
    .replace('## R12 本轮已确认的试点选择', '## R12 本轮已确认的试点选择')
  F.writeTextExclusive(directory, requirements)
  F.writeJsonImmutable(path.join(path.dirname(directory), 'contracts.json'), contracts)
  for (const name of ['acceptance.json', 'evidence.json']) {
    F.assertNoLinks(path.join(source, name))
    F.writeTextExclusive(path.join(path.dirname(directory), name), fs.readFileSync(path.join(source, name), 'utf8'))
  }
  const generation = JSON.parse(fs.readFileSync(path.join(source, 'generation-scope.json'), 'utf8'))
  generation.status = 'host-approved-isolated-generation'
  F.writeJsonImmutable(path.join(path.dirname(directory), 'generation-scope.json'), generation)
  const prepared = E.prepareEvaluation({ projectRoot: root, caseDir: CASE, id: ID, generation, hostApproval: receipt })
  W.recordApproval({ projectRoot: root, id: ID, planHash: prepared.planHash, operator,
    evidence: { kind: 'host-plan', reference: receipt.reference, text: receipt.resultText,
      hostApproval: receipt, derivedPlanHash: prepared.planHash } })
  const checked = E.checkEvaluation({ projectRoot: root, id: ID })
  if (!checked.ready) throw new F.FbError('EVALUATION_NOT_READY', JSON.stringify(checked.blockers))
  fs.writeSync(1, JSON.stringify({ prepared, checked, receipt: receiptPath, operator: operator.name }) + '\n')
}

if (require.main === module) {
  try { main() } catch (error) { fs.writeSync(2, JSON.stringify({ code: error.code, error: error.message }) + '\n'); process.exitCode = 2 }
}
