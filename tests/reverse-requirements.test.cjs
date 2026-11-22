const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const W = require('../skills/create-fb-feature/scripts/workflow.cjs')
const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')
const evaluation = require('../scripts/eval-reverse-requirements.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-reverse-eval-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const caseDir = 'evals/reverse-requirements/example'
  const directory = path.join(root, caseDir)
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'requirements.md'), '# Candidate test requirement\n\n## R01 List\nShow the title and query controls.\n')
  fs.writeFileSync(path.join(directory, 'contracts.json'), JSON.stringify({ schemaVersion: 1, caseId: 'example-pilot', rules: [{ id: 'C01', requirementIds: ['R01'], description: 'Mock title string' }], decisions: [{ id: 'D01', status: 'proposed', proposal: 'Query returns to the first page' }] }))
  fs.writeFileSync(path.join(directory, 'acceptance.json'), JSON.stringify({ schemaVersion: 1, caseId: 'example-pilot', checks: [{ id: 'A01', requirementIds: ['R01'], contractIds: ['C01'], evidenceSourceIds: ['source-list'], description: 'Title column is visible', layer: 'mock-browser', critical: true }] }))
  fs.writeFileSync(path.join(directory, 'evidence.json'), JSON.stringify({ schemaVersion: 1, caseId: 'example-pilot', sources: [{ id: 'source-list', path: 'src/list.vue', sha256: 'a'.repeat(64) }], unknowns: ['Production API not tested'] }))
  return { projectRoot: root, caseDir, id: 'example-evaluation', directory }
}

test('preparing a candidate binds all input content without approving or generating', t => {
  const options = fixture(t)
  const prepared = evaluation.prepareEvaluation(options)
  const workflow = W.readWorkflow({ projectRoot: options.projectRoot, id: options.id })
  assert.equal(prepared.ok, true)
  assert.equal(workflow.status, 'draft')
  assert.equal(workflow.validApproval, null)
  assert.equal(workflow.plan.metadata.evaluation.inputs.length, 4)
  assert.match(prepared.inputHash, /^[a-f0-9]{64}$/)
  assert.equal(fs.existsSync(path.join(options.projectRoot, '.validation-output')), false)
  assert.equal(fs.existsSync(path.join(options.projectRoot, 'src')), false)
})

test('an acceptance item with no public requirement is refused before plan writes', t => {
  const options = fixture(t)
  const file = path.join(options.directory, 'acceptance.json')
  const acceptance = JSON.parse(fs.readFileSync(file, 'utf8'))
  acceptance.checks[0].requirementIds = ['UNSTATED']
  fs.writeFileSync(file, JSON.stringify(acceptance))
  assert.throws(() => evaluation.prepareEvaluation(options), error => error.code === 'UNSTATED_ACCEPTANCE')
  assert.equal(fs.existsSync(path.join(options.projectRoot, '.agents')), false)
})

test('checking a candidate reports missing approval without creating a generation workspace', t => {
  const options = fixture(t)
  evaluation.prepareEvaluation(options)
  const result = evaluation.checkEvaluation({ projectRoot: options.projectRoot, id: options.id })
  assert.equal(result.ready, false)
  assert.equal(result.blockers[0].code, 'NOT_APPROVED')
  assert.ok(result.blockers.some(item => item.code === 'DECISIONS_PENDING'))
  assert.equal(fs.existsSync(path.join(options.projectRoot, '.validation-output')), false)
})

function approveTemporary(options, prepared) {
  // Isolated regression input only, never a current user's approval or identity.
  W.recordApproval({ projectRoot: options.projectRoot, id: options.id, planHash: prepared.planHash, operator: { schema: 'fb-feature-identity/v1', status: 'confirmed', name: '隔离回归员', confirmation: { method: 'user-message', sourceRef: 'temporary-regression-identity', text: '确认', confirmedAt: '2026-01-01T00:00:00.000Z' } }, evidence: { kind: 'user-message', reference: 'temporary-regression-approval', text: '同意按此方案执行' } })
}

test('editing a requirement invalidates current input approval', t => {
  const options = fixture(t)
  const prepared = evaluation.prepareEvaluation(options)
  approveTemporary(options, prepared)
  fs.appendFileSync(path.join(options.directory, 'requirements.md'), '\nA new unreviewed requirement.\n')
  const result = evaluation.checkEvaluation({ projectRoot: options.projectRoot, id: options.id })
  assert.equal(result.ready, false)
  assert.ok(result.blockers.some(item => item.code === 'INPUT_CHANGED'))
})

test('changing a decision label to confirmed is not itself human confirmation', t => {
  const options = fixture(t)
  const file = path.join(options.directory, 'contracts.json')
  const contracts = JSON.parse(fs.readFileSync(file, 'utf8'))
  contracts.decisions[0].status = 'confirmed'
  fs.writeFileSync(file, JSON.stringify(contracts))
  const prepared = evaluation.prepareEvaluation(options)
  approveTemporary(options, prepared)
  const result = evaluation.checkEvaluation({ projectRoot: options.projectRoot, id: options.id })
  assert.equal(result.ready, false)
  assert.ok(result.blockers.some(item => item.code === 'DECISIONS_PENDING'))
})

test('host-plan confirmation binds each decision and the evaluation to the approved source', t => {
  const options = fixture(t)
  const I = require('../skills/create-fb-feature/scripts/lib/identity.cjs')
  const receipt = {
    schema: 'fb-host-plan-approval/v1', host: 'zcode', sourceTool: 'ExitPlanMode',
    reference: 'isolated-evaluation-host-plan', resultText: I.HOST_PLAN_RESULT,
    projectRoot: fs.realpathSync(options.projectRoot), displayName: '界面回归员',
    planText: '本隔离测试采用显示标签界面回归员，确认D01查询回第一页，并批准本次范围。',
    recordedAt: new Date().toISOString()
  }
  receipt.planTextHash = F.sha256Hex(receipt.planText)
  receipt.hash = F.hashObject(receipt)
  I.saveProfile({ projectRoot: options.projectRoot, name: receipt.displayName,
    method: 'host-plan', confirmationText: receipt.resultText,
    sourceRef: receipt.reference, hostApproval: receipt })
  const operator = I.readIdentity({ projectRoot: options.projectRoot,
    profileRoot: path.join(options.projectRoot, 'isolated-global') }).operator
  const file = path.join(options.directory, 'contracts.json')
  const contracts = JSON.parse(fs.readFileSync(file, 'utf8'))
  const decision = contracts.decisions[0]
  decision.status = 'confirmed'
  decision.confirmation = { decisionId: decision.id,
    decisionHash: F.hashObject({ id: decision.id, requirementIds: [], proposal: decision.proposal }),
    kind: 'host-plan', reference: receipt.reference, text: receipt.resultText,
    confirmedAt: new Date().toISOString(), operator, hostApproval: receipt }
  fs.writeFileSync(file, JSON.stringify(contracts))
  const candidate = evaluation.prepareEvaluation(options)
  const basePlan = W.readWorkflow({ projectRoot: options.projectRoot, id: options.id }).plan
  const scopedReceipt = { ...F.withoutHash(receipt), scopes: [{ id: basePlan.id, kind: basePlan.kind,
    revision: basePlan.revision + 1, summary: basePlan.summary,
    projectRoot: basePlan.projectRoot, files: basePlan.files, acceptance: basePlan.acceptance,
    metadataHash: F.hashObject(basePlan.metadata) }] }
  scopedReceipt.hash = F.hashObject(scopedReceipt)
  const prepared = evaluation.prepareEvaluation({ ...options, hostApproval: scopedReceipt })
  W.recordApproval({ projectRoot: options.projectRoot, id: options.id,
    planHash: prepared.planHash, operator, evidence: { kind: 'host-plan',
      reference: scopedReceipt.reference, text: scopedReceipt.resultText, hostApproval: scopedReceipt,
      derivedPlanHash: prepared.planHash } })
  assert.equal(evaluation.checkEvaluation(options).ready, true)
  assert.equal(candidate.approved, false)
})

test('result recording refuses an unapproved evaluation without writing an output', t => {
  const options = fixture(t)
  evaluation.prepareEvaluation(options)
  assert.throws(() => evaluation.recordResult({ projectRoot: options.projectRoot, id: options.id, round: 'first', result: { checks: [{ id: 'A01', status: 'pass', evidence: 'not actual execution' }] } }), error => error.code === 'EVALUATION_NOT_READY')
  assert.equal(fs.existsSync(path.join(options.projectRoot, '.validation-output')), false)
})

function readyTemporary(options) {
  const file = path.join(options.directory, 'contracts.json')
  const contracts = JSON.parse(fs.readFileSync(file, 'utf8'))
  contracts.decisions = []
  fs.writeFileSync(file, JSON.stringify(contracts))
  const prepared = evaluation.prepareEvaluation(options)
  approveTemporary(options, prepared)
  return prepared
}

test('a failed check is recorded faithfully and the first-round result cannot be overwritten', t => {
  const options = fixture(t)
  readyTemporary(options)
  const result = { checks: [{ id: 'A01', status: 'fail', exitCode: 1, detail: 'Isolated regression failure, not a real browser run', evidence: 'temporary test evidence' }] }
  const recorded = evaluation.recordResult({ projectRoot: options.projectRoot, id: options.id, round: 'first', result })
  assert.equal(recorded.status, 'fail')
  const stored = JSON.parse(fs.readFileSync(recorded.resultFile, 'utf8'))
  assert.equal(stored.checks[0].status, 'fail')
  assert.equal(stored.humanApprovalIsBusinessAuthorization, false)
  assert.throws(() => evaluation.recordResult({ projectRoot: options.projectRoot, id: options.id, round: 'first', result }), error => error.code === 'ROUND_EXISTS')
  assert.equal(W.readWorkflow({ projectRoot: options.projectRoot, id: options.id }).status, 'blocked')
})

test('evaluation command help explains preparation without requiring a project or approval', () => {
  const cli = path.resolve(__dirname, '../scripts/eval-reverse-requirements.cjs')
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /prepare/)
  assert.match(result.stdout, /check/)
  assert.match(result.stdout, /record/)
  assert.match(result.stdout, /not.*generat/i)
})

test('prepare and check commands expose a draft and exit not-ready without generating', t => {
  const options = fixture(t)
  const cli = path.resolve(__dirname, '../scripts/eval-reverse-requirements.cjs')
  const prepared = spawnSync(process.execPath, [cli, 'prepare', '--project-root', options.projectRoot, '--case', options.caseDir, '--id', options.id], { encoding: 'utf8' })
  assert.equal(prepared.status, 0, prepared.stdout)
  assert.equal(JSON.parse(prepared.stdout).approved, false)
  const checked = spawnSync(process.execPath, [cli, 'check', '--project-root', options.projectRoot, '--id', options.id], { encoding: 'utf8' })
  assert.equal(checked.status, 3, checked.stdout)
  assert.equal(JSON.parse(checked.stdout).ready, false)
  assert.equal(fs.existsSync(path.join(options.projectRoot, '.validation-output')), false)
})

test('record command stores supplied failure evidence without calling it an executed test', t => {
  const options = fixture(t)
  readyTemporary(options)
  fs.writeFileSync(path.join(options.projectRoot, 'supplied-result.json'), JSON.stringify({ checks: [{ id: 'A01', status: 'fail', exitCode: 1, detail: 'Synthetic command-boundary regression failure' }] }))
  const cli = path.resolve(__dirname, '../scripts/eval-reverse-requirements.cjs')
  const result = spawnSync(process.execPath, [cli, 'record', '--project-root', options.projectRoot, '--id', options.id, '--round', 'first', '--result', 'supplied-result.json'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout)
  assert.equal(JSON.parse(result.stdout).status, 'fail')
  assert.equal(W.readWorkflow({ projectRoot: options.projectRoot, id: options.id }).status, 'blocked')
})

test('a pass with a failing command exit code is refused before a round is written', t => {
  const options = fixture(t)
  readyTemporary(options)
  assert.throws(() => evaluation.recordResult({ projectRoot: options.projectRoot, id: options.id, round: 'first', result: { checks: [{ id: 'A01', status: 'pass', exitCode: 1, evidence: 'synthetic command output' }] } }), error => error.code === 'FALSE_PASS')
  assert.equal(fs.existsSync(path.join(options.projectRoot, '.validation-output')), false)
})

test('a repair cannot compare against a first round from a different input version', t => {
  const options = fixture(t)
  readyTemporary(options)
  evaluation.recordResult({ projectRoot: options.projectRoot, id: options.id, round: 'first', result: { checks: [{ id: 'A01', status: 'fail', detail: 'Synthetic first-round failure' }] } })
  fs.appendFileSync(path.join(options.directory, 'requirements.md'), '\nA changed requirement is a new comparison, not a repair.\n')
  const revised = evaluation.prepareEvaluation(options)
  approveTemporary(options, revised)
  assert.throws(() => evaluation.recordResult({ projectRoot: options.projectRoot, id: options.id, round: 'repaired', result: { checks: [{ id: 'A01', status: 'pass', evidence: 'Synthetic changed-input evidence' }] } }), error => error.code === 'FIRST_ROUND_MISMATCH')
  assert.equal(fs.existsSync(path.join(options.projectRoot, '.validation-output/reverse-requirements', options.id, 'repaired')), false)
})

test('a same-input repair links its immutable first-round result in JSON and report', t => {
  const options = fixture(t)
  readyTemporary(options)
  assert.equal(evaluation.checkEvaluation(options).ready, true)
  const first = evaluation.recordResult({ ...options, round: 'first', result: { checks: [{ id: 'A01', status: 'fail', detail: 'Synthetic first-round failure' }] } })
  const firstHash = JSON.parse(fs.readFileSync(first.resultFile, 'utf8')).hash
  const repaired = evaluation.recordResult({ ...options, round: 'repaired', result: { checks: [{ id: 'A01', status: 'pass', evidence: 'Synthetic same-input repair evidence' }] } })
  assert.equal(JSON.parse(fs.readFileSync(repaired.resultFile, 'utf8')).firstRoundHash, firstHash)
  assert.ok(fs.readFileSync(repaired.reportFile, 'utf8').includes(firstHash))
})

test('input drift during result recording is refused without an output', t => {
  const options = fixture(t)
  readyTemporary(options)
  const original = fs.readFileSync
  const acceptanceFile = path.join(options.directory, 'acceptance.json')
  let reads = 0
  t.mock.method(fs, 'readFileSync', function(file, ...args) {
    const content = original.call(fs, file, ...args)
    if (String(file) === acceptanceFile && ++reads === 2) {
      const changed = JSON.parse(content.toString())
      changed.checks.push({ ...changed.checks[0], id: 'A99' })
      return Buffer.from(JSON.stringify(changed))
    }
    return content
  })
  assert.throws(() => evaluation.recordResult({ ...options, round: 'first', result: { checks: [{ id: 'A01', status: 'pass', evidence: 'Synthetic result' }] } }), error => error.code === 'INPUT_CHANGED')
  assert.equal(fs.existsSync(path.join(options.projectRoot, '.validation-output')), false)
})

test('a report write failure leaves an explicit blocked audit and preserves the partial output', t => {
  const options = fixture(t)
  readyTemporary(options)
  const original = fs.writeSync
  let output
  t.mock.method(fs, 'writeSync', function(fd, content, ...args) {
    if (String(content).startsWith('# Reverse-requirements evaluation:')) {
      const error = new Error('Synthetic disk full at report write')
      error.code = 'ENOSPC'
      throw error
    }
    return original.call(fs, fd, content, ...args)
  })
  assert.throws(() => evaluation.recordResult({ ...options, round: 'first', result: { checks: [{ id: 'A01', status: 'pass', evidence: 'Synthetic supplied evidence' }] } }), error => error.code === 'RESULT_WRITE_FAILED')
  const workflow = W.readWorkflow(options)
  assert.equal(workflow.status, 'blocked')
  output = path.join(options.projectRoot, '.validation-output/reverse-requirements', options.id, 'first/result.json')
  assert.equal(fs.existsSync(output), true)
  assert.equal(workflow.events.at(-1).type, 'blocked')
})

test('a short report write cannot be reported as a complete result', t => {
  const options = fixture(t)
  readyTemporary(options)
  const original = fs.writeSync
  t.mock.method(fs, 'writeSync', function(fd, content, ...args) {
    if (String(content).startsWith('# Reverse-requirements evaluation:')) return original.call(fs, fd, String(content).slice(0, 12))
    return original.call(fs, fd, content, ...args)
  })
  assert.throws(() => evaluation.recordResult({ ...options, round: 'first', result: { checks: [{ id: 'A01', status: 'pass', evidence: 'Synthetic supplied evidence' }] } }), error => error.code === 'RESULT_WRITE_FAILED')
  assert.equal(W.readWorkflow(options).status, 'blocked')
})

test('ambiguous contract identifiers are refused before candidate writes', t => {
  const options = fixture(t)
  const file = path.join(options.directory, 'contracts.json')
  const contracts = JSON.parse(fs.readFileSync(file, 'utf8'))
  contracts.rules.push({ ...contracts.rules[0], description: 'A different meaning under the same identifier' })
  fs.writeFileSync(file, JSON.stringify(contracts))
  assert.throws(() => evaluation.prepareEvaluation(options), error => error.code === 'BAD_CASE')
  assert.equal(fs.existsSync(path.join(options.projectRoot, '.agents')), false)
})

test('unnamed or malformed pending decisions are refused before candidate writes', t => {
  const options = fixture(t)
  const file = path.join(options.directory, 'contracts.json')
  const contracts = JSON.parse(fs.readFileSync(file, 'utf8'))
  contracts.decisions = [null]
  fs.writeFileSync(file, JSON.stringify(contracts))
  assert.throws(() => evaluation.prepareEvaluation(options), error => error.code === 'BAD_CASE')
  assert.equal(fs.existsSync(path.join(options.projectRoot, '.agents')), false)
})

test('a bound decision confirmation permits recording only its approved proposal', t => {
  const options = fixture(t)
  const file = path.join(options.directory, 'contracts.json')
  const contracts = JSON.parse(fs.readFileSync(file, 'utf8'))
  const decision = contracts.decisions[0]
  decision.status = 'confirmed'
  decision.confirmation = { operator: { schema: 'fb-feature-identity/v1', status: 'confirmed', name: '隔离回归员', confirmation: { method: 'user-message', sourceRef: 'temporary-regression-identity', text: '确认', confirmedAt: '2026-01-01T00:00:00.000Z' } }, decisionId: 'D01', decisionHash: F.hashObject({ id: 'D01', requirementIds: [], proposal: 'Query returns to the first page' }), confirmedAt: '2026-01-01T01:00:00.000Z', kind: 'user-message', reference: 'temporary-bound-confirmation', text: '同意本版 D01 试点选择' }
  fs.writeFileSync(file, JSON.stringify(contracts))
  const prepared = evaluation.prepareEvaluation(options)
  approveTemporary(options, prepared)
  assert.equal(evaluation.checkEvaluation(options).ready, true)
  decision.proposal = 'An unconfirmed replacement proposal'
  fs.writeFileSync(file, JSON.stringify(contracts))
  const revised = evaluation.prepareEvaluation(options)
  approveTemporary(options, revised)
  const checked = evaluation.checkEvaluation(options)
  assert.equal(checked.ready, false)
  assert.ok(checked.blockers.some(item => item.code === 'DECISIONS_PENDING'))
})

test('a copied yes without binding to the current proposal does not confirm a decision', t => {
  const options = fixture(t)
  const file = path.join(options.directory, 'contracts.json')
  const contracts = JSON.parse(fs.readFileSync(file, 'utf8'))
  contracts.decisions[0].status = 'confirmed'
  contracts.decisions[0].confirmation = { operator: { schema: 'fb-feature-identity/v1', status: 'confirmed', name: '隔离回归员', confirmation: { method: 'user-message', sourceRef: 'temporary-regression-identity', text: '确认', confirmedAt: '2026-01-01T00:00:00.000Z' } }, kind: 'user-message', reference: 'temporary-unbound-confirmation', text: '同意' }
  fs.writeFileSync(file, JSON.stringify(contracts))
  const prepared = evaluation.prepareEvaluation(options)
  approveTemporary(options, prepared)
  const checked = evaluation.checkEvaluation(options)
  assert.equal(checked.ready, false)
  assert.ok(checked.blockers.some(item => item.code === 'DECISIONS_PENDING'))
})

test('partially observed results remain partial rather than becoming a skipped round', t => {
  const options = fixture(t)
  const file = path.join(options.directory, 'acceptance.json')
  const acceptance = JSON.parse(fs.readFileSync(file, 'utf8'))
  acceptance.checks.push({ ...acceptance.checks[0], id: 'A02', description: 'Another public observation' })
  fs.writeFileSync(file, JSON.stringify(acceptance))
  readyTemporary(options)
  const recorded = evaluation.recordResult({ ...options, round: 'first', result: { checks: [{ id: 'A01', status: 'pass', evidence: 'Synthetic observation' }] } })
  assert.equal(recorded.status, 'partial')
  assert.equal(W.readWorkflow(options).status, 'completed')
})

test('an empty supplied result cannot consume the immutable first-round slot', t => {
  const options = fixture(t)
  readyTemporary(options)
  assert.throws(() => evaluation.recordResult({ ...options, round: 'first', result: { checks: [] } }), error => error.code === 'BAD_RESULT')
  assert.equal(fs.existsSync(path.join(options.projectRoot, '.validation-output')), false)
})

test('an acceptance check cannot cite a missing decision', t => {
  const options = fixture(t)
  const file = path.join(options.directory, 'acceptance.json')
  const acceptance = JSON.parse(fs.readFileSync(file, 'utf8'))
  acceptance.checks[0].decisionIds = ['D99']
  fs.writeFileSync(file, JSON.stringify(acceptance))
  assert.throws(() => evaluation.prepareEvaluation(options), error => error.code === 'UNSTATED_ACCEPTANCE')
})

test('a repair cannot use an incomplete first-round report as its baseline', t => {
  const options = fixture(t)
  readyTemporary(options)
  const original = fs.writeSync
  const failure = t.mock.method(fs, 'writeSync', function(fd, content, ...args) {
    if (String(content).startsWith('# Reverse-requirements evaluation:')) throw new Error('Synthetic report write failure')
    return original.call(fs, fd, content, ...args)
  })
  assert.throws(() => evaluation.recordResult({ ...options, round: 'first', result: { checks: [{ id: 'A01', status: 'fail', detail: 'Synthetic original failure' }] } }), error => error.code === 'RESULT_WRITE_FAILED')
  failure.mock.restore()
  assert.throws(() => evaluation.recordResult({ ...options, round: 'repaired', result: { checks: [{ id: 'A01', status: 'pass', evidence: 'Synthetic repaired evidence' }] } }), error => error.code === 'FIRST_ROUND_INCOMPLETE')
})

test('changed first-round report text cannot be reused as a repair baseline', t => {
  const options = fixture(t)
  readyTemporary(options)
  const first = evaluation.recordResult({ ...options, round: 'first', result: { checks: [{ id: 'A01', status: 'fail', detail: 'Synthetic first failure' }] } })
  fs.writeFileSync(first.reportFile, fs.readFileSync(first.reportFile, 'utf8').replace('Result: fail', 'Result: pass'))
  assert.throws(() => evaluation.recordResult({ ...options, round: 'repaired', result: { checks: [{ id: 'A01', status: 'pass', evidence: 'Synthetic repair evidence' }] } }), error => error.code === 'FIRST_ROUND_CORRUPT')
})

test('an evidence fingerprint declaration is not reported as external source verification', t => {
  const options = fixture(t)
  readyTemporary(options)
  const checked = evaluation.checkEvaluation(options)
  assert.equal(checked.sourceVerification.status, 'not-run')
  assert.match(checked.sourceVerification.detail, /external/i)
})

test('result records distinguish the recording agent from the approving person', t => {
  const options = fixture(t)
  readyTemporary(options)
  const recorded = evaluation.recordResult({ ...options, round: 'first', result: { checks: [{ id: 'A01', status: 'not-run', detail: 'Synthetic audit-only observation' }] } })
  const stored = JSON.parse(fs.readFileSync(recorded.resultFile, 'utf8'))
  assert.equal(stored.recordedBy, 'fb-skill-evaluation-recorder')
  assert.equal(stored.authorizedBy, '隔离回归员')
  assert.equal(W.readWorkflow(options).events.at(-1).actor, 'fb-skill-evaluation-recorder')
})

function generationFixture(t) {
  const options = fixture(t)
  const dependencyRoot = path.join(options.projectRoot, 'dependencies')
  fs.mkdirSync(dependencyRoot)
  for (const name of ['build.cjs', 'webpack.config.cjs', 'serve.cjs', 'index.html']) {
    const file = path.join(options.projectRoot, 'tests/fixtures/reverse-requirements', name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '// Synthetic tool fingerprint only\n')
  }
  const file = path.join(options.directory, 'contracts.json')
  const contracts = JSON.parse(fs.readFileSync(file, 'utf8'))
  contracts.runtime = { projectRoot: dependencyRoot, packages: { vue: '2.6.12', 'vue-template-compiler': '2.6.12' }, buildTooling: { webpack: '4.47.0', 'vue-loader': '15.11.1' } }
  fs.writeFileSync(file, JSON.stringify(contracts))
  options.generation = { schemaVersion: 1, caseId: 'example-pilot', dependencyRoot, sources: ['src/main.js', 'src/List.vue'], evidenceFiles: ['evidence/read-scope.json'], host: '127.0.0.1', port: 18733 }
  return options
}

test('a generation candidate binds both exact round scopes without writing a workspace', t => {
  const options = generationFixture(t)
  evaluation.prepareEvaluation(options)
  const workflow = W.readWorkflow(options)
  const generation = workflow.plan.metadata.generation
  assert.ok(generation)
  assert.equal(generation.inputHash, workflow.plan.metadata.evaluation.inputHash)
  assert.match(generation.scopeHash, /^[a-f0-9]{64}$/)
  assert.ok(workflow.plan.files.includes(`.validation-output/reverse-requirements/${options.id}/first/workspace/src/List.vue`))
  assert.equal(fs.existsSync(path.join(options.projectRoot, '.validation-output')), false)
})

test('generator inputs omit private identity and approval records while binding the reviewed contract', t => {
  const options = generationFixture(t)
  const file = path.join(options.directory, 'contracts.json')
  const contracts = JSON.parse(fs.readFileSync(file, 'utf8'))
  contracts.decisions = [{ id: 'D01', status: 'confirmed', proposal: 'Keep this public requirement',
    confirmation: { operator: { name: 'PRIVATE-IDENTITY-MARKER' }, hostApproval: { reference: 'PRIVATE-RECEIPT-MARKER' } } }]
  fs.writeFileSync(file, JSON.stringify(contracts))
  const prepared = evaluation.prepareEvaluation(options)
  assert.throws(() => evaluation.startGeneration({ ...options, round: 'first' }), error => error.code === 'GENERATION_NOT_READY')
  const content = evaluation.generatorInput('contracts.json', fs.readFileSync(file, 'utf8'))
  assert.ok(content.includes('Keep this public requirement'))
  assert.ok(!content.includes('PRIVATE-IDENTITY-MARKER'))
  assert.ok(!content.includes('PRIVATE-RECEIPT-MARKER'))
  assert.equal(JSON.parse(content).decisions[0].status, 'confirmed')
  assert.equal(prepared.approved, false)
})

test('an approved start copies only public inputs and never generates business sources', t => {
  const options = generationFixture(t)
  readyTemporary(options)
  const started = evaluation.startGeneration({ ...options, round: 'first' })
  assert.equal(fs.existsSync(path.join(started.workspace, 'inputs/requirements.md')), true)
  assert.equal(fs.existsSync(path.join(started.workspace, 'inputs/contracts.json')), true)
  assert.equal(fs.existsSync(path.join(started.workspace, 'inputs/acceptance.json')), false)
  assert.equal(fs.existsSync(path.join(started.workspace, 'inputs/evidence.json')), false)
  assert.equal(fs.existsSync(path.join(started.workspace, 'src')), false)
  assert.throws(() => evaluation.startGeneration({ ...options, round: 'first' }), error => error.code === 'GENERATION_NOT_READY')
})

test('freezing records actual source bytes once and never overwrites a first snapshot', t => {
  const options = generationFixture(t)
  readyTemporary(options)
  const started = evaluation.startGeneration({ ...options, round: 'first' })
  fs.mkdirSync(path.join(started.workspace, 'src'))
  fs.writeFileSync(path.join(started.workspace, 'src/main.js'), 'export default 1\n')
  fs.writeFileSync(path.join(started.workspace, 'src/List.vue'), '<template><div>synthetic</div></template>\n')
  const frozen = evaluation.freezeGeneration({ ...options, round: 'first' })
  const manifest = JSON.parse(fs.readFileSync(frozen.manifestFile, 'utf8'))
  assert.equal(manifest.files.length, 4)
  assert.equal(manifest.planHash, frozen.planHash)
  assert.match(manifest.files.find(file => file.path.endsWith('src/main.js')).sha256, /^[a-f0-9]{64}$/)
  assert.throws(() => evaluation.freezeGeneration({ ...options, round: 'first' }), error => error.code === 'GENERATION_NOT_READY')
})

test('repair preparation cannot start before the immutable first-round result exists', t => {
  const options = generationFixture(t)
  readyTemporary(options)
  assert.throws(() => evaluation.startGeneration({ ...options, round: 'repaired' }), error => error.code === 'GENERATION_NOT_READY')
  assert.equal(fs.existsSync(path.join(options.projectRoot, '.validation-output')), false)
})

function generatedWorkspace(options) {
  readyTemporary(options)
  const started = evaluation.startGeneration({ ...options, round: 'first' })
  fs.mkdirSync(path.join(started.workspace, 'src'))
  fs.writeFileSync(path.join(started.workspace, 'src/main.js'), 'export default 1\n')
  fs.writeFileSync(path.join(started.workspace, 'src/List.vue'), '<template><div>synthetic</div></template>\n')
  return started.workspace
}

test('altered public input copies cannot become the frozen generation input', t => {
  const options = generationFixture(t)
  const workspace = generatedWorkspace(options)
  fs.appendFileSync(path.join(workspace, 'inputs/requirements.md'), '\nAn unapproved local change.\n')
  assert.throws(() => evaluation.freezeGeneration({ ...options, round: 'first' }), error => error.code === 'GENERATION_NOT_READY')
})

test('an extra source file and later frozen-source drift both prevent a build', t => {
  const options = generationFixture(t)
  const workspace = generatedWorkspace(options)
  const extra = path.join(workspace, 'src/unlisted.js')
  fs.writeFileSync(extra, 'export default "extra"\n')
  assert.throws(() => evaluation.freezeGeneration({ ...options, round: 'first' }), error => error.code === 'GENERATION_NOT_READY')
  fs.unlinkSync(extra)
  evaluation.freezeGeneration({ ...options, round: 'first' })
  assert.equal(evaluation.checkGeneration({ ...options, round: 'first', stage: 'build' }).ready, true)
  fs.appendFileSync(path.join(workspace, 'src/main.js'), '\n// changed after freezing\n')
  const checked = evaluation.checkGeneration({ ...options, round: 'first', stage: 'build' })
  assert.equal(checked.ready, false)
  assert.ok(checked.blockers.some(item => item.code === 'SOURCE_CHANGED'))
})

test('changing a bound harness tool blocks workspace preparation', t => {
  const options = generationFixture(t)
  readyTemporary(options)
  fs.appendFileSync(path.join(options.projectRoot, 'tests/fixtures/reverse-requirements/build.cjs'), '\n// an unapproved tool change\n')
  const checked = evaluation.checkGeneration({ ...options, round: 'first', stage: 'start' })
  assert.equal(checked.ready, false)
  assert.ok(checked.blockers.some(item => item.code === 'GENERATION_SCOPE_CHANGED'))
  assert.throws(() => evaluation.startGeneration({ ...options, round: 'first' }), error => error.code === 'GENERATION_NOT_READY')
})

test('generation sources must be exact paths, not traversal or wildcard scopes', t => {
  for (const invalid of ['src/../outside.js', 'src/*.vue']) {
    const options = generationFixture(t)
    options.generation.sources.push(invalid)
    assert.throws(() => evaluation.prepareEvaluation(options), error => error.code === 'BAD_FILE_SCOPE')
    assert.equal(fs.existsSync(path.join(options.projectRoot, '.agents')), false)
  }
})

test('partial source-manifest writes are blocked and retained rather than reported complete', t => {
  const options = generationFixture(t)
  generatedWorkspace(options)
  const original = fs.writeSync
  t.mock.method(fs, 'writeSync', function(fd, content, ...args) {
    if (String(content).includes('generated-source-snapshot-not-page-acceptance')) return original.call(fs, fd, String(content).slice(0, 8))
    return original.call(fs, fd, content, ...args)
  })
  assert.throws(() => evaluation.freezeGeneration({ ...options, round: 'first' }), error => error.code === 'SOURCE_FREEZE_FAILED')
  assert.equal(W.readWorkflow(options).status, 'blocked')
})

test('generation result recording requires the frozen source snapshot', t => {
  const options = generationFixture(t)
  generatedWorkspace(options)
  assert.throws(() => evaluation.recordResult({ ...options, round: 'first', result: { checks: [{ id: 'A01', status: 'pass', evidence: 'Synthetic supplied result' }] } }), error => error.code === 'GENERATION_NOT_READY')
})

test('the approved generation scope can be prepared and inspected through the CLI', t => {
  const options = generationFixture(t)
  const contractsFile = path.join(options.directory, 'contracts.json')
  const contracts = JSON.parse(fs.readFileSync(contractsFile, 'utf8'))
  contracts.decisions = []
  fs.writeFileSync(contractsFile, JSON.stringify(contracts))
  const scopeFile = path.join(options.projectRoot, 'generation-scope.json')
  fs.writeFileSync(scopeFile, JSON.stringify(options.generation))
  const cli = path.resolve(__dirname, '../scripts/eval-reverse-requirements.cjs')
  const prepared = spawnSync(process.execPath, [cli, 'prepare', '--project-root', options.projectRoot, '--case', options.caseDir, '--id', options.id, '--scope', 'generation-scope.json'], { encoding: 'utf8' })
  assert.equal(prepared.status, 0, prepared.stdout)
  approveTemporary(options, JSON.parse(prepared.stdout))
  const checked = spawnSync(process.execPath, [cli, 'check-generation', '--project-root', options.projectRoot, '--id', options.id, '--round', 'first', '--stage', 'start'], { encoding: 'utf8' })
  assert.equal(checked.status, 0, checked.stdout)
  assert.equal(JSON.parse(checked.stdout).ready, true)
})

test('repair preparation still checks the original frozen source files', t => {
  const options = generationFixture(t)
  const workspace = generatedWorkspace(options)
  evaluation.freezeGeneration({ ...options, round: 'first' })
  evaluation.recordResult({ ...options, round: 'first', result: { checks: [{ id: 'A01', status: 'fail', detail: 'Synthetic first result' }] } })
  fs.appendFileSync(path.join(workspace, 'src/main.js'), '// changed original source\n')
  assert.throws(() => evaluation.startGeneration({ ...options, round: 'repaired' }), error => error.code === 'GENERATION_NOT_READY')
})

test('a frozen workspace without a successful build cannot record passing page results', t => {
  const options = generationFixture(t)
  generatedWorkspace(options)
  evaluation.freezeGeneration({ ...options, round: 'first' })
  assert.throws(() => evaluation.recordResult({ ...options, round: 'first', result: { checks: [{ id: 'A01', status: 'pass', evidence: 'No compiled page exists' }] } }), error => error.code === 'BUILD_NOT_VERIFIED')
})

test('generation plans require explicit runtime version maps instead of an empty expected set', t => {
  const options = generationFixture(t)
  const file = path.join(options.directory, 'contracts.json')
  const contracts = JSON.parse(fs.readFileSync(file, 'utf8'))
  delete contracts.runtime.packages
  fs.writeFileSync(file, JSON.stringify(contracts))
  assert.throws(() => evaluation.prepareEvaluation(options), error => error.code === 'BAD_RUNTIME_CONTRACT')
  assert.equal(fs.existsSync(path.join(options.projectRoot, '.agents')), false)
})

test('starting an unapproved generation scope refuses before copying any input', t => {
  const options = generationFixture(t)
  evaluation.prepareEvaluation(options)
  assert.throws(() => evaluation.startGeneration({ ...options, round: 'first' }), error => error.code === 'GENERATION_NOT_READY')
  assert.equal(fs.existsSync(path.join(options.projectRoot, '.validation-output')), false)
})
