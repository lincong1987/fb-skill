'use strict'

// identity.cjs — 操作人候选与确认档案（身份门禁）。
//
// 原则（docs/design.md「可执行门禁与留痕」）：
//   * Git user.name / SVN last-changed-author / OS 用户名只是「候选线索」，
//     永远不会自动成为操作人（operator），更不能自批准；
//   * 只有同时具备：schema 匹配 + status=confirmed + 真实确认语句
//     （非空、肯定、非示例/模拟措辞）+ 来源引用（human message id 或
//     terminal 引用）的档案才是已确认操作人；
//   * git 作者邮箱永不读取、不输出；SVN 作者仅作元数据；读取 git 配置前
//     先确认处于 git 仓库内；
//   * 覆盖档案必须先读取并携带当前 hash（--expect-hash），默认拒绝覆盖；
//   * 已失效（invalidated）档案需显式 reconfirm + 新确认语句才能恢复；
//   * fixture/合成身份（回归用）一律拒绝写入与使用。
//
// 已知限制（README 需注明）：本模块只能核验「语句形态与来源引用是否被
// 记录」，无法鉴别宿主之外伪造的同文本消息；确认真实性依赖宿主聊天记录
// 与执行人。档案是本地 JSON 文件，本地可伪造（含 hash 字段亦可重算），
// 因此这是防误操作与审计基线，不是防篡改密码学保证。

const fs = require('fs')
const os = require('os')
const path = require('path')
const F = require('./files.cjs')

const IDENTITY_SCHEMA = 'fb-feature-identity/v1'
const CONFIRM_METHODS = ['user-message', 'terminal', 'host-plan']
const HOST_PLAN_RESULT = 'User has approved your plan. You can now start coding. Start with updating your todo list if applicable.'

// 宿主结果只保留实际来源；本地 hash 不证明宿主外的 JSON 由真人产生。
function validateHostApproval (receipt, options) {
  const o = options || {}
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || receipt.fixture === true ||
      receipt.schema !== 'fb-host-plan-approval/v1' || receipt.host !== 'zcode' || receipt.sourceTool !== 'ExitPlanMode' ||
      receipt.resultText !== HOST_PLAN_RESULT) return { ok: false, reason: '缺少明确的宿主计划批准结果' }
  if (typeof receipt.reference !== 'string' || !receipt.reference.trim() || receipt.reference.length > 200 || F.CONTROL_RE.test(receipt.reference)) return { ok: false, reason: '宿主批准缺少真实来源引用' }
  if (typeof receipt.projectRoot !== 'string' || !path.isAbsolute(receipt.projectRoot) || o.projectRoot && receipt.projectRoot !== o.projectRoot) return { ok: false, reason: '宿主批准绑定其他工程根' }
  if (typeof receipt.planText !== 'string' || !receipt.planText.trim() || receipt.planText.length > 20000 || receipt.planTextHash !== F.sha256Hex(receipt.planText)) return { ok: false, reason: '宿主批准方案原文或 hash 不符' }
  if (typeof receipt.recordedAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(receipt.recordedAt) || !Number.isFinite(Date.parse(receipt.recordedAt))) return { ok: false, reason: '宿主结果录入时间无效' }
  if (o.displayName && (receipt.displayName !== o.displayName || !receipt.planText.includes(o.displayName))) return { ok: false, reason: '显示标签未包含在已批准方案中' }
  if (receipt.hash !== F.hashObject(F.withoutHash(receipt))) return { ok: false, reason: '宿主结果内容 hash 不符' }
  return { ok: true, text: receipt.resultText }
}

// 否定/保留/缓办措辞（fail-closed：命中即拒绝，并提示重写为肯定语句）
const NEGATIVE_RE = /(未批准|未同意|未确认|不予|不准|没批准|没同意|不确认|不同意|暂不|先不|不要|不可|不能|不批|不行|不通过|再议|再想想|重新考虑|待定|暂缓|再看看|再讨论|缓一缓|等一下|先等等|存疑|算了|取消|拒绝|驳回|修改|改一下|改改|调整一下|尚未|还没)/
const NEGATIVE_EN_RE = /\b(maybe|perhaps|not\s+sure|not\s+yet|no\s+way|nope|not|cancel|deny|reject|decline|postpone)\b/i
// 示例/模拟/合成措辞（防止把文档示例、演练文本当真实批准）
const EXAMPLE_RE = /(示例|例如|样例|范例|模拟|伪造|占位|模板文本|合成)/
const EXAMPLE_EN_RE = /\b(fixture|fake|synthetic|dummy|placeholder|simulate|simulation|sample|example)\b/i
// 必须出现明确肯定词
const AFFIRMATIVE_RE = /(确认|同意|批准|通过|照此|按此|按方案|按计划|按这个|可以开始|开始吧|就这么办|就这样做|授权|没问题|同意执行|可以)|(\b(approve|approved|confirm|confirmed|yes|ok|go\s+ahead|sign[-\s]?off|agree)\b)/i

function validateConfirmationText (text) {
  if (typeof text !== 'string') return { ok: false, reason: '批准/确认语句必须是字符串' }
  const t = text.trim()
  if (!t) return { ok: false, reason: '批准/确认语句为空' }
  if (t.length < 2) return { ok: false, reason: '批准/确认语句过短（<2 字符）' }
  if (t.length > 500) return { ok: false, reason: '批准/确认语句过长（>500 字符）' }
  if (/[?？]/.test(t) || /(是否|同意吗|批准吗|确认吗|如果|假如|待.+后|等.+再|他说|说了|据说)/.test(t) || /\b(if|unless|pending|would|should|could|says|said)\b/i.test(t)) return { ok: false, reason: '问题、条件或转述不是当前方案的明确批准' }
  if (NEGATIVE_RE.test(t) || NEGATIVE_EN_RE.test(t)) {
    return { ok: false, reason: '语句含否定/保留/缓办措辞，拒绝作为确认；请重写为明确的肯定语句' }
  }
  if (EXAMPLE_RE.test(t) || EXAMPLE_EN_RE.test(t)) {
    return { ok: false, reason: '语句含示例/模拟/合成措辞，拒绝；请粘贴真实用户消息原文' }
  }
  if (!AFFIRMATIVE_RE.test(t)) {
    return { ok: false, reason: '语句缺少明确肯定词（需包含 确认/同意/批准/通过/按此执行 等）' }
  }
  return { ok: true, text: t }
}

function validateIdentityText (text, name) {
  if (typeof text !== 'string' || !text.trim() || text.length > 500) return { ok: false, reason: '需要真实用户身份确认原文' }
  const t = text.trim()
  if (EXAMPLE_RE.test(t) || EXAMPLE_EN_RE.test(t) || /[?？]/.test(t) || NEGATIVE_RE.test(t) || NEGATIVE_EN_RE.test(t)) return { ok: false, reason: '示例、问题、否定或合成数据不是身份确认' }
  if (name && t.includes(name) && /(?:我叫|我是|我的名字|姓名|显示名|I am|my name is|call me)/i.test(t) && !/(不是|非本人|not me|not my)/i.test(t)) return { ok: true, text: t }
  return validateConfirmationText(t)
}

// fixture/合成身份姓名特征（回归测试专用命名一律不得进入真实档案）
function isFixtureName (name) {
  if (typeof name !== 'string') return false
  return /(fixture|fake|synthetic|dummy)/i.test(name)
    || /^test[-_.\s]/i.test(name)
    || /(合成|模拟人|示例操作|假人)/.test(name)
}

function validateName (name) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new F.FbError('NAME_REQUIRED', '缺少 --name（操作人姓名必须由真实人给出，工具不得猜测）')
  }
  const t = name.trim()
  if (t.length > 120 || F.CONTROL_RE.test(t)) {
    throw new F.FbError('BAD_NAME', '姓名非法（过长或含控制字符）')
  }
  return t
}

function validateEmail (email) {
  if (email === undefined || email === null || email === '') return ''
  if (typeof email !== 'string' || /\s/.test(email) || email.length > 200 || !/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
    throw new F.FbError('BAD_EMAIL', 'email 非法（可选字段；需形如 a@b，无空格）')
  }
  return email.trim()
}

function validateSourceRef (ref) {
  if (typeof ref !== 'string' || !ref.trim()) {
    throw new F.FbError('SOURCE_REF_REQUIRED', '缺少来源引用 --source-ref（human message id 或 terminal 引用）')
  }
  const t = ref.trim()
  if (t.length > 200 || F.CONTROL_RE.test(t)) {
    throw new F.FbError('BAD_SOURCE_REF', 'source-ref 非法（过长或含控制字符）')
  }
  return t
}

// 由 sourceRef 推断确认渠道；terminal:/tty: 前缀视为终端录入，其余按用户消息。
function inferMethod (sourceRef) {
  return /^(terminal|tty|stdin|console|repl)(:|-|_|\s)/i.test(sourceRef) ? 'terminal' : 'user-message'
}

// recordApproval / loadIdentity 前的 operator schema 校验（必须携带确认块与档案 schema）。
// options.projectRoot 提供时，host-plan 身份确认必须绑定同一工程根：把 A 根的合法签名
// 档案整体复制到 B 根同样拒绝（防档案文件级跨根重放）；不传该选项保持原校验（兼容直接调用）。
function validateOperatorSchema (op, options) {
  const o = options || {}
  if (!op || typeof op !== 'object' || Array.isArray(op)) {
    return { ok: false, code: 'OPERATOR_INVALID', reason: 'operator 必须是对象（来自 readIdentity().operator 或等价确认档案）' }
  }
  if (op.fixture === true) return { ok: false, code: 'OPERATOR_FIXTURE', reason: 'operator 带 fixture 标记，拒绝进入真实门禁' }
  if (op.schema !== IDENTITY_SCHEMA) {
    return { ok: false, code: 'OPERATOR_SCHEMA_UNKNOWN', reason: 'operator.schema 不识别：' + JSON.stringify(op.schema || null) + '（期望 ' + IDENTITY_SCHEMA + '）' }
  }
  if (op.status !== 'confirmed') {
    return { ok: false, code: 'OPERATOR_NOT_CONFIRMED', reason: 'operator 未确认（status=' + JSON.stringify(op.status || null) + '）；候选身份（git/svn/os）不能作为批准人' }
  }
  if (isFixtureName(op.name)) {
    return { ok: false, code: 'OPERATOR_FIXTURE', reason: 'operator.name 疑似 fixture/合成身份：' + op.name }
  }
  const nameOk = typeof op.name === 'string' && op.name.trim().length >= 1 && op.name.length <= 120 && !F.CONTROL_RE.test(op.name)
  if (!nameOk) return { ok: false, code: 'OPERATOR_INVALID', reason: 'operator.name 非法' }
  if (op.email !== undefined && op.email !== null && op.email !== '') {
    if (typeof op.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(op.email)) {
      return { ok: false, code: 'OPERATOR_INVALID', reason: 'operator.email 非法' }
    }
  }
  const c = op.confirmation
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, code: 'OPERATOR_NOT_CONFIRMED', reason: 'operator.confirmation 缺失（需含 method/sourceRef/text/confirmedAt）' }
  }
  if (!CONFIRM_METHODS.includes(c.method)) {
    return { ok: false, code: 'OPERATOR_INVALID', reason: 'confirmation.method 必须是 user-message|terminal|host-plan' }
  }
  if (typeof c.sourceRef !== 'string' || !c.sourceRef.trim() || c.sourceRef.length > 200 || F.CONTROL_RE.test(c.sourceRef)) {
    return { ok: false, code: 'SOURCE_REF_REQUIRED', reason: 'confirmation.sourceRef 缺失或非法' }
  }
  const tv = c.method === 'host-plan'
    ? validateHostApproval(c.hostApproval, { displayName: op.name, projectRoot: o.projectRoot })
    : validateIdentityText(c.text, op.name)
  if (!tv.ok || c.method === 'host-plan' && (c.text !== tv.text || c.sourceRef !== c.hostApproval.reference)) return { ok: false, code: 'EVIDENCE_TEXT_REJECTED', reason: 'confirmation 无效：' + (tv.reason || '宿主结果来源不符') }
  if (typeof c.confirmedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(c.confirmedAt) || !Number.isFinite(Date.parse(c.confirmedAt))) {
    return { ok: false, code: 'OPERATOR_INVALID', reason: 'confirmation.confirmedAt 缺失' }
  }
  return { ok: true }
}

function projectProfilePath (rootReal) {
  return path.join(rootReal, '.agents', 'fb-feature', 'profile.json')
}

// profileRoot 只指 profiles 目录（其下直接是 profile.json）；缺省 ~/.fb-skill。
function globalProfilePath (profileRoot) {
  const base = profileRoot || path.join(os.homedir(), '.fb-skill')
  return path.join(base, 'profile.json')
}

function profileHashOf (profile) {
  return F.hashObject(F.withoutHash(profile))
}

// 读取档案；损坏时 fail-closed（corrupt 标记，绝不当作已确认，也不静默吞错）。
function readProfileFile (file) {
  let raw
  try {
    F.assertNoLinks(file)
    raw = fs.readFileSync(file, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return { exists: false, corrupt: false, profile: null, hash: null, file: file, error: null }
    return { exists: true, corrupt: true, profile: null, hash: null, file: file, error: F.firstLine(e.message) }
  }
  let value
  try {
    value = JSON.parse(raw)
  } catch (e) {
    return { exists: true, corrupt: true, profile: null, hash: null, file: file, error: F.firstLine(e.message) }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { exists: true, corrupt: true, profile: null, hash: null, file: file, error: '档案顶层不是对象' }
  }
  const hash = profileHashOf(value)
  if (value.schema === IDENTITY_SCHEMA && value.hash !== hash) return { exists: true, corrupt: true, profile: null, hash, file, error: 'PROFILE_TAMPERED: 档案 hash 与实际内容不符' }
  return { exists: true, corrupt: false, profile: value, hash, file, error: null }
}

function tryGit (rootReal, env) {
  // 先确认在 git 仓库内，否则 git config 会读到全局配置，产生误导候选。
  const probe = F.runTool('git', ['rev-parse', '--is-inside-work-tree'], { cwd: rootReal, env: env })
  if (!probe.ok) {
    return { candidate: null, note: 'git 探测失败（不在 PATH 或超时）：' + (probe.stderr || 'unknown') }
  }
  if (probe.stdout.trim() !== 'true') {
    return { candidate: null, note: null } // 非仓库属常态，不写 note
  }
  const r = F.runTool('git', ['config', 'user.name'], { cwd: rootReal, env: env })
  if (!r.ok) {
    return { candidate: null, note: 'git config user.name 读取失败：' + (r.stderr || 'unknown') }
  }
  const name = r.stdout.trim()
  if (!name) return { candidate: null, note: null }
  return {
    candidate: { name: name, email: null, source: 'git-config', flags: ['unconfirmed', 'email-omitted'] },
    note: 'git user.name 仅作候选线索（未确认；作者邮箱按策略不读取、不输出）'
  }
}

function decodeXmlEntities (s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, function (_, h) { return String.fromCodePoint(parseInt(h, 16)) })
    .replace(/&#([0-9]+);/g, function (_, d) { return String.fromCodePoint(parseInt(d, 10)) })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function findSvnRoot (start) {
  let dir = start
  for (let i = 0; i < 32; i++) {
    if (fs.existsSync(path.join(dir, '.svn'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

// SVN last-changed-author：仅元数据线索。非工作副本根（子目录）同样可 svn info。
function trySvn (rootReal, env, runner) {
  const wc = findSvnRoot(rootReal)
  if (!wc) return { candidate: null, note: null } // 无 .svn 属常态
  const run = runner || F.runTool
  const r = run('svn', ['info', '--xml', '--non-interactive', rootReal], { cwd: rootReal, env: env })
  if (!r.ok) {
    return { candidate: null, note: 'svn info 失败：' + (r.stderr || 'unknown') }
  }
  const m = r.stdout.match(/<commit[^>]*>\s*<author>([^<]*)<\/author>/)
  if (!m) return { candidate: null, note: 'svn info 无 commit/author（工作副本尚无提交）' }
  const name = decodeXmlEntities(m[1]).trim()
  if (!name) return { candidate: null, note: 'svn author 为空' }
  const dm = r.stdout.match(/<date>([^<]+)<\/date>/)
  return {
    candidate: {
      name: name,
      email: null,
      source: 'svn-last-author',
      flags: ['unconfirmed', 'metadata-only'],
      lastCommitDate: dm ? decodeXmlEntities(dm[1]) : null
    },
    note: 'svn last-changed-author 仅作元数据线索，不是操作人确认'
  }
}

// 身份读取主入口：operator 只来自「已确认档案」；其余全部降级为候选+notes。
function loadIdentity (opts) {
  const o = opts || {}
  const root = F.resolveRoot(o.projectRoot)
  const env = o.env || process.env
  const notes = []
  const candidates = []
  let operator = null

  function considerProfile (r, scope) {
    if (!r.exists) {
      notes.push(scope + ' 档案不存在：' + r.file)
      return
    }
    if (r.corrupt) {
      notes.push(scope + ' 档案 JSON 损坏，按未确认处理（' + (r.error || 'parse error') + '）：' + r.file)
      return
    }
    const p = r.profile
    if (p.fixture === true || isFixtureName(p.name)) {
      notes.push(scope + ' 档案带 fixture/合成身份标记，已拒绝：' + r.file)
      candidates.push({
        name: typeof p.name === 'string' ? p.name : null,
        email: typeof p.email === 'string' ? p.email : null,
        source: 'profile(' + scope + ')',
        scope: scope,
        flags: ['fixture'],
        profileHash: r.hash
      })
      return
    }
    if (p.status === 'invalidated') {
      notes.push(scope + ' 档案已失效（invalidated），不作为操作人：' + r.file)
      candidates.push({
        name: typeof p.name === 'string' ? p.name : null,
        email: typeof p.email === 'string' ? p.email : null,
        source: 'profile(' + scope + ')',
        scope: scope,
        flags: ['invalidated', 'unconfirmed'],
        profileHash: r.hash
      })
      return
    }
    if (scope === 'global' && p.confirmation && p.confirmation.method === 'host-plan') {
      notes.push('global 宿主项目标签未授权跨工程，不作为操作人：' + r.file)
      return
    }
    const v = validateOperatorSchema(p, { projectRoot: root })
    if (v.ok) {
      const entry = Object.assign({}, p, {
        scope: scope,
        source: 'profile(' + scope + ')',
        profilePath: r.file,
        profileHash: r.hash
      })
      if (!operator) {
        operator = entry
        notes.push('操作人来自 ' + scope + ' 已确认档案（profileHash=' + r.hash.slice(0, 12) + '）')
      } else {
        candidates.push({
          name: p.name,
          email: typeof p.email === 'string' ? p.email : null,
          source: 'profile(' + scope + ')',
          scope: scope,
          flags: ['confirmed', 'superseded-by-project'],
          profileHash: r.hash
        })
        notes.push(scope + ' 档案亦为已确认，但项目档案优先，仅列为候选：' + r.file)
      }
      return
    }
    candidates.push({
      name: typeof p.name === 'string' ? p.name : null,
      email: typeof p.email === 'string' ? p.email : null,
      source: 'profile(' + scope + ')',
      scope: scope,
      flags: ['unconfirmed'],
      reason: v.reason,
      profileHash: r.hash
    })
    notes.push(scope + ' 档案未确认（' + v.reason + '）：' + r.file)
  }

  considerProfile(readProfileFile(projectProfilePath(root)), 'project')
  considerProfile(readProfileFile(globalProfilePath(o.profileRoot)), 'global')

  if (!operator) {
    const git = tryGit(root, env)
    if (git.note) notes.push(git.note)
    if (git.candidate) candidates.push(git.candidate)

    const svn = trySvn(root, env, o._svnRunner)
    if (svn.note) notes.push(svn.note)
    if (svn.candidate) candidates.push(svn.candidate)

    const osName = (env.USERNAME || env.USER || '').trim()
    if (osName) {
      candidates.push({ name: osName, email: null, source: 'os-user', flags: ['unconfirmed', 'metadata-only'] })
      notes.push('OS 用户名仅作候选，不能作为确认人')
    }
  }

  return {
    operator: operator,
    candidates: candidates,
    notes: notes,
    resolvedAt: F.nowIso(o.now)
  }
}

// 保存/更新确认档案。规则：
//   * scope 显式 project|global，缺省 project，绝不默认 global；
//   * 已存在档案：必须携带 expectHash=当前 hash，否则拒绝覆盖；
//   * invalidated 档案：必须再带 reconfirm 标记与新的确认语句；
//   * fixture/合成姓名拒绝写入。
function saveProfileLocked (opts) {
  const o = opts || {}
  const scope = o.scope === undefined ? 'project' : o.scope
  if (scope !== 'project' && scope !== 'global') {
    throw new F.FbError('BAD_SCOPE', '--scope 只支持 project|global（显式指定；绝不默认 global）')
  }
  const root = o.projectRoot ? F.resolveRoot(o.projectRoot) : null
  if (scope === 'project' && !root) throw new F.FbError('ROOT_REQUIRED', 'project 作用域保存档案需要 projectRoot')

  const name = validateName(o.name)
  const email = validateEmail(o.email)
  if (isFixtureName(name)) {
    throw new F.FbError('FIXTURE_NAME_REJECTED', '姓名疑似 fixture/合成身份，拒绝写入真实档案：' + name)
  }
  const sourceRef = validateSourceRef(o.sourceRef)
  const method = o.method === undefined ? inferMethod(sourceRef) : o.method
  if (!CONFIRM_METHODS.includes(method)) {
    throw new F.FbError('BAD_METHOD', 'method 必须是 user-message|terminal|host-plan')
  }
  const tv = method === 'host-plan'
    ? validateHostApproval(o.hostApproval, { projectRoot: root, displayName: name })
    : validateIdentityText(o.confirmationText, name)
  if (method === 'host-plan' && scope === 'global') throw new F.FbError('BAD_SCOPE', '宿主项目日志标签只能在项目内保存，不扩大为全局身份')
  if (!tv.ok || method === 'host-plan' && (o.confirmationText !== tv.text || sourceRef !== o.hostApproval.reference)) throw new F.FbError('EVIDENCE_TEXT_REJECTED', '确认语句被拒绝：' + (tv.reason || '宿主结果来源不符'))

  let file
  if (scope === 'global') {
    let base = o.profileRoot || path.join(os.homedir(), '.fb-skill')
    F.ensureDir(base)
    base = fs.realpathSync(base)
    file = path.join(base, 'profile.json')
  } else {
    file = projectProfilePath(root)
  }

  const existing = readProfileFile(file)
  if (existing.exists && existing.corrupt) {
    throw new F.FbError('PROFILE_CORRUPT', '现有档案 JSON 损坏，拒绝静默覆盖（' + (existing.error || '') + '）：' + file)
  }
  if (existing.exists) {
    const currentHash = existing.hash
    if (o.expectHash === undefined) {
      throw new F.FbError('OVERWRITE_REJECTED', '档案已存在，默认拒绝覆盖；请先读取当前档案并携带 --expect-hash（当前 hash=' + currentHash + '）', { currentHash: currentHash })
    }
    if (o.expectHash !== currentHash) {
      throw new F.FbError('HASH_MISMATCH', '--expect-hash 与当前档案不符（当前 hash=' + currentHash + '）', { currentHash: currentHash })
    }
    if (existing.profile.status === 'invalidated' && !o.reconfirm) {
      throw new F.FbError('PROFILE_INVALIDATED', '旧档案已失效：重新确认必须显式携带 --reconfirm 与新的确认语句')
    }
  }

  const now = F.nowIso(o.now)
  const revision = existing.exists && existing.profile && typeof existing.profile.revision === 'number'
    ? existing.profile.revision + 1
    : 1
  const body = {
    schema: IDENTITY_SCHEMA,
    name: name,
    email: email,
    status: 'confirmed',
    fixture: false,
    revision: revision,
    confirmation: {
      method: method,
      sourceRef: sourceRef,
      text: tv.text,
      ...(method === 'host-plan' ? { hostApproval: o.hostApproval } : {}),
      confirmedAt: now.atLocal
    },
    updatedAt: now.at
  }
  body.hash = F.hashObject(body)
  const finalState = readProfileFile(file)
  if (finalState.exists !== existing.exists || finalState.hash !== existing.hash) throw new F.FbError('HASH_MISMATCH', '档案在写入前变化，拒绝覆盖')
  F.writeJsonAtomic(file, body)
  return { scope: scope, file: file, profile: body, hash: body.hash }
}

// 显式失效档案（供清理/演练作废使用），需 expect-hash 防误覆盖。
function invalidateProfileLocked (opts) {
  const o = opts || {}
  const scope = o.scope === undefined ? 'project' : o.scope
  if (scope !== 'project' && scope !== 'global') throw new F.FbError('BAD_SCOPE', '--scope 只支持 project|global')
  const root = o.projectRoot ? F.resolveRoot(o.projectRoot) : null
  if (scope === 'project' && !root) throw new F.FbError('ROOT_REQUIRED', 'project 作用域需要 projectRoot')
  const file = scope === 'global' ? globalProfilePath(o.profileRoot) : projectProfilePath(root)
  const existing = readProfileFile(file)
  if (!existing.exists) throw new F.FbError('PROFILE_NOT_FOUND', '档案不存在，无需失效：' + file)
  if (existing.corrupt) throw new F.FbError('PROFILE_CORRUPT', '档案损坏，拒绝操作：' + file)
  const currentHash = existing.hash
  if (o.expectHash !== currentHash) {
    throw new F.FbError('HASH_MISMATCH', '失效档案必须携带 --expect-hash（当前 hash=' + currentHash + '）', { currentHash: currentHash })
  }
  const now = F.nowIso(o.now)
  const body = Object.assign({}, F.withoutHash(existing.profile), {
    status: 'invalidated',
    revision: (typeof existing.profile.revision === 'number' ? existing.profile.revision : 1) + 1,
    invalidatedAt: now.atLocal,
    invalidateReason: typeof o.reason === 'string' && o.reason.trim() ? o.reason.trim().slice(0, 200) : 'manual-invalidate'
  })
  body.hash = F.hashObject(body)
  const finalState = readProfileFile(file)
  if (finalState.exists !== existing.exists || finalState.hash !== existing.hash) throw new F.FbError('HASH_MISMATCH', '档案在写入前变化，拒绝覆盖')
  F.writeJsonAtomic(file, body)
  return { scope: scope, file: file, profile: body, hash: body.hash }
}

function profileWritePath (options) {
  const scope = options.scope === undefined ? 'project' : options.scope
  if (!['project', 'global'].includes(scope)) throw new F.FbError('BAD_SCOPE', '--scope 只支持 project|global')
  const file = scope === 'global' ? globalProfilePath(options.profileRoot) : projectProfilePath(F.resolveRoot(options.projectRoot))
  F.assertNoLinks(file)
  return file
}

function saveProfile (options) {
  const opts = options || {}
  const file = profileWritePath(opts)
  return F.withLock(file + '.lock', function () { return saveProfileLocked(opts) })
}

function invalidateProfile (options) {
  const opts = options || {}
  const file = profileWritePath(opts)
  return F.withLock(file + '.lock', function () { return invalidateProfileLocked(opts) })
}

module.exports = {
  IDENTITY_SCHEMA: IDENTITY_SCHEMA,
  CONFIRM_METHODS: CONFIRM_METHODS,
  readIdentity: loadIdentity,
  loadIdentity: loadIdentity,
  saveProfile: saveProfile,
  invalidateProfile: invalidateProfile,
  validateHostApproval: validateHostApproval,
  HOST_PLAN_RESULT: HOST_PLAN_RESULT,
  validateConfirmationText: validateConfirmationText,
  validateIdentityText: validateIdentityText,
  validateOperatorSchema: validateOperatorSchema,
  validateName: validateName,
  validateEmail: validateEmail,
  validateSourceRef: validateSourceRef,
  isFixtureName: isFixtureName,
  inferMethod: inferMethod,
  decodeXmlEntities: decodeXmlEntities,
  tryGit: tryGit,
  trySvn: trySvn,
  readProfileFile: readProfileFile,
  profileHashOf: profileHashOf,
  projectProfilePath: projectProfilePath,
  globalProfilePath: globalProfilePath
}
