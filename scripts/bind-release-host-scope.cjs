#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')
const I = require('../skills/create-fb-feature/scripts/lib/identity.cjs')
const W = require('../skills/create-fb-feature/scripts/workflow.cjs')
const E = require('./eval-reverse-requirements.cjs')

// 已批准同一试点的精确范围补绑定；原receipt与plan保留，不制作新的人点击。
function bind() {
  const root = F.resolveRoot(path.resolve(__dirname, '..'))
  const id = 'smsnotice-release-20261122'
  const workflow = W.readWorkflow({ projectRoot: root, id })
  if (workflow.revision !== 2) throw new Error('This one-off revision binding only applies to the reviewed scope revision')
  const receipt = workflow.plan.metadata.hostApproval
  const original = { ...receipt }
  if (!I.validateHostApproval(receipt, { projectRoot: root }).ok) throw new Error('Missing original host result')
  if (receipt.planTextHash !== 'e3112e515ba2d79878e6ba6837cc60e3d100bff183a76c95dd32bd192d4dcd9c') throw new Error('Not the reviewed host plan')
  const metadata = { ...workflow.plan.metadata }
  delete metadata.hostApproval
  const scoped = { ...F.withoutHash(receipt), scopes: [{
    id, kind: workflow.plan.kind, revision: workflow.revision + 1, summary: workflow.plan.summary,
    projectRoot: root, files: workflow.plan.files,
    acceptance: workflow.plan.acceptance, metadataHash: F.hashObject(metadata)
  }], derivedFrom: { receiptHash: original.hash, reason: 'Exact same approved announcement requirement/input/scope; machine binding added after review' } }
  scoped.hash = F.hashObject(scoped)
  F.writeJsonImmutable(path.join(root, '.agents/fb-feature/host-approvals/release-validation-revision-bound-20261122.json'), scoped)
  const generation = JSON.parse(fs.readFileSync(path.join(root, metadata.evaluation.caseDir, 'generation-scope.json'), 'utf8'))
  const prepared = E.prepareEvaluation({ projectRoot: root, id, caseDir: metadata.evaluation.caseDir, generation, hostApproval: scoped })
  const operator = I.loadIdentity({ projectRoot: root }).operator
  W.recordApproval({ projectRoot: root, id, planHash: prepared.planHash, operator,
    evidence: { kind: 'host-plan', reference: scoped.reference, text: scoped.resultText,
      hostApproval: scoped, derivedPlanHash: prepared.planHash } })
  const checked = E.checkEvaluation({ projectRoot: root, id })
  if (!checked.ready) throw new Error(JSON.stringify(checked.blockers))
  fs.writeSync(1, JSON.stringify({ prepared, checked, originalReceiptHash: receipt.hash, scopeBindingHash: scoped.hash }) + '\n')
}
if (require.main === module) { try { bind() } catch (error) { fs.writeSync(2, error.message + '\n'); process.exitCode = 1 } }
