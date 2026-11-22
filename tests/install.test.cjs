'use strict'

// install.test.cjs — manage-fb-skill 安装/清理门禁回归。
//
// 原则：
//   * 全部写入只发生在临时目录（mkdtemp），绝不向真实 HOME / 真实项目写；
//   * 不使用绕门禁 flag；模拟批准一律走实际 workflow.recordApproval API，
//     仅用于隔离测试，不构成当前会话或任何业务的真实人批准；
//   * CLI 用例通过 spawnSync 走实际进程，校验退出码与磁盘影响范围。

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const W = require('../skills/create-fb-feature/scripts/workflow.cjs')
const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')
const I = require('../skills/manage-fb-skill/scripts/lib/installer.cjs')

const REPO_ROOT = path.resolve(__dirname, '..')
const INSTALL_CLI = path.join(REPO_ROOT, 'skills', 'manage-fb-skill', 'scripts', 'install.cjs')
const NAMES = ['create-fb-feature', 'use-fbjs-vue2', 'manage-fb-skill']

let seq = 0

function tmpdir (t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-install-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function sha (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

// 项目根整树快照：rel -> 'dir' | 'link' | 内容 sha256；用于零写入断言与影响范围断言。
function snapshot (root) {
  const out = {}
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name)
      const key = rel ? rel + '/' + entry.name : entry.name
      if (entry.isSymbolicLink()) out[key] = 'link'
      else if (entry.isDirectory()) { out[key] = 'dir'; walk(full, key) }
      else out[key] = sha(fs.readFileSync(full))
    }
  }
  walk(root, '')
  return out
}

function fixtureCatalog () {
  const entry = (p, kind, contents) => {
    const variants = contents.map(c => ({ sources: ['fixture'], bytes: Buffer.byteLength(c), contentSha256: sha(Buffer.from(c, 'latin1')), canonicalLfSha256: sha(Buffer.from(c.replace(/\r\n/g, '\n'), 'latin1')) }))
    const empty = variants.every(v => v.bytes === 0)
    return { path: p, kind, empty, requiresAnchor: kind === 'generic' || empty, variants }
  }
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    package: { name: 'fb-rules', version: '1.0.13' },
    sources: [{ id: 'fixture', root: 'fixture://', name: 'fb-rules', version: '1.0.13', fileCount: 5 }],
    emptyDirs: [],
    matching: { rule: 'fixture', anchorRule: 'fixture', anchorMinExclusiveMatches: 8 },
    notes: [],
    files: [
      entry('.fb/rules/COMMON/COMMON--a.md', 'exclusive', ['COMMON-A-V1\n']),
      entry('.comate/rules/agent_guide.md', 'exclusive', ['COMATE-GUIDE-V1\n']),
      entry('.lingma/index.json', 'anchor', ['{"lingma":{"version":"1.0.13"}}\n']),
      entry('.comate/mcp.json', 'generic', ['{"mcpServers":{}}\n']),
      entry('.calude/CLAUDE.md', 'generic', [''])
    ]
  }
}

// 构造 fixture bundle（仓库布局 bundle-src/skills/<3 skills>）。
function makeBundle (t, opts = {}) {
  const root = tmpdir(t)
  const skillsRoot = path.join(root, 'bundle-src', 'skills')
  const version = opts.version || '0.2.0'
  const rev = opts.rev || 'v1'
  fs.mkdirSync(skillsRoot, { recursive: true })
  for (const name of NAMES) {
    const dir = path.join(skillsRoot, name)
    fs.mkdirSync(path.join(dir, 'references'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: ' + name + '\ndescription: fixture skill ' + name + ' for installer tests\n---\n# ' + name + '\nRead [ref](references/ref.md) first.\n')
    fs.writeFileSync(path.join(dir, 'references', 'ref.md'), 'REF ' + name + ' ' + rev + '\n')
    fs.writeFileSync(path.join(dir, 'scripts', 'tool.cjs'), '// tool ' + name + ' ' + rev + '\n')
  }
  fs.writeFileSync(path.join(skillsRoot, 'manage-fb-skill', 'bundle.json'), JSON.stringify({ schemaVersion: 1, name: 'fb-skill', version: version, skills: NAMES, format: 'agent-skills', note: 'fixture bundle metadata' }))
  fs.mkdirSync(path.join(skillsRoot, 'manage-fb-skill', 'legacy'), { recursive: true })
  fs.writeFileSync(path.join(skillsRoot, 'manage-fb-skill', 'legacy', 'catalog.json'), JSON.stringify(opts.catalog || fixtureCatalog()))
  return { root, skillsRoot, sourceRoot: path.join(root, 'bundle-src') }
}

// 在目标项目写入与 catalog 精确匹配的旧规则文件。
function writeLegacy (root, opts = {}) {
  const put = (rel, content) => {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  put('.fb/rules/COMMON/COMMON--a.md', opts.crlf ? 'COMMON-A-V1\r\n' : 'COMMON-A-V1\n')
  put('.comate/rules/agent_guide.md', 'COMATE-GUIDE-V1\n')
  put('.comate/mcp.json', '{"mcpServers":{}}\n')
  put('.calude/CLAUDE.md', '')
  if (opts.index !== false) put('.lingma/index.json', '{"lingma":{"version":"1.0.13"}}\n')
  if (opts.modified) put('.fb/rules/COMMON/COMMON--user-edit.md', 'USER MODIFIED\n')
  if (opts.extra) put('.fb/rules/COMMON/custom-unknown.md', 'UNKNOWN EXTRA\n')
  return root
}

function fixtureOperator () {
  seq++
  return {
    schema: 'fb-feature-identity/v1',
    name: '集成验证操作人' + seq,
    status: 'confirmed',
    fixture: false,
    revision: 1,
    confirmation: { method: 'user-message', sourceRef: 'user-message:installer-it-' + seq, text: '同意按本计划执行', confirmedAt: new Date().toISOString() }
  }
}

function approve (root, id, planResult) {
  seq++
  return W.recordApproval({
    projectRoot: root,
    id: id,
    operator: fixtureOperator(),
    evidence: { kind: 'user-message', reference: 'msg-installer-it-' + seq, text: '同意按本计划执行' },
    planHash: planResult.hash,
    revision: planResult.revision
  })
}

function eventTypes (root, id) {
  const file = path.join(root, '.agents', 'fb-feature', 'workflows', id, 'events.jsonl')
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l).type)
}

// ---------------------------------------------------------------------------

test('host-plan install metadata preserves its approval source for packed consumers', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  const hostApproval = { reference: 'isolated-host-install-source' }
  const planned = I.createInstallPlan({ projectRoot: project, action: 'install',
    id: 'host-install', skillSource: bundle.skillsRoot, hostApproval })
  assert.deepEqual(W.readWorkflow({ projectRoot: project, id: 'host-install' }).plan.metadata.hostApproval, hostApproval)
  assert.equal(planned.ok, true)
})

test('1. scan 是纯 dry-run：零写入、无 .agents、逐文件计数正确', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  writeLegacy(project, { index: false, extra: true })
  const before = snapshot(project)
  const report = I.scan({ projectRoot: project, action: 'install-and-clean', skillSource: bundle.skillsRoot })
  assert.equal(report.ok, true)
  assert.equal(report.readOnly, true)
  assert.equal(report.counts.install.create, 11) // 3 skills × (SKILL.md + ref.md + tool.cjs) + bundle.json + catalog.json = 11
  assert.equal(report.counts.install.conflict, 0)
  assert.equal(report.counts.legacy.cleanCandidates, 2) // 两个独占文件可清；generic/空文件无锚保留
  assert.equal(report.counts.legacy.unknownExtra, 1)
  assert.equal(report.counts.legacy.anchorOk, false)
  assert.deepEqual(snapshot(project), before)
})

test('2. plan 只经 workflow.createPlan 写唯一 plan-vN.json，payload 绑定哈希', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  const before = snapshot(project)
  const plan = I.createInstallPlan({ projectRoot: project, id: 'plan-binding', action: 'install', skillSource: bundle.skillsRoot })
  assert.equal(plan.revision, 1)
  assert.equal(plan.counts.install.create, 11)
  const after = snapshot(project)
  const added = Object.keys(after).filter(k => before[k] === undefined)
  assert.ok(added.length >= 1)
  const workflowAncestors = new Set(['.agents', '.agents/fb-feature', '.agents/fb-feature/workflows', '.agents/fb-feature/workflows/plan-binding'])
  for (const key of added) {
    assert.ok(key.startsWith('.agents/fb-feature/workflows/plan-binding/') || workflowAncestors.has(key), 'plan 只能写 workflow 目录：' + key)
  }
  const planFile = path.join(project, '.agents', 'fb-feature', 'workflows', 'plan-binding', 'plans', 'plan-v1.json')
  const stored = JSON.parse(fs.readFileSync(planFile, 'utf8'))
  assert.equal(F.hashObject(F.withoutHash(stored)), stored.hash, 'plan 文件与自身 hash 绑定')
  assert.equal(stored.metadata.installation.action, 'install')
  assert.equal(stored.metadata.installation.install.ops.length, 11)
  assert.deepEqual(eventTypes(project, 'plan-binding'), ['plan-created'])
})

test('3. 未批准的 apply 直接拒绝（NOT_APPROVED）且零写入', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  I.createInstallPlan({ projectRoot: project, id: 'no-approve', action: 'install', skillSource: bundle.skillsRoot })
  const before = snapshot(project)
  assert.throws(() => I.applyPlan({ projectRoot: project, id: 'no-approve' }), e => e.code === 'NOT_APPROVED')
  assert.deepEqual(snapshot(project), before, '未批准时不能有任何写入')
})

test('4. 模拟批准通过实际 API 后 install-and-clean：创建/精确清理/复验/审计事件', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  writeLegacy(project) // 含 .lingma/index.json 精确命中 → 强锚成立
  const plan = I.createInstallPlan({ projectRoot: project, id: 'happy-path', action: 'install-and-clean', skillSource: bundle.skillsRoot })
  assert.equal(plan.counts.install.create, 11)
  assert.equal(plan.counts.legacy.cleanCandidates, 5) // 2 独占 + 2 generic(锚成立) + anchor 文件
  approve(project, 'happy-path', plan)
  const report = I.applyPlan({ projectRoot: project, id: 'happy-path' })
  assert.equal(report.ok, true)
  assert.equal(report.install.created.length, 11) // 严格等于扫描的 bundle 文件数
  assert.equal(report.install.manifest.fileCount, 11)
  assert.equal(report.legacy.removed.length, 5)
  assert.equal(report.legacy.failed.length, 0)
  assert.equal(report.verification.ok, true)
  const manifest = JSON.parse(fs.readFileSync(path.join(project, '.agents', 'fb-feature', 'install-manifest.json'), 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.root, I.toPosix(fs.realpathSync(project)))
  assert.ok(manifest.files['.agents/skills/create-fb-feature/SKILL.md'])
  assert.ok(manifest.files['.agents/skills/manage-fb-skill/bundle.json'])
  assert.equal(fs.existsSync(path.join(project, '.agents/skills/.fb-skill-source.json')), false)
  // 目标内容与来源一致
  assert.equal(fs.readFileSync(path.join(project, '.agents', 'skills', 'create-fb-feature', 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(bundle.skillsRoot, 'create-fb-feature', 'SKILL.md'), 'utf8'))
  // 精确清理后目录仍存在（不递归删除、不清空工具目录），.lingma/index.json 也已清除
  assert.ok(fs.existsSync(path.join(project, '.fb', 'rules', 'COMMON')))
  assert.ok(fs.existsSync(path.join(project, '.comate')))
  assert.ok(!fs.existsSync(path.join(project, '.lingma', 'index.json')))
  // 备份存在且哈希等于清理前内容
  const backup = path.join(project, '.agents', 'fb-feature', 'workflows', 'happy-path', 'backups', '.comate', 'mcp.json')
  assert.equal(sha(fs.readFileSync(backup)), sha(Buffer.from('{"mcpServers":{}}\n')))
  assert.deepEqual(eventTypes(project, 'happy-path'), ['plan-created', 'approval', 'implementation-start', 'implementation-complete'])
  // 复扫：全部 adopt、无清理候选
  const rescan = I.scan({ projectRoot: project, action: 'install-and-clean', skillSource: bundle.skillsRoot })
  assert.equal(rescan.counts.install.adopt, 11)
  assert.equal(rescan.counts.legacy.cleanCandidates, 0)
  assert.equal(rescan.counts.legacy.absent, 5)
})

test('5. 既有相同文件被 adopt：不重写内容、manifest 纳管', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  for (const name of NAMES) {
    const target = path.join(project, '.agents', 'skills', name, 'references', 'ref.md')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, 'REF ' + name + ' v1\n')
  }
  const before = snapshot(project)
  const plan = I.createInstallPlan({ projectRoot: project, id: 'adopt-case', action: 'install', skillSource: bundle.skillsRoot })
  assert.equal(plan.counts.install.adopt, 3)
  assert.equal(plan.counts.install.create, 8)
  approve(project, 'adopt-case', plan)
  const report = I.applyPlan({ projectRoot: project, id: 'adopt-case' })
  assert.equal(report.ok, true)
  assert.equal(report.install.adopted.length, 3)
  const after = snapshot(project)
  for (const name of NAMES) {
    assert.equal(after['.agents/skills/' + name + '/references/ref.md'], before['.agents/skills/' + name + '/references/ref.md'], 'adopt 文件未被重写')
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(project, '.agents', 'fb-feature', 'install-manifest.json'), 'utf8'))
  assert.ok(manifest.files['.agents/skills/create-fb-feature/references/ref.md'], 'adopt 文件纳入 manifest')
})

test('6. conflict 时整个 install 拒绝执行（零写入），并记 blocked 事件', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  const conflicting = path.join(project, '.agents', 'skills', 'use-fbjs-vue2', 'references', 'ref.md')
  fs.mkdirSync(path.dirname(conflicting), { recursive: true })
  fs.writeFileSync(conflicting, 'USER OWN CONTENT\n')
  const plan = I.createInstallPlan({ projectRoot: project, id: 'conflict-case', action: 'install', skillSource: bundle.skillsRoot })
  assert.equal(plan.counts.install.conflict, 1)
  approve(project, 'conflict-case', plan)
  const before = snapshot(project)
  assert.throws(() => I.applyPlan({ projectRoot: project, id: 'conflict-case' }), e => e.code === 'DRIFT_DETECTED' && /conflict/.test(e.message))
  const after = snapshot(project)
  const added = Object.keys(after).filter(k => before[k] === undefined)
  for (const key of added) assert.ok(key.startsWith('.agents/fb-feature/workflows/conflict-case/'), '拒绝执行时只允许审计目录新增：' + key)
  assert.ok(!fs.existsSync(path.join(project, '.agents', 'fb-feature', 'install-manifest.json')))
  assert.ok(eventTypes(project, 'conflict-case').includes('blocked'))
})

test('7. op path 双重防线：越界/不在 plan.files 的手造 payload 无法借 apply 写删文件', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  const victim = path.join(project, 'user-file.txt')
  fs.writeFileSync(victim, 'DO NOT DELETE\n')
  // 手造一份哈希合法的计划：files 清单不含目标，payload.install.ops 塞越界路径。
  const id = 'crafted-plan'
  const rootReal = fs.realpathSync(project)
  const craftedBody = {
    schema: W.PLAN_SCHEMA,
    id: id,
    revision: 1,
    kind: 'install',
    summary: 'crafted payload outside files list',
    files: ['.agents/skills/manage-fb-skill/SKILL.md'],
    acceptance: ['crafted fixture'],
    metadata: { installation: {
      schemaVersion: 1, tool: 'fb-skill-installer', id: id, action: 'install',
      projectRoot: I.toPosix(rootReal), location: '.agents/skills',
      bundle: { root: I.toPosix(bundle.skillsRoot), source: { name: 'fb-skill', version: '0.2.0' } },
      manifestPre: { exists: false, trusted: false, sha256: null },
      install: { ops: [{ op: 'create', path: '.agents/skills/../../user-file.txt', skill: 'create-fb-feature', sha256: sha(Buffer.from('x')), size: 1, preSha256: null, reason: null }], counts: { create: 1, update: 0, adopt: 0, conflict: 0 } },
      legacy: { anchor: { indexMatch: false, exclusiveExactMatches: 0, minExclusive: 8, ok: false }, clean: [], preserved: [], unknown: [], absentCount: 0, notes: [] },
      bundleValidations: [], bundleSkipped: [], createdAt: new Date().toISOString()
    } },
    projectRoot: rootReal,
    createdAt: new Date().toISOString(),
    createdAtUtc: new Date().toISOString()
  }
  craftedBody.hash = F.hashObject(F.withoutHash(craftedBody))
  const plansDir = path.join(project, '.agents', 'fb-feature', 'workflows', id, 'plans')
  fs.mkdirSync(plansDir, { recursive: true })
  fs.writeFileSync(path.join(plansDir, 'plan-v1.json'), JSON.stringify(craftedBody, null, 2) + '\n')
  seq++
  W.recordApproval({ projectRoot: project, id: id, operator: fixtureOperator(), evidence: { kind: 'user-message', reference: 'msg-crafted-' + seq, text: '同意按本计划执行' }, planHash: craftedBody.hash, revision: 1 })
  assert.throws(() => I.applyPlan({ projectRoot: project, id: id }), e => e.code === 'OP_PATH_INVALID' && /\.\./.test(e.message))
  assert.equal(fs.readFileSync(victim, 'utf8'), 'DO NOT DELETE\n')
  // 路径形状合法但不在 plan.files 清单内同样拒绝（v2 需按 revision 2 重算哈希）。
  craftedBody.metadata.installation.install.ops[0].path = '.agents/skills/create-fb-feature/SKILL.md'
  craftedBody.revision = 2
  craftedBody.hash = F.hashObject(F.withoutHash(craftedBody))
  fs.writeFileSync(path.join(plansDir, 'plan-v2.json'), JSON.stringify(craftedBody, null, 2) + '\n')
  seq++
  W.recordApproval({ projectRoot: project, id: id, operator: fixtureOperator(), evidence: { kind: 'user-message', reference: 'msg-crafted-b-' + seq, text: '同意按本计划执行' }, planHash: craftedBody.hash, revision: 2 })
  assert.throws(() => I.applyPlan({ projectRoot: project, id: id }), e => e.code === 'OP_PATH_NOT_IN_PLAN')
  assert.equal(fs.readFileSync(victim, 'utf8'), 'DO NOT DELETE\n')
})

test('8. bundle 内出现 symlink/junction 即拒绝整包；目标侧链接保留不跟随', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  // 目标侧：legacy 文件放行到链接目标（junction 指向项目内），扫描必须保留而非跟随。
  const inside = path.join(project, 'junction-target-inside')
  fs.mkdirSync(path.join(inside, 'COMMON'), { recursive: true })
  fs.writeFileSync(path.join(inside, 'COMMON', 'COMMON--a.md'), 'COMMON-A-V1\n')
  writeLegacy(project, { index: false })
  fs.rmSync(path.join(project, '.fb', 'rules', 'COMMON'), { recursive: true })
  fs.symlinkSync(path.join(inside, 'COMMON'), path.join(project, '.fb', 'rules', 'COMMON'), 'junction')
  const scan = I.scan({ projectRoot: project, action: 'clean-legacy', skillSource: bundle.skillsRoot })
  const linkOp = scan.legacyPreserved.find(op => op.path === '.fb/rules/COMMON/COMMON--a.md')
  assert.ok(linkOp, '链接祖先下的目标必须保留')
  assert.match(linkOp.reason, /ancestor-is-link/)
  assert.ok(!scan.legacyClean.some(op => op.path === '.fb/rules/COMMON/COMMON--a.md'))
  // bundle 侧：在 skill 目录里塞 junction → loadBundle 整包拒绝。
  const victimDir = path.join(bundle.skillsRoot, 'use-fbjs-vue2', 'references')
  fs.symlinkSync(path.join(bundle.root, 'bundle-src'), path.join(victimDir, 'linked-dir'), 'junction')
  try {
    assert.throws(() => I.loadBundle({ skillSource: bundle.skillsRoot }), /link/)
  } catch (error) {
    if (error.code === 'EPERM') t.skip('当前环境不允许创建目录链接')
    else throw error
  } finally {
    fs.rmSync(path.join(victimDir, 'linked-dir'), { force: true })
  }
})

test('9. 硬链接旧文件拒绝删除（nlink>1），其余精确文件继续清理，报告 ok=false', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  writeLegacy(project)
  fs.linkSync(path.join(project, '.comate', 'rules', 'agent_guide.md'), path.join(project, '.comate', 'rules', 'agent_guide.md.keep'))
  const plan = I.createInstallPlan({ projectRoot: project, id: 'hardlink-case', action: 'clean-legacy', skillSource: bundle.skillsRoot })
  assert.ok(plan.counts.legacy.cleanCandidates >= 4)
  approve(project, 'hardlink-case', plan)
  const report = I.applyPlan({ projectRoot: project, id: 'hardlink-case' })
  assert.equal(report.ok, false, '局部失败不得冒充通过')
  assert.equal(report.legacy.failed.length, 1)
  assert.equal(report.legacy.failed[0].code, 'HARDLINK_REFUSED')
  assert.ok(fs.existsSync(path.join(project, '.comate', 'rules', 'agent_guide.md')), '硬链接文件保留')
  assert.ok(fs.existsSync(path.join(project, '.comate', 'rules', 'agent_guide.md.keep')))
  assert.equal(report.legacy.removed.length, plan.counts.legacy.cleanCandidates - 1, '其余精确文件继续清理')
  assert.ok(eventTypes(project, 'hardlink-case').includes('implementation-complete'))
})

test('10. 被修改内容与未知额外文件保留；仅精确指纹被清；CRLF 变体按 EOL 匹配', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  writeLegacy(project, { crlf: true, modified: true, extra: true })
  const plan = I.createInstallPlan({ projectRoot: project, id: 'preserve-case', action: 'clean-legacy', skillSource: bundle.skillsRoot })
  const cleanPaths = plan.payload.legacy.clean.map(op => op.path)
  assert.ok(cleanPaths.includes('.comate/rules/agent_guide.md'))
  const crlfOp = plan.payload.legacy.clean.find(op => op.path === '.fb/rules/COMMON/COMMON--a.md')
  assert.ok(crlfOp, 'CRLF 版本按 EOL 变体命中')
  assert.equal(crlfOp.matchType, 'eol-variant')
  assert.ok(!cleanPaths.includes('.fb/rules/COMMON/COMMON--user-edit.md'), '被修改内容不入清理清单')
  approve(project, 'preserve-case', plan)
  const report = I.applyPlan({ projectRoot: project, id: 'preserve-case' })
  assert.equal(report.ok, true)
  assert.equal(fs.readFileSync(path.join(project, '.fb', 'rules', 'COMMON', 'COMMON--user-edit.md'), 'utf8'), 'USER MODIFIED\n')
  assert.equal(fs.readFileSync(path.join(project, '.fb', 'rules', 'COMMON', 'custom-unknown.md'), 'utf8'), 'UNKNOWN EXTRA\n')
  assert.ok(fs.existsSync(path.join(project, '.fb', 'rules', 'COMMON')), '目录保留')
  assert.ok(!fs.existsSync(path.join(project, '.comate', 'rules', 'agent_guide.md')))
  assert.equal(report.legacy.unknownCount, 2) // custom-unknown.md 与被修改的 COMMON--user-edit.md 都是未知额外内容
})

test('11. generic/空文件强锚：仅 index 命中（0 独占）不足，需独占文件 ≥1', t => {
  const bundle = makeBundle(t)
  const projectA = tmpdir(t)
  writeLegacy(projectA, { index: true })
  // 只留 index 命中：移除两个独占文件 → indexMatch=true 但独占命中 0 → generic 保留。
  fs.rmSync(path.join(projectA, '.comate', 'rules', 'agent_guide.md'))
  fs.rmSync(path.join(projectA, '.fb'), { recursive: true })
  const scanA = I.scan({ projectRoot: projectA, action: 'clean-legacy', skillSource: bundle.skillsRoot })
  assert.equal(scanA.counts.legacy.anchorOk, false)
  assert.ok(scanA.legacyPreserved.some(op => op.path === '.comate/mcp.json' && op.reason === 'no-strong-anchor'))
  assert.ok(scanA.legacyPreserved.some(op => op.path === '.calude/CLAUDE.md' && op.reason === 'no-strong-anchor'))
  // 恢复 1 个独占命中 → 锚成立 → generic 成为候选。
  const projectB = tmpdir(t)
  writeLegacy(projectB, { index: true })
  fs.rmSync(path.join(projectB, '.fb'), { recursive: true })
  const scanB = I.scan({ projectRoot: projectB, action: 'clean-legacy', skillSource: bundle.skillsRoot })
  assert.equal(scanB.counts.legacy.anchorOk, true)
  assert.ok(scanB.legacyClean.some(op => op.path === '.comate/mcp.json'))
})

test('12. stale plan：计划后目标被改 → DRIFT_DETECTED 零写入', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  writeLegacy(project)
  const plan = I.createInstallPlan({ projectRoot: project, id: 'stale-target', action: 'install-and-clean', skillSource: bundle.skillsRoot })
  approve(project, 'stale-target', plan)
  fs.writeFileSync(path.join(project, '.comate', 'rules', 'agent_guide.md'), 'CHANGED AFTER PLAN\n')
  const before = snapshot(project)
  assert.throws(() => I.applyPlan({ projectRoot: project, id: 'stale-target' }), e => e.code === 'DRIFT_DETECTED')
  assert.equal(fs.readFileSync(path.join(project, '.comate', 'rules', 'agent_guide.md'), 'utf8'), 'CHANGED AFTER PLAN\n')
  assert.ok(!fs.existsSync(path.join(project, '.agents', 'skills')), '漂移拒绝时目标目录未创建')
  assert.ok(eventTypes(project, 'stale-target').includes('blocked'))
})

test('13. 计划后 bundle 源被改 → DRIFT_DETECTED；修订 v2 才是新方案', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  const plan1 = I.createInstallPlan({ projectRoot: project, id: 'src-changed', action: 'install', skillSource: bundle.skillsRoot })
  approve(project, 'src-changed', plan1)
  fs.writeFileSync(path.join(bundle.skillsRoot, 'create-fb-feature', 'references', 'ref.md'), 'REF create-fb-feature v2\n')
  const before = snapshot(project)
  assert.throws(() => I.applyPlan({ projectRoot: project, id: 'src-changed' }), e => e.code === 'DRIFT_DETECTED' && /源文件变化/.test(e.message))
  // 拒绝时唯一的写入是被如实记录的 blocked 事件；目标文件零写入。
  const afterRefusal = snapshot(project)
  const eventsKey = '.agents/fb-feature/workflows/src-changed/events.jsonl'
  for (const key of Object.keys(afterRefusal)) {
    if (key === eventsKey) continue
    assert.equal(afterRefusal[key], before[key], '源变化拒绝时除 blocked 事件外零写入：' + key)
  }
  assert.ok(!fs.existsSync(path.join(project, '.agents', 'skills')))
  // 重新 plan 产生 v2；v1 的批准不授权 v2（旧批准不授权新方案）。
  const plan2 = I.createInstallPlan({ projectRoot: project, id: 'src-changed', action: 'install', skillSource: bundle.skillsRoot })
  assert.equal(plan2.revision, 2)
  assert.notEqual(plan2.hash, plan1.hash)
  assert.throws(() => I.applyPlan({ projectRoot: project, id: 'src-changed' }), e => e.code === 'NOT_APPROVED', 'v1 批准不能授权 v2')
  approve(project, 'src-changed', plan2)
  const report = I.applyPlan({ projectRoot: project, id: 'src-changed' })
  assert.equal(report.ok, true)
  assert.equal(report.install.created.length, 11)
})

test('14. manifest 篡改/不可信：按 conflict 处理并拒绝 install 覆盖', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  const plan1 = I.createInstallPlan({ projectRoot: project, id: 'manifest-tamper', action: 'install', skillSource: bundle.skillsRoot })
  approve(project, 'manifest-tamper', plan1)
  assert.equal(I.applyPlan({ projectRoot: project, id: 'manifest-tamper' }).ok, true)
  const manifestPath = path.join(project, '.agents', 'fb-feature', 'install-manifest.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  manifest.files['.agents/skills/use-fbjs-vue2/references/ref.md'] = 'a'.repeat(64)
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  fs.writeFileSync(path.join(bundle.skillsRoot, 'use-fbjs-vue2', 'references', 'ref.md'), 'REF use-fbjs-vue2 v2\n')
  const plan2 = I.createInstallPlan({ projectRoot: project, id: 'manifest-tamper', action: 'install', skillSource: bundle.skillsRoot })
  assert.equal(plan2.counts.install.update, 0)
  assert.equal(plan2.counts.install.conflict, 1, '篡改后的哈希不匹配 → conflict')
  assert.equal(plan2.counts.install.adopt, 10)
  approve(project, 'manifest-tamper', plan2)
  assert.throws(() => I.applyPlan({ projectRoot: project, id: 'manifest-tamper' }), e => e.code === 'DRIFT_DETECTED')
  // schema 不可信（schemaVersion=9）→ 拒绝据其更新/覆盖。
  manifest.schemaVersion = 9
  manifest.files['.agents/skills/use-fbjs-vue2/references/ref.md'] = plan2.payload.install.ops.find(op => op.path === '.agents/skills/use-fbjs-vue2/references/ref.md').preSha256
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  const plan3 = I.createInstallPlan({ projectRoot: project, id: 'manifest-tamper', action: 'install', skillSource: bundle.skillsRoot })
  assert.equal(plan3.counts.install.conflict, 1, '不可信 manifest 下的差异文件都是 conflict')
  assert.ok(plan3.notes.some(n => n.includes('不可信')))
})

test('15. 更新流：替换前备份旧内容；manifest 合并保留既有条目；用户改动引发 conflict', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  const plan1 = I.createInstallPlan({ projectRoot: project, id: 'update-flow', action: 'install', skillSource: bundle.skillsRoot })
  approve(project, 'update-flow', plan1)
  assert.equal(I.applyPlan({ projectRoot: project, id: 'update-flow' }).ok, true)
  fs.writeFileSync(path.join(bundle.skillsRoot, 'create-fb-feature', 'references', 'ref.md'), 'REF create-fb-feature v2\n')
  const plan2 = I.createInstallPlan({ projectRoot: project, id: 'update-flow', action: 'install', skillSource: bundle.skillsRoot })
  assert.equal(plan2.counts.install.update, 1)
  assert.equal(plan2.counts.install.adopt, 10)
  approve(project, 'update-flow', plan2)
  const oldContent = 'REF create-fb-feature v1\n'
  const report = I.applyPlan({ projectRoot: project, id: 'update-flow' })
  assert.equal(report.ok, true)
  assert.equal(report.install.updated.length, 1)
  const backup = report.install.updated[0].backup
  assert.equal(fs.readFileSync(backup.split('/').join(path.sep), 'utf8'), oldContent, '替换前旧内容有备份')
  assert.equal(fs.readFileSync(path.join(project, '.agents', 'skills', 'create-fb-feature', 'references', 'ref.md'), 'utf8'), 'REF create-fb-feature v2\n')
  assert.equal(report.install.manifest.carriedOver, 11, 'manifest 合并保留既有受管条目')
  assert.equal(report.install.manifest.fileCount, 11)
  // 用户直接改动受管文件 → 无匹配 manifest 哈希 → conflict → 拒绝（更新碰撞）。
  fs.writeFileSync(path.join(project, '.agents', 'skills', 'create-fb-feature', 'references', 'ref.md'), 'USER EDIT\n')
  const plan3 = I.createInstallPlan({ projectRoot: project, id: 'update-flow', action: 'install', skillSource: bundle.skillsRoot })
  assert.equal(plan3.counts.install.conflict, 1)
})

test('16. 源仓库守卫：fb-rules 源码仓 / fb-skill 仓库自身只允许 scan，拒绝 plan/apply', t => {
  const bundle = makeBundle(t)
  const fbRulesLike = tmpdir(t)
  fs.writeFileSync(path.join(fbRulesLike, 'package.json'), JSON.stringify({ name: 'fb-rules', version: '1.0.13' }))
  const scanOk = I.scan({ projectRoot: fbRulesLike, action: 'install', skillSource: bundle.skillsRoot })
  assert.equal(scanOk.ok, true)
  assert.equal(scanOk.writesRefused.refused, true)
  assert.throws(() => I.createInstallPlan({ projectRoot: fbRulesLike, id: 'guarded', action: 'install', skillSource: bundle.skillsRoot }), e => e.code === 'WRITES_REFUSED')
  // bundle 自身仓库：fb-skill 源仓库内安装被拒（向上 3 层命中 name=fb-skill 签名）。
  try {
    const repoLike = tmpdir(t)
    fs.writeFileSync(path.join(repoLike, 'package.json'), JSON.stringify({ name: 'fb-skill', version: '0.2.0' }))
    fs.cpSync(bundle.skillsRoot, path.join(repoLike, 'skills'), { recursive: true })
    I.createInstallPlan({ projectRoot: repoLike, id: 'self-install', action: 'install' })
    assert.fail('fb-skill 源仓库内安装必须被拒绝')
  } catch (e) {
    assert.equal(e.code, 'WRITES_REFUSED')
  }
})

test('17. CLI 端到端（真实进程）：scan 零写入、用法错误退出 2、批准流程退出 0、审计损坏退出 1', t => {
  const project = tmpdir(t)
  writeLegacy(project)
  const before = snapshot(project)
  const scan = spawnSync(process.execPath, [INSTALL_CLI, 'scan', '--project-root', project, '--action', 'install-and-clean'], { encoding: 'utf8' })
  assert.equal(scan.status, 0)
  const scanReport = JSON.parse(scan.stdout)
  assert.equal(scanReport.ok, true)
  assert.equal(scanReport.bundle.source.name, 'fb-skill')
  assert.deepEqual(snapshot(project), before, 'CLI scan 零写入')

  assert.equal(spawnSync(process.execPath, [INSTALL_CLI, 'scan', '--project-root', project, '--action', 'install-and-clean', '--bypass'], { encoding: 'utf8' }).status, 2, '未知/旁路参数退出 2')
  assert.equal(spawnSync(process.execPath, [INSTALL_CLI, 'scan', '--project-root', project, '--action', 'install-and-clean', '--location', 'D:/evil/skills'], { encoding: 'utf8' }).status, 2, '越界 location 退出 2')
  assert.equal(spawnSync(process.execPath, [INSTALL_CLI, 'plan', '--project-root', project, '--action', 'install-and-clean'], { encoding: 'utf8' }).status, 2, 'plan 缺 --id 退出 2')

  const planRun = spawnSync(process.execPath, [INSTALL_CLI, 'plan', '--project-root', project, '--action', 'install-and-clean', '--id', 'cli-e2e'], { encoding: 'utf8' })
  assert.equal(planRun.status, 0, planRun.stderr)
  const planReport = JSON.parse(planRun.stdout)
  const planAfter = snapshot(project)
  const ancestors = new Set(['.agents', '.agents/fb-feature', '.agents/fb-feature/workflows', '.agents/fb-feature/workflows/cli-e2e'])
  for (const key of Object.keys(planAfter).filter(k => before[k] === undefined)) {
    assert.ok(key.startsWith('.agents/fb-feature/workflows/cli-e2e/') || ancestors.has(key), 'CLI plan 只写 workflow 目录：' + key)
  }
  approve(project, 'cli-e2e', { hash: planReport.hash, revision: planReport.revision })
  const applyRun = spawnSync(process.execPath, [INSTALL_CLI, 'apply', '--project-root', project, '--id', 'cli-e2e'], { encoding: 'utf8' })
  assert.equal(applyRun.status, 0, applyRun.stdout + applyRun.stderr)
  const applyReport = JSON.parse(applyRun.stdout)
  assert.equal(applyReport.ok, true)
  assert.ok(fs.existsSync(path.join(project, '.agents', 'skills', 'manage-fb-skill', 'bundle.json')), 'CLI 真实安装落到目标')

  // 审计链损坏 → apply 拒绝且不写（audit failure 不放行 dev）。
  const events = path.join(project, '.agents', 'fb-feature', 'workflows', 'cli-e2e', 'events.jsonl')
  fs.writeFileSync(events, '{"seq":1,"broken":true}\n')
  const planNext = spawnSync(process.execPath, [INSTALL_CLI, 'plan', '--project-root', project, '--action', 'install-and-clean', '--id', 'cli-e2e'], { encoding: 'utf8' })
  assert.equal(planNext.status, 1, '审计链损坏时连 plan 也必须失败')
  const brokenApply = spawnSync(process.execPath, [INSTALL_CLI, 'apply', '--project-root', project, '--id', 'cli-e2e'], { encoding: 'utf8' })
  assert.equal(brokenApply.status, 1)
  const brokenReport = JSON.parse(brokenApply.stdout)
  assert.equal(brokenReport.code, 'CHAIN_BROKEN')
})

test('18. 审计事件追加失败必须阻止写入：implementation-start 落盘失败 → 零写入', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  const plan = I.createInstallPlan({ projectRoot: project, id: 'audit-gate', action: 'install', skillSource: bundle.skillsRoot })
  approve(project, 'audit-gate', plan)
  // 让 implementation-start 无法追加：审计链断裂（末行不完整）。
  const events = path.join(project, '.agents', 'fb-feature', 'workflows', 'audit-gate', 'events.jsonl')
  fs.appendFileSync(events, '{"seq":99,"partial')
  const before = snapshot(project)
  assert.throws(() => I.applyPlan({ projectRoot: project, id: 'audit-gate' }), e => /CHAIN_BROKEN|AUDIT_CORRUPT|AUDIT_APPEND_FAILED/.test(e.code || e.message))
  assert.deepEqual(snapshot(project), before, '审计失败时不能写目标文件')
})

test('19. CLI help exits 0; missing values and valued help are usage errors', t => {
  const project = tmpdir(t)
  const help = spawnSync(process.execPath, [INSTALL_CLI, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0, help.stdout + help.stderr)
  assert.match(help.stdout, /scan\|plan\|apply/)
  for (const args of [
    ['scan', '--project-root', '--action', 'install'],
    ['--help=unexpected'],
    ['scan=unexpected', '--project-root', project, '--action', 'install']
  ]) {
    const result = spawnSync(process.execPath, [INSTALL_CLI, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 2, args.join(' ') + ': ' + result.stdout + result.stderr)
  }
})

test('20. unowned source metadata is never overwritten or claimed by installation', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  const rel = '.agents/skills/.fb-skill-source.json'
  const file = path.join(project, rel)
  const content = '{"note":"owned by the project, not this installer"}\n'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  const plan = I.createInstallPlan({ projectRoot: project, id: 'unowned-meta', action: 'install', skillSource: bundle.skillsRoot })
  assert.equal(W.readWorkflow({ projectRoot: project, id: plan.id }).plan.files.includes(rel), false)
  approve(project, plan.id, plan)
  const report = I.applyPlan({ projectRoot: project, id: plan.id })
  assert.equal(report.ok, true)
  assert.equal(fs.readFileSync(file, 'utf8'), content)
  assert.equal(I.readManifest(project).manifest.files[rel], undefined)
  assert.equal(report.install.created.length, plan.counts.install.create)
})

test('21. target installation junction is a per-file conflict, never read through', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  const outside = tmpdir(t)
  const target = path.join(project, '.agents/skills/use-fbjs-vue2')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.symlinkSync(outside, target, process.platform === 'win32' ? 'junction' : 'dir')
  const before = snapshot(project)
  const report = I.scan({ projectRoot: project, action: 'install', skillSource: bundle.skillsRoot })
  assert.equal(report.ok, true)
  assert.equal(report.counts.install.conflict, 3)
  assert.ok(report.installOps.filter(op => op.skill === 'use-fbjs-vue2').every(op => /link/.test(op.reason)))
  assert.deepEqual(snapshot(project), before)
  assert.deepEqual(fs.readdirSync(outside), [])
})

test('22. manifest rejects Windows aliases, streams and non-skill metadata', t => {
  const project = tmpdir(t)
  const file = path.join(project, I.MANIFEST_REL)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  for (const key of [
    '.agents/skills/create-fb-feature/references\\escape.md',
    '.agents/skills/create-fb-feature/ref.md:stream',
    '.agents/skills/create-fb-feature/NUL.md',
    '.agents/skills/create-fb-feature/ref.',
    '.agents/skills/.fb-skill-source.json'
  ]) {
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, root: I.toPosix(project), location: '.agents/skills', files: { [key]: 'a'.repeat(64) } }))
    assert.equal(I.readManifest(project).trusted, false, key)
  }
})

test('23. CLI partial cleanup failure exits 1 and workflow remains blocked', t => {
  const bundle = makeBundle(t)
  const project = tmpdir(t)
  writeLegacy(project)
  const linked = path.join(project, '.comate/rules/agent_guide.md')
  fs.linkSync(linked, linked + '.keep')
  const plan = I.createInstallPlan({ projectRoot: project, id: 'partial-cli', action: 'clean-legacy', skillSource: bundle.skillsRoot })
  approve(project, plan.id, plan)
  const result = spawnSync(process.execPath, [INSTALL_CLI, 'apply', '--project-root', project, '--id', plan.id], { encoding: 'utf8' })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.equal(JSON.parse(result.stdout).ok, false)
  assert.equal(W.readWorkflow({ projectRoot: project, id: plan.id }).status, 'blocked')
  assert.equal(fs.readFileSync(linked, 'utf8'), 'COMATE-GUIDE-V1\n')
})
