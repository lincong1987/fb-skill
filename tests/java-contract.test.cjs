// Java contract validation slice.
//
// Scope and honesty rules (mirrors docs/validation.md conventions):
// - LEGACY slice (guarded): the six historical tests below only require
//   fixture.cjs and register when BOTH FB_RELEASE_JAVA_HISTORY=1 AND the
//   gitignored fixture file really exists on disk. They are local historical
//   evidence validation, NOT a portable test: by default exactly ONE explicit
//   skip is registered, nothing is required, and NOTHING is written into the
//   legacy .validation-output/release-validation/java/ evidence dir — so a
//   fresh clone without the ignored fixture still runs this whole file green
//   and a default full regression never overwrites the historical summary or
//   logs. Skipped is reported as skipped, never counted as a pass.
// - Gated tests (FB_RELEASE_JAVA_BUILD=1, legacy guard only): real bounded
//   maven runs against the byte-accurate fixture copy with an isolated maven
//   repo (global .m2 only read, never written). Logs land in
//   .validation-output/release-validation/java/.
// - The 16 sibling modules build against their ACCURATE declared parent
//   topinfo-parent 2.2.0-SNAPSHOT. This is corroborating ecosystem evidence and
//   is explicitly NOT a substitute for mew-manage itself, whose declared parent
//   topinfo-parent 2.2.3-SNAPSHOT / platform-admin 2.2.3-SNAPSHOT chain is
//   missing. The verdict for mew-manage comes only from the accurate dependency
//   verdict probe below.
// - Where hard dependencies are missing from every configured repository, the
//   blocked verdict is kept real; the test asserts the ACCURACY of recorded
//   evidence, never a fake success count.
// - SYNTHETIC slice (bottom of file): self-contained, always registered,
//   independent of the legacy fixture and the legacy evidence dir; see its own
//   header there.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

// Legacy guard: the ignored fixture must BOTH exist on disk AND the explicit
// history env must be set before anything legacy is required or registered.
const LEGACY_HISTORY = process.env.FB_RELEASE_JAVA_HISTORY === '1'
const LEGACY_FIXTURE_FILE = path.join(__dirname, 'fixtures', 'java-contract', 'fixture.cjs')
const LEGACY_FIXTURE_PRESENT = fs.existsSync(LEGACY_FIXTURE_FILE)

if (LEGACY_HISTORY && LEGACY_FIXTURE_PRESENT) {
const fixture = require('./fixtures/java-contract/fixture.cjs')

const GATED = process.env.FB_RELEASE_JAVA_BUILD === '1'

function ensureEvidenceDir() {
  fs.mkdirSync(fixture.EVIDENCE_DIR, { recursive: true })
}

function loadSummary() {
  const p = path.join(fixture.EVIDENCE_DIR, 'summary.json')
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

function saveSummary(summary) {
  ensureEvidenceDir()
  fs.writeFileSync(path.join(fixture.EVIDENCE_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
}

function logFile(name) {
  ensureEvidenceDir()
  return path.join(fixture.EVIDENCE_DIR, `${RUN_ID}-${name}.log`)
}

function appendLog(file, title, result) {
  fs.appendFileSync(file, `\n===== ${title} =====\n$ ${result.command}\nexit=${result.code} signal=${result.signal} spawnFailed=${result.spawnFailed} timedOut=${result.timedOut}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}\n`)
}

// The six legacy tests below are kept VERBATIM under this guard (indentation
// untouched, to keep the historical slice diff-minimal). They never run by
// default and never run without the fixture file really existing.

test('java toolchain seam detects real maven and jdk versions', () => {
  ensureEvidenceDir()
  const toolchain = fixture.toolchain()
  assert.equal(toolchain.mvn.spawnFailed, false, 'mvn must be invocable')
  assert.ok(toolchain.mvn.version, 'maven version must parse from real output')
  assert.ok(toolchain.jdk17.version, 'jdk17 version must parse from real java -version')
  assert.equal(toolchain.jdk8.exists, true, 'jdk1.8.0_202 javac must exist on this host')
  const evidence = { runId: RUN_ID, toolchain }
  fs.writeFileSync(path.join(fixture.EVIDENCE_DIR, `toolchain-${RUN_ID}.json`), JSON.stringify(evidence, null, 2))
  assert.ok(toolchain.mvn.version.startsWith('3.'), `maven 3.x expected, got ${toolchain.mvn.version}`)
})

test('java-contract fixture copy matches manifest byte-for-byte', () => {
  const { problems, manifest } = fixture.verifyIntegrity()
  assert.deepEqual(problems, [], 'fixture integrity problems')
  assert.equal(manifest.moduleCount, 16, 'sixteen sibling modules expected in the aggregator scope')
  const redaction = fixture.verifyRedactionApplied()
  assert.equal(redaction.originalAbsent, true, 'hardcoded password literal must be absent from the copy')
  assert.equal(redaction.markerPresent, true, 'redaction marker must be present in the copy')
  assert.ok(manifest.fileCount >= 2000, 'module scope should carry the full java source set')
})

test('static dependency audit classifies every internal dependency honestly', () => {
  const audit = fixture.auditInternalDeps()
  assert.equal(audit.perModule.length, 16, 'audit covers all 16 modules')
  const summary = loadSummary() || {}
  summary.staticAudit = {
    runId: RUN_ID,
    predictedBuildable: audit.predictedBuildable,
    distinctBlockedCoordinates: audit.distinctBlockedCoordinates,
    perModule: audit.perModule.map(m => ({ module: m.module, buildable: m.buildablePrediction, blocking: m.blocking.map(b => `${b.groupId}:${b.artifactId}:${b.version}:${b.kind}`) }))
  }
  saveSummary(summary)
  // Reality check against the audit of 2026-11-22: internal log-center-client
  // 1.2.0-SNAPSHOT and friends exist only as cached download failures and the
  // only configured repositories cannot serve them, so the prediction is 0.
  assert.ok(audit.distinctBlockedCoordinates.length >= 1, 'audit must record the concrete blocked coordinates with their kind')
  for (const mod of audit.perModule) {
    assert.ok(['yes', 'no'].includes(mod.buildablePrediction), 'prediction must be explicit')
  }
})

test('restore probe records the accurate dependency verdict for mew-manage and the sibling blockers', { skip: GATED ? false : 'requires FB_RELEASE_JAVA_BUILD=1 (bounded network + maven runs)' }, t => {
  ensureEvidenceDir()
  const isoRepo = path.join(fixture.EVIDENCE_DIR, 'm2-isolated')
  fs.mkdirSync(isoRepo, { recursive: true })
  const logPath = logFile('restore-probe')
  const log = []
  const seedResult = fixture.seedIsolatedRepo(isoRepo, log)
  fs.writeFileSync(logPath, `# restore probe run ${RUN_ID}\n${log.join('\n')}\n`)

  // Bounded network probe of the configured repository layer (curl HEAD, 30s).
  const reach = fixture.runShell('curl -sS -I --max-time 30 -o /dev/null -w "%{http_code}" https://maven.aliyun.com/repository/public/javax/inject/javax.inject/1/javax.inject-1.pom', { timeoutMs: 40000 })
  appendLog(logPath, 'configured-repo reachability (curl HEAD javax.inject pom)', reach)
  const repoReachable = reach.stdout.trim().startsWith('200')

  // Every internal artifact that static audit marks missing, plus the
  // mew-manage 2.2.3 chain: one bounded dependency:get each (30s).
  const audit = fixture.auditInternalDeps()
  const coordinates = [...new Set([...fixture.MANIFEST.blockedModule.missingArtifacts, ...audit.distinctBlockedCoordinates])]
  const probes = []
  for (const coord of coordinates) {
    const r = fixture.runShell(`mvn -B -q "-Dmaven.repo.local=${isoRepo}" dependency:get -Dartifact=${coord} -Dtransitive=false`, { timeoutMs: 30000 })
    appendLog(logPath, `dependency:get ${coord}`, r)
    probes.push({ coordinate: coord, exitCode: r.code, resolved: r.code === 0, timedOut: r.timedOut })
  }

  // Accurate verdict: run maven's own POM resolution against the copied
  // mew-manage pom (nothing else exists for it — no sources copied, no stubs).
  const validate = fixture.runShell(`mvn -B "-Dmaven.repo.local=${isoRepo}" validate -f "${path.join(fixture.HERE, 'sources', 'blocked', 'mew-manage-pom.xml')}"`, { timeoutMs: 120000 })
  appendLog(logPath, 'mew-manage pom validate (parent resolution verdict)', validate)
  const out = validate.stdout + validate.stderr
  const parentMissingEvidence = validate.code !== 0 && /Non-resolvable parent POM/.test(out) && /topinfo-parent/.test(out) && /2\.2\.3-SNAPSHOT/.test(out)
  const validateResolved = validate.code === 0

  const verdict = {
    runId: RUN_ID,
    seed: seedResult,
    repoReachable,
    probes,
    unresolvedProbeCount: probes.filter(p => !p.resolved).length,
    resolvedProbeCount: probes.filter(p => p.resolved).length,
    mewManage: {
      validateExit: validate.code,
      parentResolved: validateResolved,
      parentMissingEvidence,
      note: 'exit!=0 with Non-resolvable parent POM naming topinfo-parent 2.2.3-SNAPSHOT = accurate missing-parent verdict'
    },
    log: path.basename(logPath)
  }
  const summary = loadSummary() || {}
  summary.restoreProbe = verdict
  saveSummary(summary)

  assert.equal(repoReachable, true, 'configured repository layer must be reachable for the bounded probe; unreachable environment fails loudly here')
  for (const p of probes) {
    if (p.resolved) assert.ok(true) // a resolved probe is legitimate; evidence records it
    else assert.ok(p.timedOut || p.exitCode !== 0, `unresolved probe must record a real failure exit for ${p.coordinate}`)
  }
  assert.equal(verdict.mewManage.parentResolved && verdict.mewManage.parentMissingEvidence, false, 'verdict must not claim both resolved and missing')
  assert.ok(parentMissingEvidence || validateResolved, 'maven must produce a decisive parent-resolution verdict')
  if (!validateResolved) {
    assert.equal(parentMissingEvidence, true, 'missing-parent verdict must name topinfo-parent 2.2.3-SNAPSHOT in real maven output')
  }
})

test('aggregate sibling build: predicted-blocked modules must actually be blocked, no fake success', { skip: GATED ? false : 'requires FB_RELEASE_JAVA_BUILD=1 (bounded maven build)' }, t => {
  ensureEvidenceDir()
  const logPath = logFile('aggregate-build')
  const log = []
  const isoRepo = path.join(fixture.EVIDENCE_DIR, 'm2-isolated')
  fs.mkdirSync(isoRepo, { recursive: true })
  const seedResult = fixture.seedIsolatedRepo(isoRepo, log)
  const buildDir = path.join(fixture.EVIDENCE_DIR, `build-${RUN_ID}`)
  fixture.prepareBuildDir(buildDir, log)
  const audit = fixture.auditInternalDeps()
  fs.writeFileSync(logPath, `# aggregate build run ${RUN_ID}\n${log.join('\n')}\n`)

  // Plugins reviewed in prepare phase: aggregator only wires compiler(source/target 8),
  // install/deploy skip, module poms only reference maven-source-plugin. No exec/antrun.
  // Unit-test reality: the 16 modules declare no src/test sources, so `mvn test`
  // runs zero tests honestly rather than skipping anything.
  const startedAt = new Date().toISOString()
  const build = fixture.runShell(`mvn -B -fae test "-Dmaven.repo.local=${isoRepo}" -f "${path.join(buildDir, 'pom-module.xml')}"`, { timeoutMs: 570000 })
  const endedAt = new Date().toISOString()
  fs.appendFileSync(logPath, `\n===== mvn -B -fae test (started ${startedAt}) =====\nexit=${build.code} signal=${build.signal} timedOut=${build.timedOut}\n${build.stdout}\n${build.stderr}\n`)

  const parsed = fixture.parseReactorSummary(build.stdout)
  const aggregatorRow = parsed.modules.find(m => m.name.startsWith('mew-manage-boot'))
  const moduleRows = parsed.modules.filter(m => m !== aggregatorRow)
  const testsTotal = parsed.surefireRuns.reduce((acc, r) => acc + r.run, 0)
  const verdict = {
    runId: RUN_ID,
    startedAt, endedAt,
    exitCode: build.code,
    timedOut: build.timedOut,
    buildOverall: parsed.overall,
    totalTime: parsed.totalTime,
    seed: seedResult,
    reactorModules: parsed.modules,
    successCount: moduleRows.filter(m => m.status === 'SUCCESS').length,
    failureCount: moduleRows.filter(m => m.status === 'FAILURE').length,
    skippedCount: moduleRows.filter(m => m.status === 'SKIPPED').length,
    predictedBuildable: audit.predictedBuildable,
    unresolvedArtifacts: parsed.unresolvedArtifacts,
    couldNotResolveDeps: parsed.couldNotResolveDeps,
    unitTestsRun: testsTotal,
    unitTestNote: '16 sibling modules declare no src/test sources; any nonzero count comes from real surefire execution',
    buildDir,
    log: path.basename(logPath)
  }
  const summary = loadSummary() || {}
  summary.aggregateBuild = verdict
  saveSummary(summary)

  assert.equal(build.spawnFailed, false, 'maven must actually run')
  assert.equal(build.timedOut, false, 'build must complete inside the bounded budget; exceeding it is recorded as blocked, not silently accepted')
  assert.ok(parsed.overall, 'maven must report an overall build result')
  assert.equal(moduleRows.length, 16, 'reactor summary must cover all 16 sibling modules')
  // Prediction vs reality: modules predicted blocked must not sneak out SUCCESS,
  // and at least one real failure must carry verbatim missing-dependency evidence.
  assert.equal(verdict.successCount, verdict.predictedBuildable, `SUCCESS count must equal the audit prediction (${verdict.predictedBuildable}); got ${verdict.successCount}`)
  assert.ok(verdict.failureCount + verdict.skippedCount === 16 - verdict.successCount, 'every non-success module must be accounted as FAILURE or SKIPPED')
  if (verdict.failureCount > 0) {
    assert.ok(verdict.unresolvedArtifacts.length > 0 || verdict.couldNotResolveDeps.length > 0, 'module failures must carry recorded missing-dependency evidence')
  }
  if (verdict.predictedBuildable === 0) {
    assert.equal(verdict.failureCount >= 1, true, 'with a zero buildable prediction at least the primary blockers must record real FAILURE rows')
    assert.equal(verdict.unitTestsRun, 0, 'no unit tests may be claimed when nothing compiled')
  }
})

test('release validation java evidence is present and coherent', { skip: fs.existsSync(path.join(fixture.EVIDENCE_DIR, 'summary.json')) ? false : 'no gated run has been recorded yet; set FB_RELEASE_JAVA_BUILD=1 to produce evidence' }, () => {
  const summary = loadSummary()
  assert.ok(summary, 'summary.json must exist')
  assert.ok(summary.restoreProbe, 'restore probe verdict recorded')
  assert.ok(summary.aggregateBuild, 'aggregate build verdict recorded')
  assert.ok(summary.staticAudit, 'static dependency audit recorded')
  const tcFiles = fs.readdirSync(fixture.EVIDENCE_DIR).filter(n => n.startsWith('toolchain-'))
  assert.ok(tcFiles.length >= 1, 'toolchain evidence recorded')
  for (const section of ['restoreProbe', 'aggregateBuild']) {
    const logPath = path.join(fixture.EVIDENCE_DIR, summary[section].log)
    assert.equal(fs.existsSync(logPath), true, `log referenced by ${section} must exist`)
    assert.ok(fs.statSync(logPath).size > 0, `${section} log must not be empty`)
  }
  assert.ok(summary.restoreProbe.mewManage, 'mew-manage verdict recorded')
  assert.equal(typeof summary.aggregateBuild.successCount, 'number', 'aggregate build success count recorded')
})
} else {
  // Default path: no legacy require, no legacy read, no legacy evidence write.
  // Exactly ONE explicit skip is registered so a fresh clone (lacking the
  // gitignored fixture) still runs this whole file green, and a default full
  // regression never overwrites the historical java/ summary or logs. The
  // skip is honest: it is reported as skipped, never as a pass, and the
  // accurate TopInfo 2.2.3 blocked verdict stays exactly as recorded.
  test('java-contract legacy slice: not portable, skipped unless FB_RELEASE_JAVA_HISTORY=1 with accurate fixture restored', { skip: 'historical reference validation is not a portable test; enable FB_RELEASE_JAVA_HISTORY=1 only after the accurate fixture and tooling are explicitly restored (历史参考验证不是可移植测试，须显式恢复准确fixture/工具)' }, () => {
    assert.equal(LEGACY_HISTORY && LEGACY_FIXTURE_PRESENT, false, 'legacy body must never execute without the explicit guard')
  })
}

// ---------------------------------------------------------------------------
// Java synthetic contract slice — fully isolated from the byte-accurate fixture
// above. It touches no legacy source, no legacy manifest and no legacy evidence.
//
// Scope and honesty rules (same conventions as the legacy slice):
// - fixtures/java-synthetic-contract/ is a MINIMAL SYNTHETIC
//   Controller->Service->Mapper demo written for this repo. It is NOT TopInfo,
//   NOT production code and NOT an accurate business compilation. No Spring or
//   MyBatis runtime exists, runs or is claimed; the xml file is a text-only
//   field-mapping contract that nothing ever loads or parses.
// - Always-on tests cover fixture presence, purity (no TopInfo/framework
//   tokens), probe scenario coverage, the xml text contract and fresh-clone
//   portability (subprocess without the legacy fixture). They never claim
//   that a compile happened.
// - The gated test needs BOTH FB_JAVA_JAVAC and FB_JAVA_JAVA: absolute paths
//   to a standard JDK's javac.exe/java.exe, verified as real regular files
//   with no symlink. It really compiles with --release 8 and really runs the
//   probe via spawnSync(shell:false, bounded timeout) with absolute tool
//   paths only — no maven, no .m2, no network. Evidence (argv/stdout/stderr/
//   exit/sha256/class list) is written EXCLUSIVELY into the new dir
//   .validation-output/release-validation/java-synthetic-02/ with unique
//   names and exclusive 'wx' writes, so the already-reported java-synthetic-01
//   evidence is never touched. The compiled classes dir is KEPT as evidence
//   data: nothing under the evidence dir is ever deleted.
// - Without those env vars the gated test registers as a portable skip and
//   writes no compile evidence (only the fresh-clone copy below is written).
// - No fake green: skipped is skipped; the accurate TopInfo 2.2.3 verdict
//   stays BLOCKED exactly as recorded by the guarded legacy slice.
// ---------------------------------------------------------------------------
const SYNTH_DIR = path.join(__dirname, 'fixtures', 'java-synthetic-contract')
const SYNTH_OUT_DIR = path.join(__dirname, '..', '.validation-output', 'release-validation', 'java-synthetic-02')
const SYNTH_JAVAC = process.env.FB_JAVA_JAVAC || ''
const SYNTH_JAVA = process.env.FB_JAVA_JAVA || ''
const SYNTH_CAN_RUN = SYNTH_JAVAC.length > 0 && SYNTH_JAVA.length > 0
const SYNTH_SPAWN = require('child_process').spawnSync
const SYNTH_CRYPTO = require('crypto')
const SYNTH_SOURCES = [
  { file: 'SynthUser.java', decl: 'public class SynthUser' },
  { file: 'SynthUserMapper.java', decl: 'public interface SynthUserMapper' },
  { file: 'SynthUserService.java', decl: 'public interface SynthUserService' },
  { file: 'SynthUserController.java', decl: 'public class SynthUserController' },
  { file: 'SynthContractProbe.java', decl: 'public class SynthContractProbe' },
]
const SYNTH_XML = 'synth-user-mapping.xml'
// Full qualifiers only: the synthetic sources may disclaim Spring/MyBatis in
// their comments, they must simply never contain framework packages or any
// TopInfo identifier.
const SYNTH_PURITY_TOKENS = ['org.springframework', 'org.apache.ibatis', 'SpringBootApplication', '@Autowired', 'TopInfo', 'topinfo']
// Must stay in sync with the PASS/FAIL check ids inside SynthContractProbe.java.
const SYNTH_PROBE_CHECK_COUNT = 43

// Every tmp/evidence path is brand new: loop until a non-existing name is
// found, then create it exclusively — never reuse or overwrite anything.
function synthFreshPath(base) {
  for (let i = 0; ; i++) {
    const candidate = `${base}${i ? '-' + i : ''}`
    if (!fs.existsSync(candidate)) return candidate
  }
}

// Tool seam honesty: absolute path, existing regular file, no symlink.
function synthAssertRealTool(tool, label) {
  assert.equal(path.isAbsolute(tool), true, `${label} must be an absolute path, got: ${tool}`)
  assert.equal(fs.existsSync(tool), true, `${label} must point at an existing file, got: ${tool}`)
  const st = fs.lstatSync(tool)
  assert.equal(st.isSymbolicLink(), false, `${label} must not be a symlink: ${tool}`)
  assert.equal(st.isFile(), true, `${label} must be a regular file: ${tool}`)
}

test('java-synthetic fixture sources exist and stay free of TopInfo/framework tokens', () => {
  for (const src of SYNTH_SOURCES) {
    const text = fs.readFileSync(path.join(SYNTH_DIR, src.file), 'utf8')
    assert.ok(text.includes(src.decl), `${src.file} must declare ${src.decl}`)
    assert.ok(text.length > 200, `${src.file} must carry real content, not a placeholder`)
    for (const token of SYNTH_PURITY_TOKENS) {
      assert.equal(text.includes(token), false, `${src.file} must not contain "${token}"`)
    }
  }
  const xml = fs.readFileSync(path.join(SYNTH_DIR, SYNTH_XML), 'utf8')
  for (const token of SYNTH_PURITY_TOKENS) {
    assert.equal(xml.includes(token), false, `${SYNTH_XML} must not contain "${token}"`)
  }
})

test('java-synthetic probe covers the mandated scenario families', () => {
  const probeText = fs.readFileSync(path.join(SYNTH_DIR, 'SynthContractProbe.java'), 'utf8')
  for (const marker of ['checkFieldContract', 'checkPagination', 'checkRequiredFields', 'checkAuthorization', 'checkMissingRecord', 'checkTransactionRollback', 'checkXmlMappingText']) {
    assert.ok(probeText.includes(marker), `probe must implement ${marker}`)
  }
  assert.ok(probeText.includes('TOTAL pass='), 'probe must print a real pass/fail total line')
  assert.ok(probeText.includes('System.exit(fail == 0 ? 0 : 1)'), 'probe exit code must be honest: 0 only when fail==0')
})

test('java-synthetic xml field mapping holds the exact column/property pairs as text', () => {
  const text = fs.readFileSync(path.join(SYNTH_DIR, SYNTH_XML), 'utf8')
  assert.ok(text.includes('text-only field-mapping contract'), 'xml must self-describe as a text-only contract, not a framework config')
  for (const element of [
    '<id property="id" column="id" />',
    '<result property="username" column="username" />',
    '<result property="email" column="email" />',
    '<result property="status" column="status" />',
    '<result property="createdAt" column="created_at" />',
  ]) {
    assert.ok(text.includes(element), `missing exact mapping element: ${element}`)
  }
  assert.equal((text.match(/<result /g) || []).length, 4, 'exactly four <result> mappings expected')
  assert.equal((text.match(/<id /g) || []).length, 1, 'exactly one <id> key mapping expected')
  assert.ok(text.includes('username, email, status, created_at'), 'insert column list must match the contract columns')
})

test('java-synthetic fresh-clone portability: subprocess without legacy fixture stays green', { skip: process.env.FB_JAVA_SYNTH_FRESHCLONE_SUPPRESS === '1' ? 'nested freshclone suppressed inside the verification subprocess' : false }, () => {
  fs.mkdirSync(SYNTH_OUT_DIR, { recursive: true })
  const freshRoot = synthFreshPath(path.join(SYNTH_OUT_DIR, `freshclone-${RUN_ID}-${process.pid}`))
  fs.mkdirSync(path.join(freshRoot, 'tests', 'fixtures', 'java-synthetic-contract'), { recursive: true })
  // Copy ONLY this test file plus the synthetic fixtures. The legacy
  // java-contract fixture (gitignored) is deliberately absent, exactly like a
  // fresh clone. Nothing pre-existing is ever copied over or overwritten.
  fs.copyFileSync(path.join(__dirname, 'java-contract.test.cjs'), path.join(freshRoot, 'tests', 'java-contract.test.cjs'))
  for (const name of SYNTH_SOURCES.map(s => s.file).concat([SYNTH_XML])) {
    fs.copyFileSync(path.join(SYNTH_DIR, name), path.join(freshRoot, 'tests', 'fixtures', 'java-synthetic-contract', name))
  }

  // Run the copy with all legacy/compile env vars stripped, so the child must
  // survive without the legacy fixture AND must not attempt any real run.
  const childEnv = { ...process.env }
  delete childEnv.FB_JAVA_JAVAC
  delete childEnv.FB_JAVA_JAVA
  delete childEnv.FB_RELEASE_JAVA_HISTORY
  delete childEnv.FB_RELEASE_JAVA_BUILD
  // Detach the child from the surrounding node:test runner context too:
  // otherwise node:test sees a nested run() and silently skips every file.
  for (const key of Object.keys(childEnv)) {
    if (/^NODE_TEST|^TEST_/.test(key)) delete childEnv[key]
  }
  childEnv.FB_JAVA_SYNTH_FRESHCLONE_SUPPRESS = '1'
  const child = SYNTH_SPAWN(process.execPath, ['--test', path.join(freshRoot, 'tests', 'java-contract.test.cjs')], { shell: false, encoding: 'utf8', timeout: 60000, env: childEnv, cwd: freshRoot })
  const out = `${child.stdout || ''}\n${child.stderr || ''}`

  fs.writeFileSync(path.join(SYNTH_OUT_DIR, `freshclone-${RUN_ID}-${process.pid}.log`), out, { flag: 'wx' })
  console.log(`[java-synthetic] fresh-clone subprocess copy kept at: ${freshRoot}`)

  assert.ifError(child.error)
  assert.equal(child.status, 0, `fresh-clone subprocess must exit 0 even without the legacy fixture\n--- stdout ---\n${child.stdout}\n--- stderr ---\n${child.stderr}`)
  const count = label => { const m = new RegExp(`(?:^|\\n)\\W*${label} (\\d+)`).exec(out); return m ? Number(m[1]) : null }
  assert.equal(count('tests'), 6, `fresh clone must register 6 tests (1 legacy skip + 3 synthetic static + 1 gated skip + 1 suppressed nested freshclone), got ${count('tests')}`)
  assert.equal(count('pass'), 3, `fresh clone must pass exactly the 3 synthetic static tests, got ${count('pass')}`)
  assert.equal(count('fail'), 0, `fresh clone must have zero failures, got ${count('fail')}`)
  assert.equal(count('skipped'), 3, `fresh clone must skip legacy slice + gated run + nested freshclone, got ${count('skipped')}`)
  assert.ok(out.includes('legacy slice'), 'the explicit legacy skip marker must be registered in the fresh clone')
  assert.ok(out.includes('requires FB_JAVA_JAVAC'), 'the synthetic gated run must be skipped, never silently attempted')
  assert.equal(fs.existsSync(path.join(freshRoot, '.validation-output')), false, 'a fresh-clone default run must not create any evidence dir at all')
})

test('java-synthetic real run: JDK17 javac --release 8 compile + contract probe', { skip: SYNTH_CAN_RUN ? false : 'requires FB_JAVA_JAVAC + FB_JAVA_JAVA (absolute, link-free javac.exe/java.exe paths); registers as a portable skip by default' }, () => {
  synthAssertRealTool(SYNTH_JAVAC, 'FB_JAVA_JAVAC')
  synthAssertRealTool(SYNTH_JAVA, 'FB_JAVA_JAVA')

  fs.mkdirSync(SYNTH_OUT_DIR, { recursive: true })
  // Brand-new classes dir, then KEPT forever as evidence data — nothing under
  // the evidence dir is ever deleted.
  const classesDir = synthFreshPath(path.join(SYNTH_OUT_DIR, `classes-${RUN_ID}-${process.pid}`))
  fs.mkdirSync(classesDir, { recursive: true })

  const xmlAbs = path.join(SYNTH_DIR, SYNTH_XML)
  const sourceAbs = SYNTH_SOURCES.map(s => path.join(SYNTH_DIR, s.file))
  const sourceHashes = {}
  for (const src of SYNTH_SOURCES) {
    sourceHashes[src.file] = SYNTH_CRYPTO.createHash('sha256').update(fs.readFileSync(path.join(SYNTH_DIR, src.file))).digest('hex')
  }
  sourceHashes[SYNTH_XML] = SYNTH_CRYPTO.createHash('sha256').update(fs.readFileSync(xmlAbs)).digest('hex')

  const javacTimeoutMs = 120000
  const probeTimeoutMs = 60000
  const javacArgv = [SYNTH_JAVAC, '-encoding', 'UTF-8', '--release', '8', '-d', classesDir].concat(sourceAbs)
  const javac = SYNTH_SPAWN(javacArgv[0], javacArgv.slice(1), { shell: false, encoding: 'utf8', timeout: javacTimeoutMs })
  const probeArgv = [SYNTH_JAVA, '-Dfile.encoding=UTF-8', '-cp', classesDir, 'SynthContractProbe', xmlAbs]
  const probe = javac.status === 0 ? SYNTH_SPAWN(probeArgv[0], probeArgv.slice(1), { shell: false, encoding: 'utf8', timeout: probeTimeoutMs }) : null

  const classFiles = fs.readdirSync(classesDir)
  const javacTimedOut = Boolean(javac.error && javac.error.code === 'ETIMEDOUT')
  const probeTimedOut = Boolean(probe && probe.error && probe.error.code === 'ETIMEDOUT')

  const totalsMatch = probe ? /TOTAL pass=(\d+) fail=(\d+)/.exec(probe.stdout || '') : null
  const evidence = {
    runId: RUN_ID,
    kind: 'synthetic contract demo (not TopInfo, not production, no Spring/MyBatis runtime claimed)',
    javac: { argv: javacArgv, exitCode: javac.status, timedOut: javacTimedOut, timeoutMs: javacTimeoutMs, stdout: javac.stdout || '', stderr: javac.stderr || '' },
    probe: probe ? { argv: probeArgv, exitCode: probe.status, timedOut: probeTimedOut, timeoutMs: probeTimeoutMs, stdout: probe.stdout || '', stderr: probe.stderr || '' } : null,
    sourceHashes,
    classFiles,
    classesDir,
    classesKeptNote: 'classes dir is kept as evidence data; nothing under the evidence dir is deleted',
    probeTotals: totalsMatch ? { pass: Number(totalsMatch[1]), fail: Number(totalsMatch[2]) } : null,
    passLines: probe ? ((probe.stdout || '').match(/^PASS /gm) || []).length : 0,
    failLines: probe ? ((probe.stdout || '').match(/^FAIL /gm) || []).length : 0,
  }
  const evidencePath = `${synthFreshPath(path.join(SYNTH_OUT_DIR, `java-synthetic-${RUN_ID}-${process.pid}`))}.json`
  evidence.evidenceFile = evidencePath
  // Exclusive write: a name collision fails loudly instead of overwriting.
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), { flag: 'wx' })

  console.log(`[java-synthetic] javac exit=${javac.status} probe exit=${probe ? probe.status : 'not-run'} evidence=${evidencePath}`)
  console.log(`[java-synthetic] classes dir kept as evidence: ${classesDir}`)

  assert.equal(javacTimedOut, false, 'javac must finish inside the bounded timeout instead of hanging')
  assert.equal(javac.status, 0, `javac --release 8 must exit 0\n--- javac stdout ---\n${javac.stdout}\n--- javac stderr ---\n${javac.stderr}`)
  assert.equal(classFiles.includes('SynthContractProbe.class'), true, 'compile must produce SynthContractProbe.class')
  assert.ok(probe, 'probe must actually run after a successful compile')
  assert.equal(probeTimedOut, false, 'probe must finish inside the bounded timeout instead of hanging')
  assert.equal(probe.status, 0, `contract probe must exit 0\n--- probe stdout ---\n${probe.stdout}\n--- probe stderr ---\n${probe.stderr}`)
  assert.ok(totalsMatch, 'probe must print a TOTAL pass/fail line')
  assert.equal(evidence.probeTotals.pass, SYNTH_PROBE_CHECK_COUNT, `probe must run exactly ${SYNTH_PROBE_CHECK_COUNT} checks`)
  assert.equal(evidence.probeTotals.fail, 0, 'probe failures must be zero')
  assert.equal(evidence.passLines, evidence.probeTotals.pass, 'PASS line count must agree with the printed TOTAL')
  assert.equal(evidence.failLines, evidence.probeTotals.fail, 'FAIL line count must agree with the printed TOTAL')
})
