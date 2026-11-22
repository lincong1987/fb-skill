#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')
const I = require('../skills/create-fb-feature/scripts/lib/identity.cjs')
const W = require('../skills/create-fb-feature/scripts/workflow.cjs')
const E = require('./eval-reverse-requirements.cjs')

const root = F.resolveRoot(path.resolve(__dirname, '..'))
const previousId = 'smsnotice-release-20261122'
const id = 'smsnotice-release-runtime-20261122'
const caseDir = 'evals/reverse-requirements/smsnotice-release'
const previous = path.join(root, '.validation-output/reverse-requirements', previousId, 'first')

function main() {
  const original = F.readJson(path.join(root, '.agents/fb-feature/host-approvals/release-validation-20261122.json')).value
  if (!I.validateHostApproval(original, { projectRoot: root, displayName: original.displayName }).ok) throw new Error('Original host approval is invalid')
  const first = F.readJson(path.join(previous, 'result.json')).value
  const manifest = F.readJson(path.join(previous, 'source-manifest.json')).value
  if (first.status !== 'fail' || first.hash !== F.hashObject(F.withoutHash(first)) || manifest.hash !== F.hashObject(F.withoutHash(manifest)) || first.sourceManifestHash !== manifest.hash) throw new Error('Original failed result/source snapshot is invalid')
  for (const entry of manifest.files) {
    const file = F.assertRelativeFileInRoot(root, entry.path).abs
    F.assertNoLinks(file)
    const bytes = fs.readFileSync(file)
    if (bytes.length !== entry.bytes || F.sha256Hex(bytes) !== entry.sha256) throw new Error('Original frozen source changed: ' + entry.path)
  }
  const generation = F.readJson(path.join(root, caseDir, 'generation-scope.json')).value
  const candidate = E.prepareEvaluation({ projectRoot: root, id, caseDir, generation })
  const current = W.readWorkflow({ projectRoot: root, id }).plan
  if (candidate.inputHash !== first.inputHash) throw new Error('Infrastructure retry must use exactly the same four input documents')
  const receipt = { ...F.withoutHash(original), derivedFrom: {
    receiptHash: original.hash, previousEvaluation: previousId, previousResultHash: first.hash,
    reason: 'Approved infrastructure retry: retain the failed first result, bind corrected isolated @ alias, and replay unchanged independently generated source. This is not a second independent generation or a new human click.'
  }, scopes: [{ id, kind: current.kind, projectRoot: root, revision: current.revision + 1,
    summary: current.summary, files: current.files, acceptance: current.acceptance,
    metadataHash: F.hashObject(current.metadata) }] }
  receipt.hash = F.hashObject(receipt)
  F.writeJsonImmutable(path.join(root, '.agents/fb-feature/host-approvals', id + '.json'), receipt)
  const prepared = E.prepareEvaluation({ projectRoot: root, id, caseDir, generation, hostApproval: receipt })
  const operator = I.loadIdentity({ projectRoot: root }).operator
  W.recordApproval({ projectRoot: root, id, planHash: prepared.planHash, operator,
    evidence: { kind: 'host-plan', reference: receipt.reference, text: receipt.resultText,
      hostApproval: receipt, derivedPlanHash: prepared.planHash } })
  const checked = E.checkEvaluation({ projectRoot: root, id })
  if (!checked.ready) throw new Error(JSON.stringify(checked.blockers))
  const started = E.startGeneration({ projectRoot: root, id, round: 'first' })
  const workspace = E.checkGeneration({ projectRoot: root, id, round: 'first', stage: 'freeze' }).context.workspace
  for (const source of generation.sources) {
    const originalFile = path.join(previous, 'workspace', source)
    const entry = manifest.files.find(item => item.path === path.relative(root, originalFile).split(path.sep).join('/'))
    const bytes = fs.readFileSync(originalFile)
    if (!entry || bytes.length !== entry.bytes || F.sha256Hex(bytes) !== entry.sha256) throw new Error('Replay source mismatch: ' + source)
    F.writeTextExclusive(path.join(workspace, source), bytes)
  }
  const evidence = path.join(path.dirname(workspace), 'evidence')
  for (const name of ['read-scope.json', 'generation-response.md']) {
    F.assertNoLinks(path.join(previous, 'evidence', name))
    F.writeTextExclusive(path.join(evidence, name), fs.readFileSync(path.join(previous, 'evidence', name), 'utf8'))
  }
  W.appendEvent({ projectRoot: root, id, type: 'note', actor: 'fb-skill-infrastructure-retry', details: {
    action: 'replayed-unchanged-independent-source', previousEvaluation: previousId,
    previousResultHash: first.hash, previousSourceManifestHash: manifest.hash,
    note: 'Read-scope and generation-response refer to the original independent generator workspace; this retry copied only frozen source bytes. No new independent generation is claimed.'
  } })
  const frozen = E.freezeGeneration({ projectRoot: root, id, round: 'first' })
  process.stdout.write(JSON.stringify({ prepared, started, frozen, reusedIndependentSource: true, previousEvaluation: previousId }) + '\n')
}

if (require.main === module) {
  try { main() } catch (error) { process.stderr.write(JSON.stringify({ code: error.code, error: error.message }) + '\n'); process.exitCode = 2 }
}
