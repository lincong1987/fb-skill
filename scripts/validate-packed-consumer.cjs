#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')

function validateConsumer(packDirectory, name) {
  F.assertSlug(name)
  const root = path.resolve(__dirname, '..')
  const packed = F.readJson(path.join(packDirectory, 'manifest.json')).value
  if (packed.name !== 'fb-skill' || packed.version !== '0.2.1') throw new Error('Wrong consumer bundle')
  F.assertNoLinks(packed.file)
  if (F.sha256Hex(fs.readFileSync(packed.file)) !== packed.sha256) throw new Error('Consumer archive hash differs from the reviewed pack manifest')
  const base = path.join(root, '.validation-output', 'release-validation', name)
  fs.mkdirSync(base)
  const consumer = path.join(base, 'consumer')
  fs.mkdirSync(consumer)
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'fb-skill-packed-consumer', private: true, version: '1.0.0' }) + '\n', { flag: 'wx' })
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
  const installPackage = spawnSync(process.execPath, [npmCli, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', packed.file],
    { cwd: consumer, encoding: 'utf8', shell: false, timeout: 120000 })
  fs.writeFileSync(path.join(base, 'npm-install.log'), installPackage.stdout + installPackage.stderr, { flag: 'wx' })
  if (installPackage.status !== 0) throw new Error('Offline consumer installation failed: ' + installPackage.status)
  const bundle = path.join(consumer, 'node_modules/fb-skill')
  for (const entry of packed.packedFiles) {
    const source = F.assertRelativeFileInRoot(F.resolveRoot(packed.bundle), entry.path).abs
    const installed = F.assertRelativeFileInRoot(F.resolveRoot(bundle), entry.path).abs
    F.assertNoLinks(source)
    F.assertNoLinks(installed)
    if (!fs.readFileSync(source).equals(fs.readFileSync(installed))) throw new Error('Installed package bytes differ: ' + entry.path)
  }
  const I = require(path.join(bundle, 'skills/create-fb-feature/scripts/lib/identity.cjs'))
  const W = require(path.join(bundle, 'skills/create-fb-feature/scripts/workflow.cjs'))
  const installer = require(path.join(bundle, 'skills/manage-fb-skill/scripts/lib/installer.cjs'))
  const receipt = F.readJson(path.join(root, '.agents/fb-feature/host-approvals/release-validation-20261122.json')).value
  if (!I.validateHostApproval(receipt, { projectRoot: root, displayName: receipt.displayName }).ok) throw new Error('Original consumer-test authorization is invalid')
  // 继承仅本轮明确批准的隔离消费者测试，不把工程派生映射说成新的人点击。
  const mapped = { ...F.withoutHash(receipt), projectRoot: fs.realpathSync(consumer),
    derivedFrom: { receiptHash: receipt.hash, projectRoot: receipt.projectRoot,
      scope: 'Section 4 of approved plan: a new isolated packed consumer only' },
    recordedAt: F.nowIso().atLocal }
  mapped.hash = F.hashObject(mapped)
  F.writeJsonImmutable(path.join(consumer, '.agents/fb-feature/host-approvals/install.json'), mapped)
  I.saveProfile({ projectRoot: consumer, name: mapped.displayName, method: 'host-plan',
    confirmationText: mapped.resultText, sourceRef: mapped.reference, hostApproval: mapped })
  const operator = I.loadIdentity({ projectRoot: consumer,
    profileRoot: path.join(base, 'isolated-global-profiles') }).operator
  const customPath = path.join(consumer, '.agents/skills/local-custom/SKILL.md')
  F.writeTextExclusive(customPath, '---\nname: local-custom\ndescription: Private consumer content that must be preserved.\n---\n# Local custom\n')
  const legacyPath = '.agent/.rules/agent_guide.md'
  const legacySource = path.resolve(root, '../fb-rules/packages/fb-rules', legacyPath)
  F.assertNoLinks(legacySource)
  const legacyBytes = fs.readFileSync(legacySource)
  const legacyEntry = installer.loadCatalog({}).byPath.get(legacyPath)
  if (!legacyEntry || legacyEntry.kind !== 'exclusive' || !legacyEntry.variants.some(variant =>
    variant.contentSha256 === F.sha256Hex(legacyBytes) || variant.canonicalLfSha256 === installer.canonicalLfSha256(legacyBytes))) throw new Error('Legacy consumer fixture no longer matches the reviewed cleanup catalog')
  const legacyTarget = F.assertRelativeFileInRoot(F.resolveRoot(consumer), legacyPath).abs
  F.writeTextExclusive(legacyTarget, legacyBytes)
  const unknownLegacy = path.join(consumer, '.agent/.rules/local-custom.md')
  F.writeTextExclusive(unknownLegacy, '# Private rule that the installer must preserve\n')
  const unknownHash = F.sha256Hex(fs.readFileSync(unknownLegacy))
  const customHash = F.sha256Hex(fs.readFileSync(customPath))
  function approveDerived(candidate) {
    const current = W.readWorkflow({ projectRoot: consumer, id: candidate.id }).plan
    const metadata = { ...current.metadata }
    delete metadata.hostApproval
    const scoped = { ...F.withoutHash(mapped), scopes: [{ id: current.id, kind: current.kind,
      projectRoot: current.projectRoot, revision: current.revision + 1, summary: current.summary,
      files: current.files, acceptance: current.acceptance, metadataHash: F.hashObject(metadata) }] }
    scoped.hash = F.hashObject(scoped)
    F.writeJsonImmutable(path.join(consumer, '.agents/fb-feature/host-approvals', current.id + '-scoped.json'), scoped)
    const bound = W.createPlan({ projectRoot: consumer, id: current.id, kind: current.kind,
      summary: current.summary, files: current.files, acceptance: current.acceptance,
      metadata: { ...metadata, hostApproval: scoped } })
    W.recordApproval({ projectRoot: consumer, id: current.id, planHash: bound.hash, operator,
      evidence: { kind: 'host-plan', reference: scoped.reference, text: scoped.resultText,
        hostApproval: scoped, derivedPlanHash: bound.hash } })
    return bound
  }
  const options = { projectRoot: consumer, action: 'install-and-clean', skillSource: bundle, id: 'packaged-install' }
  const before = installer.scan(options)
  if (before.counts.legacy.cleanCandidates !== 1) throw new Error('Expected one exact legacy fixture before cleanup')
  const candidate = installer.createInstallPlan(options)
  const plan = approveDerived(candidate)
  const applied = installer.applyPlan(options)
  const after = installer.scan(options)
  if (fs.existsSync(legacyTarget) || applied.legacy.removed.length !== 1 || after.counts.legacy.cleanCandidates !== 0) throw new Error('Exact legacy consumer cleanup failed')
  if (F.sha256Hex(fs.readFileSync(unknownLegacy)) !== unknownHash || F.sha256Hex(fs.readFileSync(customPath)) !== customHash) throw new Error('Custom consumer content changed')
  const repeatOptions = { ...options, id: 'packaged-repeat' }
  const repeatCandidate = installer.createInstallPlan(repeatOptions)
  approveDerived(repeatCandidate)
  const repeated = installer.applyPlan(repeatOptions)
  if (!applied.ok || !repeated.ok || after.counts.install.conflict) throw new Error('Packed skill install failed')
  if (fs.readFileSync(customPath, 'utf8').includes('Private consumer') === false) throw new Error('Custom consumer content changed')
  const installed = require(path.join(consumer, '.agents/skills/create-fb-feature/scripts/lib/skill-format.cjs'))
  const skillChecks = installed.NAMES.map(skill => installed.checkSkillDirectory(path.join(consumer, '.agents/skills', skill)))
  const verified = W.verifyAll({ projectRoot: consumer, id: options.id })
  if (!verified.ok) throw new Error('Consumer approval chain invalid')
  const installedCli = path.join(bundle, 'bin/fb-skill.cjs')
  const cliVersion = spawnSync(process.execPath, [installedCli, '--version'], { cwd: consumer, encoding: 'utf8', shell: false, timeout: 30000 })
  const cliScan = spawnSync(process.execPath, [installedCli, 'install', 'scan', '--project-root', consumer, '--action', 'install-and-clean'], { cwd: consumer, encoding: 'utf8', shell: false, timeout: 30000 })
  F.writeTextExclusive(path.join(base, 'installed-cli.log'), JSON.stringify({ version: { exitCode: cliVersion.status, stdout: cliVersion.stdout, stderr: cliVersion.stderr }, scan: { exitCode: cliScan.status, stdout: cliScan.stdout, stderr: cliScan.stderr } }, null, 2) + '\n')
  if (cliVersion.status !== 0 || cliVersion.stdout.trim() !== '0.2.1' || cliScan.status !== 0) throw new Error('Installed package CLI did not execute correctly')
  const cliScanReport = JSON.parse(cliScan.stdout)
  if (cliScanReport.counts.install.conflict || cliScanReport.counts.install.create || cliScanReport.counts.install.update || cliScanReport.counts.legacy.cleanCandidates) throw new Error('Installed CLI rescan is not idempotent')
  const report = { nature: 'real-packed-isolated-consumer-not-business-project-acceptance',
    consumer, bundle, packedSha256: packed.sha256, npmExitCode: installPackage.status,
    before: before.counts, planHash: plan.hash, applied, after: after.counts,
    repeated, skillChecks, audit: verified, customPreserved: true, unknownLegacyPreserved: true,
    exactLegacyFixture: { path: legacyPath, sourceHash: F.sha256Hex(legacyBytes), removed: true },
    installedCli: { versionExit: cliVersion.status, scanExit: cliScan.status, version: cliVersion.stdout.trim(), after: cliScanReport.counts },
    recordedAt: F.nowIso().atLocal }
  F.writeJsonImmutable(path.join(base, 'consumer-result.json'), report)
  fs.writeSync(1, JSON.stringify({ base, consumer, before: before.counts, after: after.counts,
    applied: applied.ok, repeated: repeated.ok, skills: skillChecks.map(skill => skill.name) }) + '\n')
}
if (require.main === module) {
  try { validateConsumer(path.resolve(process.argv[2]), process.argv[3]) }
  catch (error) { fs.writeSync(2, error.message + '\n'); process.exitCode = 1 }
}
module.exports = { validateConsumer }
