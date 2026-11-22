'use strict'

// identity.test.cjs — 身份候选/确认档案回归（node:test，纯内建，全部隔离在 os.tmpdir()）。
//
// 约束：
//   * 不触碰真实 HOME / 全局档案（所有读写都走 --profileRoot / 隔离 env）；
//   * 不使用真实身份；确认语句是回归 fixture，仅写入临时目录；
//   * 不构造任何「当前会话的真实批准」。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

const I = require('../skills/create-fb-feature/scripts/lib/identity.cjs')
const RESOLVE_CLI = path.join(__dirname, '..', 'skills', 'create-fb-feature', 'scripts', 'resolve-identity.cjs')

let seq = 0
function tmpDir () {
  seq += 1
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fb-id-' + seq + '-'))
}

function rm (dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

// 隔离 env：git 只读这个 HOME/USERPROFILE，不会碰到真实全局 git 配置。
function isolatedEnv (home) {
  fs.mkdirSync(home, { recursive: true })
  return Object.assign({}, process.env, { HOME: home, USERPROFILE: home })
}

// 全局档案一律指向项目内隔离目录，避免读取真实 ~/.fb-skill。
function isoProfileRoot (root) {
  return path.join(root, 'isolated-global-profile')
}

function readIso (root, extra) {
  return I.readIdentity(Object.assign({ projectRoot: root, profileRoot: isoProfileRoot(root) }, extra || {}))
}

function writeProfile (root, profile) {
  const file = path.join(root, '.agents', 'fb-feature', 'profile.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(profile, null, 2), 'utf8')
  return file
}

// 回归 fixture（临时目录内，非真实身份，非当前会话批准）
const CONFIRM_TEXT = '我确认，同意按此方案执行'

function saveConfirmed (root, overrides) {
  return I.saveProfile(Object.assign({
    projectRoot: root,
    scope: 'project',
    name: '回归操作员',
    confirmationText: CONFIRM_TEXT,
    sourceRef: 'msg-regression-0001'
  }, overrides || {}))
}

let gitAvailable = null
function hasGit () {
  if (gitAvailable !== null) return gitAvailable
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    gitAvailable = true
  } catch (e) {
    gitAvailable = false
  }
  return gitAvailable
}

test('未确认环境：operator 为 null，OS 用户只是候选', function () {
  const root = tmpDir()
  try {
    const ident = readIso(root, { env: Object.assign({}, process.env, { USERNAME: 'os-person', USER: 'os-person' }) })
    assert.equal(ident.operator, null)
    const osCand = ident.candidates.find(function (c) { return c.source === 'os-user' })
    assert.ok(osCand, '应有 os-user 候选')
    assert.equal(osCand.name, 'os-person')
    assert.ok(osCand.flags.includes('unconfirmed'))
    assert.ok(!('confirmation' in osCand))
    assert.ok(!('status' in osCand))
  } finally { rm(root) }
})

test('host-plan：采用已展示的日志标签，保留真实渠道而不伪造聊天原文', function () {
  const root = tmpDir()
  try {
    const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')
    const receipt = {
      schema: 'fb-host-plan-approval/v1', host: 'zcode', sourceTool: 'ExitPlanMode',
      reference: 'isolated-host-plan-regression',
      resultText: 'User has approved your plan. You can now start coding. Start with updating your todo list if applicable.',
      projectRoot: fs.realpathSync(root), displayName: '界面回归员',
      planText: '本隔离测试采用显示标签界面回归员，执行本次文件范围。',
      planTextHash: F.sha256Hex('本隔离测试采用显示标签界面回归员，执行本次文件范围。'),
      recordedAt: new Date().toISOString()
    }
    receipt.hash = F.hashObject(receipt)
    I.saveProfile({ projectRoot: root, name: receipt.displayName, method: 'host-plan',
      confirmationText: receipt.resultText, sourceRef: receipt.reference, hostApproval: receipt })
    const ident = readIso(root)
    assert.equal(ident.operator.name, '界面回归员')
    assert.equal(ident.operator.confirmation.method, 'host-plan')
    assert.deepEqual(ident.operator.confirmation.hostApproval, receipt)
    assert.equal(ident.operator.confirmation.text, receipt.resultText)
    assert.ok(I.validateOperatorSchema(ident.operator).ok)
  } finally { rm(root) }
})

test('host-plan：缺来源、普通工具通知、标签/工程/原文漂移拒绝，不写档案', function () {
  const root = tmpDir()
  try {
    const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')
    const planText = '本隔离测试采用显示标签界面回归员，执行本次文件范围。'
    const receipt = {
      schema: 'fb-host-plan-approval/v1', host: 'zcode', sourceTool: 'ExitPlanMode',
      reference: 'isolated-host-plan-regression', resultText: I.HOST_PLAN_RESULT,
      projectRoot: fs.realpathSync(root), displayName: '界面回归员', planText,
      planTextHash: F.sha256Hex(planText), recordedAt: new Date().toISOString()
    }
    for (const changed of [
      { reference: '' }, { sourceTool: 'Agent' }, { fixture: true },
      { resultText: 'Agent finished successfully' }, { displayName: '另一个标签' },
      { projectRoot: path.dirname(root) }, { planText: planText + '未批准变更' }
    ]) {
      const bad = { ...receipt, ...changed }
      bad.hash = F.hashObject(bad)
      assert.throws(function () { I.saveProfile({ projectRoot: root, name: '界面回归员',
        method: 'host-plan', confirmationText: bad.resultText, sourceRef: bad.reference,
        hostApproval: bad }) }, function (e) { return ['SOURCE_REF_REQUIRED', 'EVIDENCE_TEXT_REJECTED'].includes(e.code) })
      assert.equal(I.readProfileFile(I.projectProfilePath(root)).exists, false)
    }
  } finally { rm(root) }
})

test('host-plan 项目档案复制到另一工程根：目标根不确认（防跨根重放），原根不受影响', function () {
  const rootA = tmpDir()
  const rootB = tmpDir()
  try {
    const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')
    const planText = '本隔离测试采用显示标签跨根回归员，执行A工程文件范围。'
    const receipt = {
      schema: 'fb-host-plan-approval/v1', host: 'zcode', sourceTool: 'ExitPlanMode',
      reference: 'isolated-host-plan-crossroot', resultText: I.HOST_PLAN_RESULT,
      projectRoot: fs.realpathSync(rootA), displayName: '跨根回归员', planText,
      planTextHash: F.sha256Hex(planText), recordedAt: new Date().toISOString()
    }
    receipt.hash = F.hashObject(receipt)
    I.saveProfile({ projectRoot: rootA, name: receipt.displayName, method: 'host-plan',
      confirmationText: receipt.resultText, sourceRef: receipt.reference, hostApproval: receipt })
    // 整体复制合法签名档案到 rootB（不伪造、不重算 hash），目标根必须拒绝
    fs.mkdirSync(path.join(rootB, '.agents', 'fb-feature'), { recursive: true })
    fs.copyFileSync(path.join(rootA, '.agents', 'fb-feature', 'profile.json'), path.join(rootB, '.agents', 'fb-feature', 'profile.json'))
    const identB = I.readIdentity({ projectRoot: rootB, profileRoot: isoProfileRoot(rootB) })
    assert.equal(identB.operator, null, '复制到其他工程根的 host-plan 档案不得确认为操作人')
    const cand = identB.candidates.find(function (c) { return c.source === 'profile(project)' })
    assert.ok(cand && cand.flags.includes('unconfirmed'))
    assert.ok(identB.notes.some(function (n) { return n.includes('其他工程根') }), JSON.stringify(identB.notes))
    const identA = I.readIdentity({ projectRoot: rootA, profileRoot: isoProfileRoot(rootA) })
    assert.equal(identA.operator.name, '跨根回归员', '原根档案不受影响')
  } finally { rm(rootA); rm(rootB) }
})

test('global user-message 档案跨项目复用不受 host-plan 根绑定影响', function () {
  const root1 = tmpDir()
  const root2 = tmpDir()
  const root3 = tmpDir()
  try {
    const profileRoot = path.join(root1, 'shared-global-profiles')
    I.saveProfile({ projectRoot: root1, scope: 'global', profileRoot: profileRoot,
      name: '全局复用员', confirmationText: CONFIRM_TEXT, sourceRef: 'msg-global-guard' })
    for (const projectRoot of [root2, root3]) {
      const ident = I.readIdentity({ projectRoot: projectRoot, profileRoot: profileRoot })
      assert.ok(ident.operator, 'global user-message 档案应跨项目复用')
      assert.equal(ident.operator.name, '全局复用员')
      assert.equal(ident.operator.confirmation.method, 'user-message')
    }
  } finally { rm(root1); rm(root2); rm(root3) }
})

test('身份自报的否定语句不登记，host-plan标签不扩大为全局身份', function () {
  const root = tmpDir()
  try {
    assert.throws(function () { I.saveProfile({ projectRoot: root, name: '回归操作员',
      confirmationText: '我是回归操作员，不要给我建档，我拒绝登记', sourceRef: 'isolated-decline' })
    }, function (error) { return error.code === 'EVIDENCE_TEXT_REJECTED' })
    assert.throws(function () { I.saveProfile({ projectRoot: root, profileRoot: isoProfileRoot(root),
      scope: 'global', name: '回归操作员', method: 'host-plan', sourceRef: 'isolated-global-host' })
    }, function (error) { return error.code === 'BAD_SCOPE' })
    assert.equal(I.readProfileFile(I.projectProfilePath(root)).exists, false)
  } finally { rm(root) }
})

test('旧档案（无 confirmation 块）不被当作已确认', function () {
  const root = tmpDir()
  try {
    writeProfile(root, { schema: 'fb-feature-identity/v0', name: '旧用户', email: 'old@corp.example', savedAt: '2025-01-01T00:00:00.000Z', scope: 'project' })
    const ident = readIso(root)
    assert.equal(ident.operator, null)
    const cand = ident.candidates.find(function (c) { return c.source === 'profile(project)' })
    assert.ok(cand, '旧档案应降级为候选')
    assert.ok(cand.flags.includes('unconfirmed'))
    assert.ok(ident.notes.some(function (n) { return n.includes('未确认') }))
  } finally { rm(root) }
})

test('完整性哈希有效的 fixture 档案仍被拒绝', function () {
  const root = tmpDir()
  try {
    const profile = {
      schema: I.IDENTITY_SCHEMA,
      name: 'fixture-operator',
      status: 'confirmed',
      fixture: true,
      confirmation: { method: 'user-message', sourceRef: 'fixture-ref', text: CONFIRM_TEXT, confirmedAt: '2026-01-01T00:00:00.000+08:00' }
    }
    profile.hash = I.profileHashOf(profile)
    writeProfile(root, profile)
    const ident = readIso(root)
    assert.equal(ident.operator, null)
    const cand = ident.candidates.find(function (c) { return c.source === 'profile(project)' })
    assert.ok(cand && cand.flags.includes('fixture'))
    assert.ok(ident.notes.some(function (n) { return n.includes('fixture') }))
  } finally { rm(root) }
})

test('批准语句校验：空/否定/示例拒绝，肯定接受', function () {
  const cases = [
    ['', false],
    ['   ', false],
    ['x', false],
    ['maybe', false],
    ['not sure', false],
    ['我不同意', false],
    ['暂不执行', false],
    ['先不要动', false],
    ['修改一下方案再批准', false],
    ['示例：我同意此方案', false],
    ['模拟批准：同意', false],
    [CONFIRM_TEXT, true],
    ['同意', true],
    ['没问题，按此执行', true],
    ['Approved, go ahead', true],
    ['确认，可以开始', true]
  ]
  for (const [text, expect] of cases) {
    const r = I.validateConfirmationText(text)
    assert.equal(r.ok, expect, '语句 ' + JSON.stringify(text) + ' 应 ' + (expect ? '通过' : '拒绝') + (r.ok ? '' : '，原因：' + r.reason))
  }
})

test('save：缺 confirmation-text / source-ref / 姓名拒绝', function () {
  const root = tmpDir()
  try {
    assert.throws(function () {
      I.saveProfile({ projectRoot: root, scope: 'project', name: '某人', sourceRef: 'msg-1' })
    }, function (e) { return e.code === 'EVIDENCE_TEXT_REJECTED' })
    assert.throws(function () {
      I.saveProfile({ projectRoot: root, scope: 'project', name: '某人', confirmationText: CONFIRM_TEXT })
    }, function (e) { return e.code === 'SOURCE_REF_REQUIRED' })
    assert.throws(function () {
      I.saveProfile({ projectRoot: root, scope: 'project', confirmationText: CONFIRM_TEXT, sourceRef: 'msg-1' })
    }, function (e) { return e.code === 'NAME_REQUIRED' })
    assert.throws(function () {
      I.saveProfile({ projectRoot: root, scope: 'project', name: 'a\nb', confirmationText: CONFIRM_TEXT, sourceRef: 'msg-1' })
    }, function (e) { return e.code === 'BAD_NAME' })
    assert.throws(function () {
      I.saveProfile({ projectRoot: root, scope: 'project', name: 'fixture-张三', confirmationText: CONFIRM_TEXT, sourceRef: 'msg-1' })
    }, function (e) { return e.code === 'FIXTURE_NAME_REJECTED' })
  } finally { rm(root) }
})

test('save+read 往返：operator 确认、email 可选、scope 缺省 project', function () {
  const root = tmpDir()
  try {
    saveConfirmed(root) // 无 email、无 scope
    const ident = readIso(root)
    assert.ok(ident.operator, '确认档案应产生 operator')
    assert.equal(ident.operator.name, '回归操作员')
    assert.equal(ident.operator.scope, 'project')
    assert.equal(ident.operator.email, '')
    assert.equal(ident.operator.status, 'confirmed')
    assert.equal(ident.operator.confirmation.sourceRef, 'msg-regression-0001')
    assert.equal(ident.operator.confirmation.method, 'user-message')
    assert.ok(ident.operator.profileHash)
    // operator 必须通过 recordApproval 侧的 schema 校验
    assert.ok(I.validateOperatorSchema(ident.operator).ok)
  } finally { rm(root) }
})

test('已保存显示名：重复读取直接复用，不再收集 Git/SVN/OS 候选', function () {
  const root = tmpDir()
  try {
    const saved = saveConfirmed(root)
    const env = Object.assign(isolatedEnv(path.join(root, 'saved-home')), { PATH: '', USERNAME: '另一个系统名', USER: '另一个系统名' })
    for (let i = 0; i < 2; i++) {
      const ident = readIso(root, { env: env })
      assert.equal(ident.operator.name, '回归操作员')
      assert.equal(ident.operator.profileHash, saved.hash)
      assert.equal(ident.operator.revision, 1)
      assert.deepEqual(ident.operator.confirmation, saved.profile.confirmation)
      assert.deepEqual(ident.candidates, [])
      assert.ok(!ident.notes.some(function (n) { return /git 探测|svn info|OS 用户名/.test(n) }))
    }
  } finally { rm(root) }
})

test('覆盖保护：无 expect-hash / 错 hash 拒绝；对 hash 成功且 revision 递增', function () {
  const root = tmpDir()
  try {
    const first = saveConfirmed(root)
    assert.throws(function () { saveConfirmed(root) }, function (e) { return e.code === 'OVERWRITE_REJECTED' && e.details && e.details.currentHash === first.hash })
    assert.throws(function () {
      saveConfirmed(root, { expectHash: 'f'.repeat(64) })
    }, function (e) { return e.code === 'HASH_MISMATCH' })
    const second = I.saveProfile({
      projectRoot: root, scope: 'project', name: '回归操作员',
      confirmationText: CONFIRM_TEXT, sourceRef: 'msg-regression-0002',
      expectHash: first.hash
    })
    assert.equal(second.profile.revision, 2)
    const ident = readIso(root)
    assert.equal(ident.operator.confirmation.sourceRef, 'msg-regression-0002')
  } finally { rm(root) }
})

test('invalidated 档案：读取不作为操作人；重确认需 reconfirm + expect-hash', function () {
  const root = tmpDir()
  try {
    const first = saveConfirmed(root)
    const inv = I.invalidateProfile({ projectRoot: root, scope: 'project', expectHash: first.hash, reason: '演练作废' })
    assert.equal(inv.profile.status, 'invalidated')
    let ident = readIso(root)
    assert.equal(ident.operator, null)
    assert.ok(ident.notes.some(function (n) { return n.includes('失效') }))
    assert.throws(function () {
      I.saveProfile({ projectRoot: root, scope: 'project', name: '回归操作员', confirmationText: CONFIRM_TEXT, sourceRef: 'msg-regression-0003', expectHash: inv.hash })
    }, function (e) { return e.code === 'PROFILE_INVALIDATED' })
    const again = I.saveProfile({
      projectRoot: root, scope: 'project', name: '回归操作员',
      confirmationText: CONFIRM_TEXT, sourceRef: 'msg-regression-0003',
      expectHash: inv.hash, reconfirm: true
    })
    assert.equal(again.profile.revision, 3)
    ident = readIso(root)
    assert.equal(ident.operator.status, 'confirmed')
    assert.equal(ident.operator.revision, 3)
  } finally { rm(root) }
})

test('隔离 profileRoot：global 档案写入指定目录而非真实 HOME；terminal 引用推断 method', function () {
  const root = tmpDir()
  try {
    const globalRoot = path.join(root, 'global-profiles')
    const saved = I.saveProfile({
      projectRoot: root, scope: 'global', profileRoot: globalRoot,
      name: '全局操作员', confirmationText: CONFIRM_TEXT,
      sourceRef: 'terminal:2026-11-21T12:00:00.000+08:00'
    })
    assert.ok(saved.file.startsWith(globalRoot))
    assert.equal(path.basename(saved.file), 'profile.json')
    assert.notEqual(saved.file, path.join(os.homedir(), '.fb-skill', 'profile.json'))
    const ident = readIso(root, { profileRoot: globalRoot })
    assert.equal(ident.operator.scope, 'global')
    assert.equal(ident.operator.confirmation.method, 'terminal')
  } finally { rm(root) }
})

test('已确认全局显示名跨项目复用；项目显示名优先，不被系统候选替换', function () {
  const root = tmpDir()
  try {
    const firstRoot = path.join(root, 'first-project')
    const nextRoot = path.join(root, 'next-project')
    fs.mkdirSync(firstRoot)
    fs.mkdirSync(nextRoot)
    const profileRoot = path.join(root, 'global-profiles')
    const saved = I.saveProfile({
      projectRoot: firstRoot, scope: 'global', profileRoot: profileRoot,
      name: '全局操作员', confirmationText: CONFIRM_TEXT,
      sourceRef: 'msg-regression-global'
    })
    const env = Object.assign(isolatedEnv(path.join(root, 'global-home')), { USERNAME: '另一个系统名', USER: '另一个系统名' })
    for (const projectRoot of [firstRoot, nextRoot]) {
      const ident = I.readIdentity({ projectRoot: projectRoot, profileRoot: profileRoot, env: env })
      assert.equal(ident.operator.name, '全局操作员')
      assert.equal(ident.operator.scope, 'global')
      assert.equal(ident.operator.profileHash, saved.hash)
      assert.deepEqual(ident.operator.confirmation, saved.profile.confirmation)
      assert.deepEqual(ident.candidates, [])
    }
    const local = saveConfirmed(nextRoot)
    const ident = I.readIdentity({ projectRoot: nextRoot, profileRoot: profileRoot, env: env })
    assert.equal(ident.operator.name, '回归操作员')
    assert.equal(ident.operator.scope, 'project')
    assert.equal(ident.operator.profileHash, local.hash)
    assert.deepEqual(ident.candidates.map(function (c) { return c.source }), ['profile(global)'])
    assert.ok(ident.candidates[0].flags.includes('superseded-by-project'))
  } finally { rm(root) }
})

test('git 候选：仓库内读取 user.name；不读取/不输出 email；仍不是 operator', { skip: !hasGit() ? 'git 不可用' : false }, function (t) {
  const root = tmpDir()
  try {
    execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.name', 'Git线索人'], { cwd: root, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'should-not-leak@example.com'], { cwd: root, stdio: 'ignore' })
    const env = isolatedEnv(path.join(root, 'git-home'))
    const ident = readIso(root, { env: env })
    const cand = ident.candidates.find(function (c) { return c.source === 'git-config' })
    assert.ok(cand, '应有 git-config 候选')
    assert.equal(cand.name, 'Git线索人')
    assert.equal(cand.email, null)
    assert.ok(cand.flags.includes('email-omitted'))
    assert.ok(cand.flags.includes('unconfirmed'))
    assert.equal(ident.operator, null)
    assert.ok(!JSON.stringify(ident).includes('should-not-leak'))
  } finally { rm(root) }
})

test('非 git 目录不产生 git 候选', { skip: !hasGit() ? 'git 不可用' : false }, function () {
  const root = tmpDir()
  try {
    const env = isolatedEnv(path.join(root, 'git-home'))
    const ident = readIso(root, { env: env })
    assert.ok(!ident.candidates.some(function (c) { return c.source === 'git-config' }))
  } finally { rm(root) }
})

test('svn：XML 实体解码 + metadata-only；svn 失败不吞错误', function () {
  const root = tmpDir()
  try {
    fs.mkdirSync(path.join(root, '.svn'))
    const xml = '<?xml version="1.0" encoding="UTF-8"?><info><entry path="x"><commit revision="42"><author>张三 &amp; Co &lt;dev&gt;</author><date>2026-11-20T08:00:00.000000Z</date></commit></entry></info>'
    const ident = readIso(root, {
      env: isolatedEnv(path.join(root, 'svn-home')),
      _svnRunner: function () { return { ok: true, stdout: xml, stderr: '' } }
    })
    const cand = ident.candidates.find(function (c) { return c.source === 'svn-last-author' })
    assert.ok(cand, '应有 svn 候选')
    assert.equal(cand.name, '张三 & Co <dev>')
    assert.equal(cand.email, null)
    assert.ok(cand.flags.includes('metadata-only'))
    assert.equal(ident.operator, null)
    // 失败不吞：错误出现在 notes
    const bad = readIso(root, {
      env: isolatedEnv(path.join(root, 'svn-home')),
      _svnRunner: function () { return { ok: false, stdout: '', stderr: 'svn: E155007 boom' } }
    })
    assert.ok(bad.notes.some(function (n) { return n.includes('svn: E155007') }))
    assert.ok(!bad.candidates.some(function (c) { return c.source === 'svn-last-author' }))
  } finally { rm(root) }
})

test('resolve-identity CLI：读取输出 JSON；--save 缺参/未知参数 exit 2', function () {
  const root = tmpDir()
  try {
    const profileRoot = isoProfileRoot(root)
    const r0 = spawnSync(process.execPath, [RESOLVE_CLI, '--project-root', root, '--profile-root', profileRoot], { encoding: 'utf8' })
    assert.equal(r0.status, 0, r0.stdout + r0.stderr)
    const j0 = JSON.parse(r0.stdout.trim())
    assert.equal(j0.ok, true)
    assert.equal(j0.operator, null)

    const r1 = spawnSync(process.execPath, [RESOLVE_CLI, '--project-root', root, '--profile-root', profileRoot, '--save', '--name', '某人', '--source-ref', 'msg-1'], { encoding: 'utf8' })
    assert.equal(r1.status, 2)
    assert.equal(JSON.parse(r1.stdout.trim()).code, 'EVIDENCE_TEXT_REJECTED')

    const r2 = spawnSync(process.execPath, [RESOLVE_CLI, '--project-root', root, '--profile-root', profileRoot, '--save', '--name', '某人', '--confirmation-text', CONFIRM_TEXT], { encoding: 'utf8' })
    assert.equal(r2.status, 2)
    assert.equal(JSON.parse(r2.stdout.trim()).code, 'SOURCE_REF_REQUIRED')

    const r3 = spawnSync(process.execPath, [RESOLVE_CLI, '--project-root', root, '--wat'], { encoding: 'utf8' })
    assert.equal(r3.status, 2)
    assert.equal(JSON.parse(r3.stdout.trim()).code, 'UNKNOWN_ARG')

    const r4 = spawnSync(process.execPath, [RESOLVE_CLI, '--project-root', root, '--profile-root', profileRoot, '--save', '--name', 'CLI操作员', '--confirmation-text', CONFIRM_TEXT, '--source-ref', 'msg-cli-1'], { encoding: 'utf8' })
    assert.equal(r4.status, 0, r4.stdout + r4.stderr)
    const j4 = JSON.parse(r4.stdout.trim())
    assert.equal(j4.ok, true)
    assert.equal(j4.operator.name, 'CLI操作员')
    assert.equal(j4.operator.scope, 'project')
  } finally { rm(root) }
})

test('resolve-identity CLI：只读模式拒绝保存专用参数，不静默忽略批准材料', function () {
  const root = tmpDir()
  const profileRoot = isoProfileRoot(root)
  try {
    for (const [flag, value] of [['--host-approval', 'missing.json'], ['--confirmation-text', CONFIRM_TEXT], ['--name', '只读参数员'], ['--source-ref', 'isolated-read-flag']]) {
      const run = spawnSync(process.execPath, [RESOLVE_CLI, '--project-root', root, '--profile-root', profileRoot, flag, value], { encoding: 'utf8' })
      assert.equal(run.status, 2, flag + ' 缺少 --save 不得静默忽略：' + run.stdout + run.stderr)
      assert.equal(JSON.parse(run.stdout.trim()).code, 'BAD_ARGS')
      assert.equal(I.readProfileFile(I.projectProfilePath(root)).exists, false)
    }
  } finally { rm(root) }
})

test('resolve-identity CLI：--host-approval 与 --confirmation-text/--source-ref/--method 混用拒绝；单独使用成功', function () {
  const root = tmpDir()
  try {
    const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')
    const profileRoot = isoProfileRoot(root)
    const planText = '本隔离测试采用显示标签CLI宿主员，执行本次文件范围。'
    const receipt = {
      schema: 'fb-host-plan-approval/v1', host: 'zcode', sourceTool: 'ExitPlanMode',
      reference: 'isolated-host-cli', resultText: I.HOST_PLAN_RESULT,
      projectRoot: fs.realpathSync(root), displayName: 'CLI宿主员', planText,
      planTextHash: F.sha256Hex(planText), recordedAt: new Date().toISOString()
    }
    receipt.hash = F.hashObject(receipt)
    fs.writeFileSync(path.join(root, 'isolated-host-cli.json'), JSON.stringify(receipt, null, 2), 'utf8')
    const mixes = [
      ['--confirmation-text', CONFIRM_TEXT],
      ['--source-ref', 'msg-mixed'],
      ['--method', 'user-message']
    ]
    for (const [flag, value] of mixes) {
      const r = spawnSync(process.execPath, [RESOLVE_CLI, '--project-root', root, '--profile-root', profileRoot,
        '--save', '--name', 'CLI宿主员', '--host-approval', 'isolated-host-cli.json', flag, value], { encoding: 'utf8' })
      assert.equal(r.status, 2, flag + ' 与 --host-approval 混用应退出 2：' + r.stdout + r.stderr)
      assert.equal(JSON.parse(r.stdout.trim()).code, 'BAD_ARGS', flag)
      assert.equal(I.readProfileFile(I.projectProfilePath(root)).exists, false, flag + ' 混用不得写档案')
    }
    const okRun = spawnSync(process.execPath, [RESOLVE_CLI, '--project-root', root, '--profile-root', profileRoot,
      '--save', '--name', 'CLI宿主员', '--host-approval', 'isolated-host-cli.json'], { encoding: 'utf8' })
    assert.equal(okRun.status, 0, okRun.stdout + okRun.stderr)
    const okJson = JSON.parse(okRun.stdout.trim())
    assert.equal(okJson.ok, true)
    assert.equal(okJson.operator.name, 'CLI宿主员')
    assert.equal(okJson.operator.confirmation.method, 'host-plan')
  } finally { rm(root) }
})
