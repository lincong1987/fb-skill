'use strict'

// audit.cjs — append-only 审计链（events.jsonl）。
//
// 每条事件一行 JSON：
//   { seq, prevHash, hash, type, actor, details, at, atOffset, atLocal }
// hash = SHA-256(canonicalJson(除 hash 外的全部字段))；seq 从 1 连续递增；
// 首条 prevHash = 64 个 '0'（GENESIS_HASH）。
//
// 追加协议（防并发 / 防 TOCTOU）：
//   1. 取 workflows/<id>/.lock 独占锁（进程内可重入）；
//   2. 锁内重读全部事件并校验链（损坏即拒绝追加，不静默跳过）；
//   3. 执行调用方 guard()（例如重验计划文件 hash）；
//   4. 新文件用 wx 创建，已有文件确认末行完整后单次追加一行。
//
// 事件类型分两组：
//   * 系统事件（工具内部产生）：plan-created / revision-created / approval
//   * CLI 允许事件（非批准类，供人工/流程记录）：note / implementation-start /
//     implementation-complete / verification / blocked / skipped
// approval 不可经 CLI event 命令伪造。
//
// 限制：审计链防「无意损坏与本地误操作」；能整文件重写并重算链的本地攻击者
// 不在防护范围内（README/报告需注明）。

const fs = require('fs')
const path = require('path')
const F = require('./files.cjs')

const SYSTEM_EVENT_TYPES = ['plan-created', 'revision-created', 'approval']
const CLI_ALLOWED_EVENT_TYPES = ['note', 'implementation-start', 'implementation-complete', 'verification', 'blocked', 'skipped']
const KNOWN_EVENT_TYPES = SYSTEM_EVENT_TYPES.concat(CLI_ALLOWED_EVENT_TYPES)

function workflowDir (rootReal, id) {
  F.assertSlug(id)
  const dir = path.join(rootReal, '.agents', 'fb-feature', 'workflows', id)
  F.assertNoLinks(dir)
  return dir
}

function plansDir (rootReal, id) {
  return path.join(workflowDir(rootReal, id), 'plans')
}

function eventsPath (rootReal, id) {
  return path.join(workflowDir(rootReal, id), 'events.jsonl')
}

function lockPath (rootReal, id) {
  return path.join(workflowDir(rootReal, id), '.lock')
}

function assertKnownType (type) {
  if (typeof type !== 'string' || !KNOWN_EVENT_TYPES.includes(type)) {
    throw new F.FbError('BAD_EVENT_TYPE', '未知事件类型：' + JSON.stringify(type) + '；可用：' + KNOWN_EVENT_TYPES.join(', '))
  }
}

function buildEventBody (input) {
  assertKnownType(input.type)
  const t = input.now || F.nowIso()
  return {
    type: input.type,
    actor: input.actor === undefined ? null : input.actor,
    details: input.details === undefined ? {} : input.details,
    at: t.at,
    atOffset: t.atOffset,
    atLocal: t.atLocal
  }
}

function eventHash (rec) {
  return F.hashObject(F.withoutHash(rec))
}

function parseEvents (raw, file) {
  const records = []
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') {
      if (i === lines.length - 1) continue // 文件以 \n 结尾的正常空尾
      throw new F.FbError('AUDIT_CORRUPT', '审计文件中间出现空行：' + file + ' 第 ' + (i + 1) + ' 行')
    }
    let rec
    try {
      rec = JSON.parse(line)
    } catch (e) {
      throw new F.FbError('AUDIT_CORRUPT', '审计行不是合法 JSON：' + file + ' 第 ' + (i + 1) + ' 行：' + F.firstLine(e.message))
    }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
      throw new F.FbError('AUDIT_CORRUPT', '审计行不是对象：' + file + ' 第 ' + (i + 1) + ' 行')
    }
    records.push(rec)
  }
  return records
}

function readAuditRecords (rootReal, id) {
  const file = eventsPath(rootReal, id)
  const r = F.readText(file)
  if (!r.exists) return { exists: false, records: [], file: file }
  return { exists: true, records: parseEvents(r.raw, file), file: file }
}

function verifyChain (records) {
  const errors = []
  let prev = F.GENESIS_HASH
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (rec.seq !== i + 1) errors.push('第 ' + (i + 1) + ' 条 seq 期望 ' + (i + 1) + ' 实际 ' + rec.seq)
    if (rec.prevHash !== prev) errors.push('第 ' + (i + 1) + ' 条 prevHash 断链')
    const expect = eventHash(rec)
    if (rec.hash !== expect) errors.push('第 ' + (i + 1) + ' 条 hash 与内容不符')
    prev = rec.hash
    if (errors.length >= 8) break
  }
  return {
    ok: errors.length === 0,
    errors: errors,
    count: records.length,
    headHash: records.length ? records[records.length - 1].hash : F.GENESIS_HASH
  }
}

// 追加一条事件。独占锁内：重读 → 验链 → guard()（TOCTOU 复核）→ 追加。
// 返回写入的完整记录（含 seq/hash）。
function appendEvent (input) {
  const root = F.resolveRoot(input.projectRoot)
  const id = F.assertSlug(input.id)
  const file = eventsPath(root, id)
  return F.withLock(lockPath(root, id), function () {
    const audit = readAuditRecords(root, id)
    const chain = verifyChain(audit.records)
    if (!chain.ok) {
      throw new F.FbError('CHAIN_BROKEN', '审计链校验失败，拒绝追加：' + chain.errors.join('；'))
    }
    if (typeof input.guard === 'function') input.guard() // TOCTOU：锁内最终复核
    const body = buildEventBody(input)
    const rec = {
      seq: audit.records.length + 1,
      prevHash: chain.headHash,
      type: body.type,
      actor: body.actor,
      details: body.details,
      at: body.at,
      atOffset: body.atOffset,
      atLocal: body.atLocal
    }
    rec.hash = eventHash(rec)
    const line = JSON.stringify(rec) + '\n'
    if (!audit.exists) {
      F.ensureDir(path.dirname(file))
      let fd
      try {
        fd = fs.openSync(file, 'wx')
      } catch (e) {
        throw new F.FbError('AUDIT_RACE', '审计文件在持有锁期间被绕过锁创建，拒绝追加：' + file)
      }
      try { fs.writeSync(fd, line) } finally { fs.closeSync(fd) }
      return rec
    }
    F.assertNoLinks(file)
    const raw = fs.readFileSync(file, 'utf8')
    if (raw.length > 0 && raw.charAt(raw.length - 1) !== '\n') {
      throw new F.FbError('AUDIT_CORRUPT', '审计文件末行不完整，拒绝追加：' + file)
    }
    const finalChain = verifyChain(parseEvents(raw, file))
    if (!finalChain.ok || finalChain.headHash !== chain.headHash || finalChain.count !== chain.count) throw new F.FbError('AUDIT_RACE', '审计文件在追加前变化，拒绝追加')
    F.assertNoLinks(file)
    fs.appendFileSync(file, line)
    return rec
  })
}

function verifyAudit (input) {
  const root = F.resolveRoot(input.projectRoot)
  const audit = readAuditRecords(root, input.id)
  const chain = verifyChain(audit.records)
  return {
    ok: chain.ok,
    exists: audit.exists,
    file: audit.file,
    count: chain.count,
    headHash: chain.headHash,
    errors: chain.errors
  }
}

module.exports = {
  SYSTEM_EVENT_TYPES: SYSTEM_EVENT_TYPES,
  CLI_ALLOWED_EVENT_TYPES: CLI_ALLOWED_EVENT_TYPES,
  KNOWN_EVENT_TYPES: KNOWN_EVENT_TYPES,
  workflowDir: workflowDir,
  plansDir: plansDir,
  eventsPath: eventsPath,
  lockPath: lockPath,
  assertKnownType: assertKnownType,
  buildEventBody: buildEventBody,
  eventHash: eventHash,
  parseEvents: parseEvents,
  readAuditRecords: readAuditRecords,
  verifyChain: verifyChain,
  appendEvent: appendEvent,
  verifyAudit: verifyAudit
}
