#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')
const W = require('../skills/create-fb-feature/scripts/workflow.cjs')
const I = require('../skills/create-fb-feature/scripts/lib/identity.cjs')
const A = require('../skills/create-fb-feature/scripts/lib/audit.cjs')

const KIND = 'reverse-requirements-evaluation'
const INPUTS = ['requirements.md', 'contracts.json', 'acceptance.json', 'evidence.json']

function digest(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function generatorInput(name, content) {
  if (name !== 'contracts.json') return content
  const contracts = JSON.parse(content)
  if (!Array.isArray(contracts.decisions) || !contracts.decisions.some(decision => decision.confirmation)) return content
  return JSON.stringify({ ...contracts, decisions: contracts.decisions.map(({ confirmation, ...decision }) => decision) }, null, 2) + '\n'
}

function loadCase(projectRoot, caseDir) {
  const root = F.resolveRoot(projectRoot)
  if (typeof caseDir !== 'string' || !caseDir.startsWith('evals/reverse-requirements/') || caseDir.split('/').length !== 3) throw new F.FbError('BAD_CASE_PATH', 'Case must be directly under evals/reverse-requirements/')
  const contentByName = {}
  const inputs = INPUTS.map(name => {
    const relative = `${caseDir}/${name}`
    const file = F.assertRelativeFileInRoot(root, relative).abs
    F.assertNoLinks(file)
    const content = fs.readFileSync(file)
    contentByName[name] = content.toString('utf8')
    return { path: relative, sha256: digest(content), bytes: content.length }
  })
  const contracts = JSON.parse(contentByName['contracts.json'])
  const acceptance = JSON.parse(contentByName['acceptance.json'])
  const evidence = JSON.parse(contentByName['evidence.json'])
  const requirementIds = new Set([...contentByName['requirements.md'].matchAll(/^##\s+(R\d{2})\b/gm)].map(match => match[1]))
  if (!requirementIds.size || !contracts || !acceptance || !evidence || !contracts.caseId || [contracts, acceptance, evidence].some(document => document.schemaVersion !== 1 || document.caseId !== contracts.caseId)) throw new F.FbError('BAD_CASE', 'Case schemas, identifiers or requirement headings are invalid')
  if (!Array.isArray(contracts.rules) || !Array.isArray(contracts.decisions) || !Array.isArray(acceptance.checks) || !acceptance.checks.length || !Array.isArray(evidence.sources)) throw new F.FbError('BAD_CASE', 'Case requires contract rules/decisions, acceptance checks and evidence sources')
  const contractIds = new Set()
  for (const rule of contracts.rules) {
    if (!rule || typeof rule.id !== 'string' || !rule.id || contractIds.has(rule.id)) throw new F.FbError('BAD_CASE', 'Contract ids must be unique nonempty strings')
    contractIds.add(rule.id)
    if (!Array.isArray(rule.requirementIds) || !rule.requirementIds.length || rule.requirementIds.some(id => !requirementIds.has(id))) throw new F.FbError('UNSTATED_ACCEPTANCE', 'Contract rule has no public requirement: ' + rule.id)
  }
  const evidenceIds = new Set(evidence.sources.map(source => source.id))
  const decisionIds = new Set()
  for (const decision of contracts.decisions) {
    if (!decision || typeof decision.id !== 'string' || !decision.id || decisionIds.has(decision.id) || !['proposed', 'confirmed'].includes(decision.status) || typeof decision.proposal !== 'string' || !decision.proposal.trim()) throw new F.FbError('BAD_CASE', 'Decisions require unique ids, proposed/confirmed status and a proposal')
    decisionIds.add(decision.id)
    if (decision.requirementIds !== undefined && (!Array.isArray(decision.requirementIds) || !decision.requirementIds.length || decision.requirementIds.some(id => !requirementIds.has(id)))) throw new F.FbError('UNSTATED_ACCEPTANCE', 'Decision has no public requirement: ' + decision.id)
  }
  const checkIds = new Set()
  for (const check of acceptance.checks) {
    if (!check || !check.id || checkIds.has(check.id)) throw new F.FbError('BAD_CASE', 'Acceptance ids must be unique')
    checkIds.add(check.id)
    if (!Array.isArray(check.requirementIds) || !check.requirementIds.length || check.requirementIds.some(id => !requirementIds.has(id)) || !Array.isArray(check.contractIds) || check.contractIds.some(id => !contractIds.has(id))) throw new F.FbError('UNSTATED_ACCEPTANCE', 'Acceptance item has no public requirement/contract: ' + check.id)
    if (check.decisionIds !== undefined && (!Array.isArray(check.decisionIds) || check.decisionIds.some(id => !decisionIds.has(id)))) throw new F.FbError('UNSTATED_ACCEPTANCE', 'Acceptance item cites unknown decision: ' + check.id)
    if (!Array.isArray(check.evidenceSourceIds) || check.evidenceSourceIds.some(id => !evidenceIds.has(id))) throw new F.FbError('BAD_EVIDENCE', 'Acceptance item cites unknown source: ' + check.id)
  }
  return { root, caseDir, inputs, contracts, acceptance, evidence, inputHash: F.hashObject(inputs) }
}

function generationPaths(output, round, sources, evidenceFiles) {
  const base = `${output}/${round}`
  const workspace = `${base}/workspace`
  return {
    workspace,
    sources: sources.map(file => `${workspace}/${file}`),
    publicInputs: ['requirements.md', 'contracts.json'].map(file => `${workspace}/inputs/${file}`),
    sourceManifest: `${base}/source-manifest.json`,
    output: `${base}/dist`,
    assets: ['index.html', 'app.js'].map(file => `${base}/dist/${file}`),
    buildReport: `${base}/build-report.json`,
    buildLog: `${base}/build.log`,
    serveLog: `${base}/serve.log`,
    evidence: evidenceFiles.map(file => `${base}/${file}`)
  }
}

function generationFiles(generation) {
  return Object.values(generation.rounds).flatMap(round => [
    ...round.sources, ...round.publicInputs, round.sourceManifest, ...round.assets,
    round.buildReport, round.buildLog, round.serveLog, ...round.evidence
  ])
}

function prepareGeneration(loaded, output, input) {
  if (!input || input.schemaVersion !== 1 || input.caseId !== loaded.contracts.caseId || !Array.isArray(input.sources) || !input.sources.length || !Array.isArray(input.evidenceFiles)) throw new F.FbError('BAD_GENERATION_SCOPE', 'Generation requires a case id, source files and evidence files')
  const runtime = loaded.contracts.runtime
  for (const key of ['packages', 'buildTooling']) {
    const versions = runtime && runtime[key]
    if (!versions || typeof versions !== 'object' || Array.isArray(versions) || !Object.keys(versions).length || Object.values(versions).some(version => typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))) throw new F.FbError('BAD_RUNTIME_CONTRACT', 'Generation requires explicit installed versions in runtime.' + key)
  }
  for (const name of ['vue', 'vue-template-compiler']) if (!runtime.packages[name]) throw new F.FbError('BAD_RUNTIME_CONTRACT', 'Missing runtime package version: ' + name)
  for (const name of ['webpack', 'vue-loader']) if (!runtime.buildTooling[name]) throw new F.FbError('BAD_RUNTIME_CONTRACT', 'Missing build tool version: ' + name)
  const dependencyRoot = F.resolveRoot(input.dependencyRoot)
  if (!loaded.contracts.runtime || dependencyRoot !== F.resolveRoot(loaded.contracts.runtime.projectRoot)) throw new F.FbError('RUNTIME_MISMATCH', 'Generation dependency root must match the public runtime contract')
  if (F.isInsideDir(dependencyRoot, path.join(loaded.root, output))) throw new F.FbError('BAD_GENERATION_SCOPE', 'Generation output must not be inside the reference dependency root')
  for (const [prefix, files] of [['src/', input.sources], ['evidence/', input.evidenceFiles]]) {
    if (new Set(files).size !== files.length) throw new F.FbError('BAD_GENERATION_SCOPE', 'Generation paths must be unique')
    for (const file of files) {
      F.assertRelativeFileInRoot(loaded.root, file)
      if (!file.startsWith(prefix) || !path.posix.extname(file)) throw new F.FbError('BAD_GENERATION_SCOPE', 'Generation requires exact ' + prefix + 'file paths')
    }
  }
  if (!input.sources.includes('src/main.js')) throw new F.FbError('BAD_GENERATION_SCOPE', 'The fixed entry src/main.js is required')
  if (input.host !== '127.0.0.1' || !Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) throw new F.FbError('BAD_GENERATION_SCOPE', 'Use an explicit loopback host and valid unprivileged port')
  const sources = [...input.sources].sort()
  const evidenceFiles = [...input.evidenceFiles].sort()
  const tools = ['build.cjs', 'webpack.config.cjs', 'serve.cjs', 'index.html'].map(name => {
    const relative = `tests/fixtures/reverse-requirements/${name}`
    const file = F.assertRelativeFileInRoot(loaded.root, relative).abs
    F.assertNoLinks(file)
    const content = fs.readFileSync(file)
    return { path: relative, sha256: digest(content), bytes: content.length }
  })
  const generation = {
    schemaVersion: 1, caseId: input.caseId, inputHash: loaded.inputHash,
    dependencyRoot, host: input.host, port: input.port, sources, evidenceFiles,
    readPolicy: input.readPolicy || {}, tools,
    rounds: Object.fromEntries(['first', 'repaired'].map(round => [round, generationPaths(output, round, sources, evidenceFiles)]))
  }
  for (const relative of generationFiles(generation)) F.assertRelativeFileInRoot(loaded.root, relative)
  return { ...generation, scopeHash: F.hashObject(generation) }
}

function prepareEvaluation(options) {
  const loaded = loadCase(options.projectRoot, options.caseDir)
  const id = F.assertSlug(options.id)
  const output = `.validation-output/reverse-requirements/${id}`
  const generation = options.generation === undefined ? null : prepareGeneration(loaded, output, options.generation)
  const result = W.createPlan({
    projectRoot: loaded.root,
    id,
    kind: KIND,
    summary: `Candidate reverse-requirements evaluation: ${loaded.contracts.caseId}. Generation requires current input confirmation and approval.`,
    files: [...['first', 'repaired'].flatMap(round => [`${output}/${round}/result.json`, `${output}/${round}/report.md`]), ...(generation ? generationFiles(generation) : [])],
    acceptance: ['All input content hashes match the reviewed version', 'Unresolved decisions block generation', 'First results remain immutable; mock checks are not production acceptance'],
    metadata: { evaluation: { schemaVersion: 1, caseId: loaded.contracts.caseId, caseDir: loaded.caseDir, inputs: loaded.inputs, inputHash: loaded.inputHash, output, generated: false }, ...(generation ? { generation } : {}), ...(options.hostApproval ? { hostApproval: options.hostApproval } : {}) }
  })
  return { ok: true, id: result.id, revision: result.revision, planHash: result.hash, inputHash: loaded.inputHash, planFile: result.file, approved: false, generated: false }
}

function decisionConfirmed(decision, approval, hostApproval, projectRoot) {
  const confirmation = decision.confirmation
  const decisionHash = F.hashObject({ id: decision.id, requirementIds: decision.requirementIds || [], proposal: decision.proposal })
  const hostOk = confirmation && confirmation.kind === 'host-plan' &&
    I.validateHostApproval(confirmation.hostApproval, { projectRoot, displayName: confirmation.operator && confirmation.operator.name }).ok &&
    I.validateHostApproval(hostApproval, { projectRoot, displayName: confirmation.operator && confirmation.operator.name }).ok &&
    hostApproval.reference === confirmation.hostApproval.reference &&
    hostApproval.planTextHash === confirmation.hostApproval.planTextHash &&
    confirmation.reference === confirmation.hostApproval.reference &&
    confirmation.text === confirmation.hostApproval.resultText &&
    confirmation.hostApproval.planText.includes(decision.id)
  return !!(approval && decision.status === 'confirmed' && confirmation && confirmation.fixture !== true &&
    I.validateOperatorSchema(confirmation.operator, { projectRoot }).ok && confirmation.operator.name === approval.actor &&
    confirmation.decisionId === decision.id && confirmation.decisionHash === decisionHash &&
    typeof confirmation.confirmedAt === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(confirmation.confirmedAt) && Number.isFinite(Date.parse(confirmation.confirmedAt)) &&
    Date.parse(confirmation.confirmedAt) <= Date.parse(approval.at) &&
    (hostOk || ['user-message', 'terminal'].includes(confirmation.kind) &&
      typeof confirmation.reference === 'string' && confirmation.reference.trim() && confirmation.reference.length <= 200 && !F.CONTROL_RE.test(confirmation.reference) &&
      I.validateConfirmationText(confirmation.text).ok))
}

function checkEvaluation(options) {
  const root = F.resolveRoot(options.projectRoot)
  const workflow = W.readWorkflow({ projectRoot: root, id: F.assertSlug(options.id) })
  const metadata = workflow.plan && workflow.plan.metadata && workflow.plan.metadata.evaluation
  if (!metadata || workflow.plan.kind !== KIND || metadata.schemaVersion !== 1) throw new F.FbError('BAD_EVALUATION_PLAN', 'Workflow is not a reverse-requirements evaluation plan')
  const loaded = loadCase(root, metadata.caseDir)
  const blockers = []
  try { W.assertApproved({ projectRoot: root, id: options.id, kind: KIND }) } catch (error) {
    blockers.push({ code: error.code || 'ERROR', message: error.message })
  }
  if (loaded.inputHash !== metadata.inputHash || F.hashObject(loaded.inputs) !== F.hashObject(metadata.inputs)) blockers.push({ code: 'INPUT_CHANGED', message: 'Inputs changed after this plan; revise and obtain approval again' })
  const pending = loaded.contracts.decisions.filter(decision => !decisionConfirmed(decision, workflow.validApproval, workflow.plan.metadata.hostApproval, root))
  if (pending.length) blockers.push({ code: 'DECISIONS_PENDING', message: 'Test decisions have not been confirmed', ids: pending.map(decision => decision.id) })
  return { ok: true, ready: blockers.length === 0, readyFor: 'supplied-result-recording-only', sourceVerification: { status: 'not-run', detail: 'Only the four local input documents are hashed; external source fingerprints and runtime versions require separate verification' }, id: options.id, revision: workflow.revision, planHash: workflow.plan.hash, inputHash: loaded.inputHash, blockers }
}

function assertGenerationTools(context, directory) {
  if (!Array.isArray(context.toolHashes) || context.toolHashes.length !== 4) throw new F.FbError('TOOL_COPY_MISMATCH', 'The four approved tool fingerprints are required')
  for (const entry of context.toolHashes) {
    const file = path.join(directory, path.posix.basename(entry.path))
    F.assertNoLinks(file)
    const bytes = fs.readFileSync(file)
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) throw new F.FbError('TOOL_COPY_MISMATCH', 'The executing tool copy does not match the approved bytes: ' + file)
  }
}

function workspaceSnapshot(root, paths) {
  const expected = [...paths.sources, ...paths.publicInputs].sort()
  const workspace = F.assertRelativeFileInRoot(root, paths.workspace).abs
  const found = []
  function visit(directory) {
    F.assertNoLinks(directory)
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      F.assertNoLinks(file)
      const relative = path.relative(root, file).split(path.sep).join('/')
      if (entry.isDirectory()) {
        if (!expected.some(item => item.startsWith(relative + '/'))) throw new F.FbError('EXTRA_GENERATION_FILE', 'An undeclared directory exists: ' + relative)
        visit(file)
      } else {
        if (!entry.isFile() || !expected.includes(relative)) throw new F.FbError('EXTRA_GENERATION_FILE', 'An undeclared workspace file exists: ' + relative)
        const content = fs.readFileSync(file)
        found.push({ path: relative, sha256: digest(content), bytes: content.length })
      }
    }
  }
  if (fs.existsSync(workspace)) visit(workspace)
  const missing = expected.filter(file => !found.some(item => item.path === file))
  if (missing.length) throw new F.FbError('GENERATION_FILES_MISSING', 'The workspace is incomplete', missing)
  return found.sort((a, b) => a.path.localeCompare(b.path))
}

function verifySnapshot(root, paths, generation, checked) {
  const manifest = F.readJson(F.assertRelativeFileInRoot(root, paths.sourceManifest).abs)
  if (!manifest.exists) throw new F.FbError('SOURCE_NOT_FROZEN', 'Freeze the source snapshot before build or serve')
  const snapshot = manifest.value
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.id !== checked.id || snapshot.round !== checked.round || snapshot.planHash !== checked.planHash || snapshot.inputHash !== checked.inputHash || snapshot.scopeHash !== generation.scopeHash || snapshot.hash !== F.hashObject(F.withoutHash(snapshot))) throw new F.FbError('SOURCE_MANIFEST_CHANGED', 'Source manifest is invalid or belongs to another input/plan')
  if (F.hashObject(snapshot.files) !== F.hashObject(workspaceSnapshot(root, paths))) throw new F.FbError('SOURCE_CHANGED', 'The frozen workspace changed; use a separate repair round')
  return snapshot
}

function renderResult(body) {
  return [`# Reverse-requirements evaluation: ${body.id}`, '', `- Round: ${body.round}`, `- Result: ${body.status}`, `- Input: ${body.inputHash}`, `- First result: ${body.firstRoundHash || 'not applicable'}`, `- Time: ${body.recordedAt}`, '', 'Mock/static evidence does not imply production acceptance or business authorization.', 'The first round is immutable; this report does not recompute earlier results.', '', ...body.checks.map(check => `- ${check.id}: ${check.status} — ${String(check.evidence || check.detail).replace(/[\r\n]+/g, ' ')}`)].join('\n') + '\n'
}

function requireFirstRound(root, output, checked, workflow) {
  const first = F.readJson(F.assertRelativeFileInRoot(root, `${output}/first/result.json`).abs)
  if (!first.exists) throw new F.FbError('FIRST_ROUND_REQUIRED', 'Record the original first-round result before repairs')
  const previous = first.value
  if (!previous || previous.schemaVersion !== 1 || previous.id !== checked.id || previous.round !== 'first' || !Array.isArray(previous.checks) || previous.hash !== F.hashObject(F.withoutHash(previous))) throw new F.FbError('FIRST_ROUND_CORRUPT', 'The first-round result is invalid or changed')
  if (previous.inputHash !== checked.inputHash || previous.planHash !== checked.planHash) throw new F.FbError('FIRST_ROUND_MISMATCH', 'Repairs must use the first round\'s input and plan; changed input requires a new evaluation id')
  const report = F.readText(F.assertRelativeFileInRoot(root, `${output}/first/report.md`).abs)
  if (!report.exists || !report.raw || !workflow.events.some(event => event.type === 'verification')) throw new F.FbError('FIRST_ROUND_INCOMPLETE', 'The first-round report or completed recording is missing')
  if (report.raw !== renderResult(previous)) throw new F.FbError('FIRST_ROUND_CORRUPT', 'The first-round report text changed')
  return previous
}

function buildRecordHash(root, paths) {
  const report = F.readJson(F.assertRelativeFileInRoot(root, paths.buildReport).abs)
  if (!report.exists) return null
  const value = report.value
  if (!value || value.hash !== F.hashObject(F.withoutHash(value))) throw new F.FbError('BUILD_REPORT_CHANGED', 'The recorded build report is invalid or changed')
  const log = F.readText(F.assertRelativeFileInRoot(root, paths.buildLog).abs)
  if (!log.exists || value.logSha256 !== digest(Buffer.from(log.raw))) throw new F.FbError('BUILD_LOG_CHANGED', 'The recorded build log is missing or changed')
  return value.hash
}

function checkGeneration(options) {
  const root = F.resolveRoot(options.projectRoot)
  const checked = checkEvaluation(options)
  const workflow = W.readWorkflow(options)
  const generation = workflow.plan.metadata.generation
  if (!generation) throw new F.FbError('GENERATION_SCOPE_REQUIRED', 'This plan does not declare generation files')
  if (!['first', 'repaired'].includes(options.round) || !['start', 'freeze', 'build', 'serve'].includes(options.stage)) throw new F.FbError('BAD_GENERATION_STAGE', 'Specify first/repaired and start/freeze/build/serve')
  const loaded = loadCase(root, workflow.plan.metadata.evaluation.caseDir)
  const blockers = [...checked.blockers]
  const expected = prepareGeneration(loaded, workflow.plan.metadata.evaluation.output, generation)
  if (expected.scopeHash !== generation.scopeHash || F.hashObject(expected) !== F.hashObject(generation) || generationFiles(expected).some(file => !workflow.plan.files.includes(file))) blockers.push({ code: 'GENERATION_SCOPE_CHANGED', message: 'The declared generation scope or tool content changed' })
  if (options.round === 'repaired') {
    try {
      const previous = requireFirstRound(root, workflow.plan.metadata.evaluation.output, checked, workflow)
      const firstSnapshot = verifySnapshot(root, expected.rounds.first, expected, { ...checked, round: 'first' })
      if (previous.sourceManifestHash !== firstSnapshot.hash) throw new F.FbError('SOURCE_MANIFEST_CHANGED', 'The original result does not bind this source manifest')
      if (previous.buildReportHash !== buildRecordHash(root, expected.rounds.first)) throw new F.FbError('BUILD_REPORT_CHANGED', 'The original result does not bind the current build report')
    } catch (error) { blockers.push({ code: error.code || 'ERROR', message: error.message }) }
  }
  const paths = expected.rounds[options.round]
  if (options.stage === 'start') {
    const base = F.assertRelativeFileInRoot(root, `${workflow.plan.metadata.evaluation.output}/${options.round}`).abs
    if (fs.existsSync(base) && fs.readdirSync(base).length) blockers.push({ code: 'WORKSPACE_EXISTS', message: 'The round already has files; a start cannot overwrite it' })
  }
  if (options.stage !== 'start') {
    for (const relative of paths.publicInputs) {
      const original = loaded.inputs.find(input => path.posix.basename(input.path) === path.posix.basename(relative))
      try {
        const copy = F.readText(F.assertRelativeFileInRoot(root, relative).abs)
        const originalBytes = fs.readFileSync(F.assertRelativeFileInRoot(root, original.path).abs, 'utf8')
        if (!copy.exists || copy.raw !== generatorInput(path.posix.basename(relative), originalBytes)) throw new F.FbError('PUBLIC_INPUT_CHANGED', 'A generator input projection is missing or changed: ' + relative)
      } catch (error) { blockers.push({ code: error.code || 'ERROR', message: error.message }) }
    }
  }
  if (options.stage === 'freeze') {
    if (fs.existsSync(F.assertRelativeFileInRoot(root, paths.sourceManifest).abs)) blockers.push({ code: 'SOURCE_ALREADY_FROZEN', message: 'The source manifest is immutable' })
    try { workspaceSnapshot(root, paths) } catch (error) { blockers.push({ code: error.code || 'ERROR', message: error.message }) }
  } else if (['build', 'serve'].includes(options.stage)) {
    try { verifySnapshot(root, paths, expected, { ...checked, round: options.round }) } catch (error) { blockers.push({ code: error.code || 'ERROR', message: error.message }) }
  }
  const context = Object.fromEntries(['workspace', 'sourceManifest', 'output', 'buildReport', 'buildLog', 'serveLog'].map(key => [key, F.assertRelativeFileInRoot(root, paths[key]).abs]))
  Object.assign(context, { dependencyRoot: expected.dependencyRoot, expectedVersions: { ...loaded.contracts.runtime.packages, ...loaded.contracts.runtime.buildTooling }, toolHashes: expected.tools, host: expected.host, port: expected.port })
  return { ...checked, ready: blockers.length === 0, readyFor: options.stage, round: options.round, scopeHash: expected.scopeHash, blockers, context }
}

function startGeneration(options) {
  const root = F.resolveRoot(options.projectRoot)
  const id = F.assertSlug(options.id)
  return F.withLock(path.join(root, '.agents/fb-feature/workflows', id, '.lock'), () => {
    const checked = checkGeneration({ ...options, stage: 'start' })
    if (!checked.ready) throw new F.FbError('GENERATION_NOT_READY', 'Generation inputs and scope are not approved', checked.blockers)
    const workflow = W.readWorkflow(options)
    const loaded = loadCase(root, workflow.plan.metadata.evaluation.caseDir)
    if (loaded.inputHash !== checked.inputHash) throw new F.FbError('INPUT_CHANGED', 'Inputs changed before workspace preparation')
    const paths = workflow.plan.metadata.generation.rounds[options.round]
    const actor = 'fb-skill-generation-preparer'
    W.appendEvent({ projectRoot: root, id, type: 'implementation-start', actor, details: { action: 'generation-workspace-start', round: options.round, scopeHash: checked.scopeHash } })
    try {
      for (const relative of paths.publicInputs) {
        const name = path.posix.basename(relative)
        const source = F.assertRelativeFileInRoot(root, `${loaded.caseDir}/${name}`).abs
        const target = F.assertRelativeFileInRoot(root, relative).abs
        const content = F.readText(source).raw
        const expected = loaded.inputs.find(input => input.path.endsWith('/' + name))
        if (digest(Buffer.from(content)) !== expected.sha256) throw new F.FbError('INPUT_CHANGED', 'Public input changed before copying')
        const publicContent = generatorInput(name, content)
        F.writeTextExclusive(target, publicContent)
        if (F.readText(target).raw !== publicContent) throw new F.FbError('INPUT_COPY_INCOMPLETE', 'Public input copy is incomplete')
      }
      W.appendEvent({ projectRoot: root, id, type: 'note', actor, details: { action: 'generation-public-inputs-copied', round: options.round, scopeHash: checked.scopeHash, workspace: paths.workspace, generated: false } })
      return { ok: true, workspace: checked.context.workspace, generated: false, ...checked }
    } catch (error) {
      const details = { action: 'generation-workspace-failed', round: options.round, code: error.code || 'ERROR', message: error.message }
      try { W.appendEvent({ projectRoot: root, id, type: 'blocked', actor, details }) } catch (auditError) { details.auditError = auditError.message }
      throw new F.FbError('WORKSPACE_WRITE_FAILED', 'Workspace preparation failed; partial input copies are retained', details)
    }
  })
}

function freezeGeneration(options) {
  const root = F.resolveRoot(options.projectRoot)
  const id = F.assertSlug(options.id)
  return F.withLock(path.join(root, '.agents/fb-feature/workflows', id, '.lock'), () => {
    const checked = checkGeneration({ ...options, stage: 'freeze' })
    if (!checked.ready) throw new F.FbError('GENERATION_NOT_READY', 'The source snapshot cannot be frozen', checked.blockers)
    const workflow = W.readWorkflow(options)
    const paths = workflow.plan.metadata.generation.rounds[options.round]
    const body = { schemaVersion: 1, nature: 'generated-source-snapshot-not-page-acceptance', id, round: options.round, inputHash: checked.inputHash, planHash: checked.planHash, scopeHash: checked.scopeHash, recordedAt: F.nowIso().atLocal, files: workspaceSnapshot(root, paths) }
    body.hash = F.hashObject(body)
    try {
      F.writeJsonImmutable(checked.context.sourceManifest, body)
      if (F.readText(checked.context.sourceManifest).raw !== JSON.stringify(body, null, 2) + '\n') throw new F.FbError('SOURCE_MANIFEST_INCOMPLETE', 'Source manifest write was incomplete')
      W.appendEvent({ projectRoot: root, id, type: 'implementation-complete', actor: 'fb-skill-source-freezer', details: { action: 'generation-source-frozen', round: options.round, manifest: paths.sourceManifest, manifestHash: body.hash, scopeHash: checked.scopeHash, files: body.files.length } })
      return { ok: true, manifestFile: checked.context.sourceManifest, manifestHash: body.hash, inputHash: checked.inputHash, planHash: checked.planHash, scopeHash: checked.scopeHash }
    } catch (error) {
      const details = { action: 'generation-freeze-failed', round: options.round, code: error.code || 'ERROR', message: error.message, manifest: paths.sourceManifest }
      try { W.appendEvent({ projectRoot: root, id, type: 'blocked', actor: 'fb-skill-source-freezer', details }) } catch (auditError) { details.auditError = auditError.message }
      throw new F.FbError('SOURCE_FREEZE_FAILED', 'Source freezing failed; any partial manifest is retained and cannot be overwritten', details)
    }
  })
}

function recordResult(options) {
  const root = F.resolveRoot(options.projectRoot)
  const id = F.assertSlug(options.id)
  return F.withLock(path.join(root, '.agents/fb-feature/workflows', id, '.lock'), () => {
    const checked = checkEvaluation({ projectRoot: root, id })
    if (!checked.ready) throw new F.FbError('EVALUATION_NOT_READY', 'Current evaluation is not approved and ready', checked.blockers)
    if (!['first', 'repaired'].includes(options.round)) throw new F.FbError('BAD_ROUND', 'Use first or repaired; each round is written only once')
    const workflow = W.readWorkflow({ projectRoot: root, id })
    let sourceManifestHash = null
    let buildReportHash = null
    if (workflow.plan.metadata.generation) {
      const generation = checkGeneration({ projectRoot: root, id, round: options.round, stage: 'serve' })
      if (!generation.ready) throw new F.FbError('GENERATION_NOT_READY', 'Record results only after the approved source snapshot is frozen', generation.blockers)
      sourceManifestHash = F.readJson(generation.context.sourceManifest).value.hash
      buildReportHash = buildRecordHash(root, workflow.plan.metadata.generation.rounds[options.round])
      if (!buildReportHash && A.readAuditRecords(root, id).records.some(event => event.details && event.details.action === 'generation-build-claimed' && event.details.round === options.round)) throw new F.FbError('BUILD_IN_PROGRESS', 'Do not seal a round while its claimed build has no completed report')
      const reportsPassing = options.result && Array.isArray(options.result.checks) && options.result.checks.some(check => check.status === 'pass')
      const buildReport = buildReportHash && F.readJson(generation.context.buildReport).value
      if (reportsPassing && (!buildReport || buildReport.status !== 'success' || buildReport.exitCode !== 0 || buildReport.inputHash !== checked.inputHash || buildReport.planHash !== checked.planHash || buildReport.scopeHash !== generation.scopeHash || buildReport.sourceManifestHash !== sourceManifestHash)) throw new F.FbError('BUILD_NOT_VERIFIED', 'A passing generated-page result requires a completed successful build of this frozen input')
    }
    const loaded = loadCase(root, workflow.plan.metadata.evaluation.caseDir)
    if (loaded.inputHash !== checked.inputHash) throw new F.FbError('INPUT_CHANGED', 'Inputs changed while recording; nothing was written')
    if (!options.result || !Array.isArray(options.result.checks) || !options.result.checks.length) throw new F.FbError('BAD_RESULT', 'Result requires at least one supplied check')
    const known = new Set(loaded.acceptance.checks.map(check => check.id))
    const reported = new Map()
    for (const item of options.result.checks) {
      if (!item || !known.has(item.id) || reported.has(item.id) || !['pass', 'fail', 'partial', 'not-run'].includes(item.status)) throw new F.FbError('BAD_RESULT', 'Result check ids/statuses must match the acceptance sheet')
      if (item.status === 'pass' && (typeof item.evidence !== 'string' || !item.evidence.trim() || item.exitCode !== undefined && item.exitCode !== 0)) throw new F.FbError('FALSE_PASS', 'Passing results require evidence and cannot have a nonzero exit code')
      if (item.status !== 'pass' && (typeof item.detail !== 'string' || !item.detail.trim())) throw new F.FbError('BAD_RESULT', 'Failed, partial and unrun checks require a reason')
      reported.set(item.id, item)
    }
    const checks = loaded.acceptance.checks.map(check => reported.get(check.id) || { id: check.id, status: 'not-run', detail: 'No execution result was supplied for this acceptance item' })
    const status = checks.some(check => check.status === 'fail') ? 'fail' : checks.every(check => check.status === 'pass') ? 'pass' : 'partial'
    const output = `.validation-output/reverse-requirements/${id}`
    const resultPath = `${output}/${options.round}/result.json`
    const reportPath = `${output}/${options.round}/report.md`
    for (const relative of [resultPath, reportPath]) {
      if (!workflow.plan.files.includes(relative)) throw new F.FbError('RESULT_OUTSIDE_PLAN', 'Result is outside approved output scope: ' + relative)
    }
    const resultFile = F.assertRelativeFileInRoot(root, resultPath).abs
    const reportFile = F.assertRelativeFileInRoot(root, reportPath).abs
    if (fs.existsSync(resultFile) || fs.existsSync(reportFile)) throw new F.FbError('ROUND_EXISTS', 'Round already has an output; it cannot be overwritten')
    let firstRoundHash = null
    if (options.round === 'repaired') {
      firstRoundHash = requireFirstRound(root, output, { ...checked, id }, workflow).hash
    }
    const time = F.nowIso()
    const actor = 'fb-skill-evaluation-recorder'
    const body = { schemaVersion: 1, nature: 'isolated-evaluation-not-production-acceptance', humanApprovalIsBusinessAuthorization: false, id, round: options.round, revision: checked.revision, planHash: checked.planHash, inputHash: checked.inputHash, firstRoundHash, sourceManifestHash, buildReportHash, recordedAt: time.atLocal, recordedBy: actor, authorizedBy: workflow.validApproval.actor, status, checks }
    body.hash = F.hashObject(body)
    W.appendEvent({ projectRoot: root, id, type: 'note', actor, details: { action: 'evaluation-result-start', revision: checked.revision, planHash: checked.planHash, round: options.round, resultHash: body.hash } })
    const reportText = renderResult(body)
    try {
      F.writeJsonImmutable(resultFile, body)
      F.writeTextExclusive(reportFile, reportText)
      if (F.readText(resultFile).raw !== JSON.stringify(body, null, 2) + '\n' || F.readText(reportFile).raw !== reportText) throw new F.FbError('RESULT_INCOMPLETE', 'A written result file is incomplete or changed')
      W.appendEvent({ projectRoot: root, id, type: 'verification', actor, details: { revision: checked.revision, planHash: checked.planHash, status, evidence: resultPath, note: 'Recorded evaluation evidence, not an automatic execution or production certification' } })
    } catch (error) {
      const details = { action: 'evaluation-result-write-failed', revision: checked.revision, planHash: checked.planHash, round: options.round, code: error.code || 'ERROR', message: error.message, retainedPaths: [resultPath, reportPath].filter(relative => fs.existsSync(path.join(root, relative))) }
      try { W.appendEvent({ projectRoot: root, id, type: 'blocked', actor, details }) } catch (auditError) { details.auditError = auditError.message }
      throw new F.FbError('RESULT_WRITE_FAILED', 'Result recording failed; partial files are retained and must not be overwritten', details)
    }
    return { ok: true, status, round: options.round, resultFile, reportFile }
  })
}

const USAGE = [
  'Usage:',
  '  node scripts/eval-reverse-requirements.cjs prepare --project-root <dir> --case <evals/reverse-requirements/name> --id <slug> [--scope <relative.json>]',
  '  node scripts/eval-reverse-requirements.cjs check --project-root <dir> --id <slug>',
  '  node scripts/eval-reverse-requirements.cjs check-generation --project-root <dir> --id <slug> --round first|repaired --stage start|freeze|build|serve',
  '  node scripts/eval-reverse-requirements.cjs start-generation|freeze-generation --project-root <dir> --id <slug> --round first|repaired',
  '  node scripts/eval-reverse-requirements.cjs record --project-root <dir> --id <slug> --round first|repaired --result <relative.json>',
  '',
  'This tool prepares inputs and records supplied evidence; it does not generate pages or approve plans.',
  'Exit codes: 0 success; 2 invalid input/refusal; 3 not ready.'
].join('\n')

function parseArgs(argv) {
  const commands = new Set(['prepare', 'check', 'record', 'check-generation', 'start-generation', 'freeze-generation'])
  const known = new Set(['--project-root', '--case', '--id', '--round', '--result', '--scope', '--stage', '--help'])
  const args = {}
  let command
  for (let index = 0; index < argv.length; index++) {
    const raw = argv[index]
    if (commands.has(raw)) {
      if (command) throw new F.FbError('DUP_COMMAND', 'Only one command is allowed')
      command = raw
      continue
    }
    const split = raw.indexOf('=')
    const name = split > 2 ? raw.slice(0, split) : raw
    const inline = split > 2 ? raw.slice(split + 1) : undefined
    if (!known.has(name)) throw new F.FbError('UNKNOWN_ARG', 'Unknown argument: ' + raw)
    if (Object.hasOwn(args, name)) throw new F.FbError('DUP_ARG', 'Repeated argument: ' + name)
    if (name === '--help') {
      if (inline !== undefined) throw new F.FbError('BAD_ARG', '--help does not accept a value')
      args[name] = true
    } else {
      const value = inline === undefined ? argv[++index] : inline
      if (!value || value.startsWith('--')) throw new F.FbError('MISSING_VALUE', 'Missing value: ' + name)
      args[name] = value
    }
  }
  if (!command && !args['--help']) throw new F.FbError('USAGE', USAGE)
  return { command, args }
}

function main(argv) {
  const { command, args } = parseArgs(argv)
  if (args['--help']) {
    fs.writeSync(1, USAGE + '\n')
    return
  }
  if (!args['--project-root'] || !args['--id']) throw new F.FbError('USAGE', 'Explicit --project-root and --id are required')
  const options = { projectRoot: args['--project-root'], id: args['--id'], caseDir: args['--case'] }
  let report
  if (command === 'prepare') {
    if (args['--scope']) {
      const root = F.resolveRoot(options.projectRoot)
      const scope = F.readJson(F.assertRelativeFileInRoot(root, args['--scope']).abs)
      if (!scope.exists) throw new F.FbError('SCOPE_NOT_FOUND', 'Generation scope file does not exist')
      options.generation = scope.value
    }
    report = prepareEvaluation(options)
  } else if (command === 'check') report = checkEvaluation(options)
  else if (command === 'check-generation') report = checkGeneration({ ...options, round: args['--round'], stage: args['--stage'] })
  else if (command === 'start-generation') report = startGeneration({ ...options, round: args['--round'] })
  else if (command === 'freeze-generation') report = freezeGeneration({ ...options, round: args['--round'] })
  else {
    if (!args['--round'] || !args['--result']) throw new F.FbError('USAGE', 'record requires --round and --result')
    const root = F.resolveRoot(options.projectRoot)
    const resultFile = F.assertRelativeFileInRoot(root, args['--result']).abs
    const result = F.readJson(resultFile)
    if (!result.exists) throw new F.FbError('RESULT_NOT_FOUND', 'Supplied result file does not exist')
    report = recordResult({ ...options, round: args['--round'], result: result.value })
  }
  fs.writeSync(1, JSON.stringify(report, null, 2) + '\n')
  if (report.ready === false) process.exitCode = 3
}

if (require.main === module) {
  try { main(process.argv.slice(2)) } catch (error) {
    fs.writeSync(1, JSON.stringify({ ok: false, code: error.code || 'ERROR', error: error.message, details: error.details }, null, 2) + '\n')
    process.exitCode = 2
  }
}

module.exports = { prepareEvaluation, checkEvaluation, recordResult, checkGeneration, startGeneration, freezeGeneration, assertGenerationTools, generatorInput }
