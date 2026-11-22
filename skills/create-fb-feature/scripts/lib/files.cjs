'use strict'

// files.cjs — 门禁共享的文件系统原语（Node >= 18 纯内建，无第三方依赖）。
//
// 约定（对应 docs/design.md「可执行门禁与留痕」）：
//   * 内容寻址：canonical JSON（键递归排序、跳过 undefined 值的键）+ SHA-256。
//   * 不可变：计划按 revision 命名，wx 独占创建，存在即失败，绝不覆盖。
//   * 原子替换：仅用于已按 --expect-hash 读后校验的身份档案（tmp + rename）。
//   * 独占锁：wx 锁文件 + 进程内可重入计数；锁内重读校验后再追加，防 TOCTOU。
//   * 路径围栏：只接受 / 分隔的相对路径；拒绝 ..、.、空段、绝对路径、盘符、
//     反斜杠与控制字符；对最深已存在祖先做 realpath，检测 symlink/junction 越界。
//   * 外部命令（git/svn）统一 3s 超时；错误不吞，以 stderr/message 首行回传。
//
// 边界声明：这是本地审计与防误操作门禁的底层原语，不冒充企业 IAM、
// 数字签名或不可绕过的安全边界；绕开本工具直接写文件不受此层控制。

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')

class FbError extends Error {
  constructor (code, message, details) {
    super(message)
    this.name = 'FbError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

const GENESIS_HASH = '0'.repeat(64)
const CONTROL_RE = /[\u0000-\u001F\u007F]/
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

function sha256Hex (text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

// 稳定序列化：键排序、跳过 undefined 值的键；同一逻辑对象得到同一字符串与哈希。
function canonicalJson (value) {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const keys = Object.keys(value).filter(function (k) { return value[k] !== undefined }).sort()
  const parts = keys.map(function (k) { return JSON.stringify(k) + ':' + canonicalJson(value[k]) })
  return '{' + parts.join(',') + '}'
}

function hashObject (obj) {
  return sha256Hex(canonicalJson(obj))
}

function withoutHash (obj) {
  const copy = Object.assign({}, obj)
  delete copy.hash
  return copy
}

function pad2 (n) {
  return String(n).padStart(2, '0')
}

function timeZoneOffsetString (date) {
  const minutes = -date.getTimezoneOffset()
  const sign = minutes >= 0 ? '+' : '-'
  const abs = Math.abs(minutes)
  return sign + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60)
}

// 一次性产出：UTC ISO（at）+ 本地时区偏移（atOffset）+ 带偏移的本地 ISO（atLocal）。
function nowIso (date) {
  const d = date instanceof Date ? date : new Date()
  const atOffset = timeZoneOffsetString(d)
  const shifted = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  const atLocal = shifted.toISOString().slice(0, -1) + atOffset
  return { at: d.toISOString(), atOffset: atOffset, atLocal: atLocal }
}

// plan id → 安全 slug：小写字母/数字/连字符；无法归一化或超长即拒绝。
function safeSlug (raw) {
  if (typeof raw !== 'string') throw new FbError('BAD_PLAN_ID', 'plan id 必须是字符串')
  const slug = raw.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  if (!slug) throw new FbError('BAD_PLAN_ID', 'plan id 无法归一化为安全 slug：' + JSON.stringify(raw))
  if (slug.length > 64) throw new FbError('BAD_PLAN_ID', 'plan id slug 过长（>64）：' + slug)
  return slug
}

// 已归一化 id 的严格校验（用于拼接路径前的最后防线）。
function assertSlug (id) {
  if (typeof id !== 'string' || !SLUG_RE.test(id)) {
    throw new FbError('BAD_PLAN_ID', 'workflow id 必须匹配 ' + String(SLUG_RE) + '：' + JSON.stringify(id))
  }
  return id
}

function resolveRoot (projectRoot) {
  if (typeof projectRoot !== 'string' || !projectRoot) {
    throw new FbError('ROOT_REQUIRED', '缺少 projectRoot（CLI 请传 --project-root）')
  }
  let real
  try {
    real = fs.realpathSync(projectRoot)
  } catch (e) {
    throw new FbError('ROOT_NOT_FOUND', '项目根不存在或不可达：' + projectRoot)
  }
  const absolute = path.resolve(projectRoot)
  const supplied = fs.lstatSync(absolute)
  if (supplied.isSymbolicLink()) throw new FbError('SYMLINK_ESCAPE', '项目根不能是 symlink/junction：' + absolute)
  assertNoLinks(absolute)
  const st = fs.statSync(real)
  if (!st.isDirectory()) throw new FbError('ROOT_NOT_DIR', '项目根不是目录：' + real)
  return real
}

function isInsideDir (rootReal, target) {
  const relative = path.relative(rootReal, target)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))
}

// 校验单个文件范围项：返回 {rel, abs}；非法即抛 FbError。
// rel 必须是 / 分隔的相对路径；对已存在的最深祖先做 realpath，捕获任意层级的
// symlink/junction 越界。目标文件本身可以尚不存在（计划允许新建文件）。
function assertRelativeFileInRoot (rootReal, rel) {
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new FbError('BAD_FILE_SCOPE', '文件范围项不能为空')
  }
  if (rel.indexOf('\u0000') !== -1) throw new FbError('BAD_FILE_SCOPE', '文件范围含 NUL：' + JSON.stringify(rel))
  if (rel.indexOf('\\') !== -1) throw new FbError('BAD_FILE_SCOPE', '文件范围必须用 / 分隔（拒绝反斜杠）：' + JSON.stringify(rel))
  if (/^[a-zA-Z]:/.test(rel)) throw new FbError('BAD_FILE_SCOPE', '文件范围拒绝盘符/绝对路径：' + JSON.stringify(rel))
  if (rel.charAt(0) === '/') throw new FbError('BAD_FILE_SCOPE', '文件范围拒绝绝对路径：' + JSON.stringify(rel))
  const parts = rel.split('/')
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') {
      throw new FbError('BAD_FILE_SCOPE', '文件范围拒绝空段/./..：' + JSON.stringify(rel))
    }
    if (CONTROL_RE.test(part) || /[:<>"|?*]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) throw new FbError('BAD_FILE_SCOPE', '文件范围含不安全的路径段：' + JSON.stringify(rel))
  }
  const absolute = path.join.apply(path, [rootReal].concat(parts))
  assertNoLinks(absolute, { allowHardlinks: true })
  const deepest = deepestExistingRealpath(rootReal, parts)
  if (!isInsideDir(rootReal, deepest)) {
    throw new FbError('SYMLINK_ESCAPE', '文件范围经 realpath 解析后越出项目根（symlink/junction）：' + rel)
  }
  return { rel: parts.join('/'), abs: path.join.apply(path, [rootReal].concat(parts)) }
}

// 沿相对路径逐段下探；对已存在的段推进，遇 symlink/junction 先解析再继续，
// 最后对最深已存在祖先做 realpath —— 一次性捕获任意层级的越界链接。
function deepestExistingRealpath (rootReal, parts) {
  let probe = rootReal
  let last = rootReal
  for (const part of parts) {
    const next = path.join(probe, part)
    let st
    try {
      st = fs.lstatSync(next)
    } catch (e) {
      break // 其余段尚不存在（新建文件），无需继续
    }
    probe = next
    if (st.isSymbolicLink()) probe = fs.realpathSync(next)
    last = probe
  }
  return fs.realpathSync(last)
}

function assertNoLinks (file, options) {
  const absolute = path.resolve(file)
  const root = path.parse(absolute).root
  const parts = absolute.slice(root.length).split(path.sep).filter(Boolean)
  let current = root
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index])
    let stat
    try { stat = fs.lstatSync(current) } catch (error) {
      if (error.code === 'ENOENT') return absolute
      throw new FbError('UNSAFE_PATH', '路径不可检视：' + current + '：' + firstLine(error.message))
    }
    if (stat.isSymbolicLink()) throw new FbError('SYMLINK_ESCAPE', '路径含 symlink/junction，拒绝：' + current)
    if (index < parts.length - 1 && !stat.isDirectory()) throw new FbError('UNSAFE_PATH', '祖先不是目录：' + current)
    if (stat.isFile() && stat.nlink > 1 && !(options && options.allowHardlinks)) throw new FbError('HARDLINK_REFUSED', '文件为硬链接，拒绝：' + current)
  }
  return absolute
}

function ensureDir (dir) {
  assertNoLinks(dir)
  fs.mkdirSync(dir, { recursive: true })
  assertNoLinks(dir)
}

// 不可变写：wx 独占创建，目标已存在即失败，绝不覆盖已读/未读内容。
function writeTextExclusive (file, text) {
  assertNoLinks(file)
  ensureDir(path.dirname(file))
  assertNoLinks(file)
  let fd
  try {
    fd = fs.openSync(file, 'wx')
  } catch (e) {
    if (e.code === 'EEXIST') throw new FbError('FILE_EXISTS', '目标已存在，拒绝覆盖（不可变写）：' + file)
    throw e
  }
  try {
    fs.writeSync(fd, text)
  } finally {
    fs.closeSync(fd)
  }
}

function writeJsonImmutable (file, obj) {
  return writeTextExclusive(file, JSON.stringify(obj, null, 2) + '\n')
}

// 原子替换写：tmp（wx）+ rename。仅用于"已读取并校验 hash 后"的档案更新。
function writeTextAtomic (file, text) {
  assertNoLinks(file)
  ensureDir(path.dirname(file))
  const tmp = file + '.tmp-' + crypto.randomBytes(6).toString('hex')
  let fd = fs.openSync(tmp, 'wx')
  try {
    fs.writeSync(fd, text)
  } finally {
    fs.closeSync(fd)
  }
  try {
    assertNoLinks(file)
    fs.renameSync(tmp, file)
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch (e2) { /* 保留现场便于排查 */ }
    throw e
  }
}

function writeJsonAtomic (file, obj) {
  return writeTextAtomic(file, JSON.stringify(obj, null, 2) + '\n')
}

function readText (file) {
  assertNoLinks(file)
  try {
    return { exists: true, raw: fs.readFileSync(file, 'utf8') }
  } catch (e) {
    if (e.code === 'ENOENT') return { exists: false, raw: null }
    throw new FbError('READ_FAILED', '读取失败 ' + file + '：' + e.message)
  }
}

function readJson (file) {
  const r = readText(file)
  if (!r.exists) return { exists: false, value: null, raw: null }
  try {
    return { exists: true, value: JSON.parse(r.raw), raw: r.raw }
  } catch (e) {
    throw new FbError('JSON_CORRUPT', 'JSON 解析失败 ' + file + '：' + e.message)
  }
}

function sleepSync (ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const LOCK_TIMEOUT_MS = 5000

function acquireLock (lockFile, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || LOCK_TIMEOUT_MS
  const token = process.pid + '-' + crypto.randomBytes(8).toString('hex')
  const start = Date.now()
  assertNoLinks(lockFile)
  ensureDir(path.dirname(lockFile))
  for (;;) {
    let fd
    try {
      fd = fs.openSync(lockFile, 'wx')
    } catch (e) {
      if (e.code !== 'EEXIST') throw new FbError('LOCK_FAILED', '创建锁失败 ' + lockFile + '：' + e.message)
      assertNoLinks(lockFile)
      if (Date.now() - start > timeoutMs) {
        throw new FbError('LOCK_TIMEOUT', '获取独占锁超时；未自动删除可能仍活跃的锁：' + lockFile)
      }
      sleepSync(25)
      continue
    }
    try {
      fs.writeSync(fd, JSON.stringify({ token: token, pid: process.pid, at: new Date().toISOString() }))
    } finally {
      fs.closeSync(fd)
    }
    return token
  }
}

function releaseLock (lockFile, token) {
  try {
    assertNoLinks(lockFile)
    const owner = JSON.parse(fs.readFileSync(lockFile, 'utf8'))
    if (owner.token !== token) return
    fs.unlinkSync(lockFile)
  } catch (e) { /* 锁已不存在 */ }
}

const heldLocks = new Map()

// 跨进程独占锁；同进程内可重入（嵌套调用不会自我死锁）。
function withLock (lockFile, fn, opts) {
  const held = heldLocks.get(lockFile)
  if (held) {
    held.depth += 1
    try {
      return fn()
    } finally {
      held.depth -= 1
      if (held.depth === 0) {
        heldLocks.delete(lockFile)
        releaseLock(lockFile, held.token)
      }
    }
  }
  const token = acquireLock(lockFile, opts || {})
  heldLocks.set(lockFile, { token: token, depth: 1 })
  try {
    return fn()
  } finally {
    heldLocks.delete(lockFile)
    releaseLock(lockFile, token)
  }
}

function firstLine (text) {
  if (!text) return ''
  return String(text).split(/\r?\n/)[0].slice(0, 200)
}

// 外部命令统一封装：默认 3s 超时；失败不吞——stderr（或 message）首行回传。
// 调用方（identity.cjs）负责把错误写进 notes，绝不静默丢弃。
function runTool (cmd, args, opts) {
  const o = opts || {}
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: o.timeoutMs || 3000,
      windowsHide: true,
      cwd: o.cwd,
      env: o.env,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'] // 显式管道：失败时 stderr 进 e.stderr，不泄漏到本进程控制台
    })
    return { ok: true, stdout: stdout, stderr: '' }
  } catch (e) {
    const stderr = e && e.stderr ? String(e.stderr) : String((e && e.message) || '')
    return {
      ok: false,
      stdout: typeof (e && e.stdout) === 'string' ? e.stdout : '',
      stderr: firstLine(stderr).trim()
    }
  }
}

module.exports = {
  FbError: FbError,
  GENESIS_HASH: GENESIS_HASH,
  CONTROL_RE: CONTROL_RE,
  SLUG_RE: SLUG_RE,
  sha256Hex: sha256Hex,
  canonicalJson: canonicalJson,
  hashObject: hashObject,
  withoutHash: withoutHash,
  nowIso: nowIso,
  timeZoneOffsetString: timeZoneOffsetString,
  safeSlug: safeSlug,
  assertSlug: assertSlug,
  resolveRoot: resolveRoot,
  isInsideDir: isInsideDir,
  assertRelativeFileInRoot: assertRelativeFileInRoot,
  deepestExistingRealpath: deepestExistingRealpath,
  assertNoLinks: assertNoLinks,
  ensureDir: ensureDir,
  writeTextExclusive: writeTextExclusive,
  writeJsonImmutable: writeJsonImmutable,
  writeTextAtomic: writeTextAtomic,
  writeJsonAtomic: writeJsonAtomic,
  readText: readText,
  readJson: readJson,
  withLock: withLock,
  sleepSync: sleepSync,
  runTool: runTool,
  firstLine: firstLine
}
