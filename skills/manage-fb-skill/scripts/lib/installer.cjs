'use strict'

// installer.cjs — fb-skill 三件套安装 / 更新 / 旧 fb-rules 精确清理（可导入核心库）。
//
// 设计边界（docs/design.md「安装与旧规则清理」）：
//   * scan 纯只读；plan 只经 workflow.cjs createPlan 落唯一 plan-vN.json（payload 存
//     metadata.installation，不另写 proposals）；apply 必须先通过 workflow.cjs
//     assertApproved（真实 approval 事件绑定计划哈希），没有任何绕门禁 flag。
//   * apply 全程持有 workflow 独占锁（files.withLock + audit.lockPath，同进程可重入）：
//     assertApproved → 整份预验（源/目标/manifest/锚漂移检测）→ implementation-start
//     （追加失败即停止，一个字节不写）→ 逐文件备份/写入/清理 → implementation-complete。
//     这不是事务：中途失败如实记录（failures + 备份恢复路径），绝不宣称原子回滚。
//   * 安装范围严格限定 <location>/<skill-name>/… 与安装管理元数据文件；location 仅
//     .agents/skills | .claude/skills。旧规则清理只 unlink 与 catalog 变体精确哈希匹配
//     的文件；不递归删除、不清空工具目录，不动 AGENTS.md/CLAUDE.md/.claude 其他内容/
//     node_modules/锁文件/.git/.svn。目录 junction / 文件硬链接一律保留不跟随。
//   * generic/空指纹条目（.comate/mcp.json、.calude/settings.json、.calude/CLAUDE.md、
//     .fb/README.md 等）仅在强 bundle 锚（.lingma/index.json 精确命中 且 ≥1 个独占文件
//     命中，或 ≥8 个独占文件命中）时才成为清理候选。
//   * manifest（.agents/fb-feature/install-manifest.json）只记本套 own filepaths/
//     hashes/sourceVersion；schema/root/path/键形状不符即视为不可信——不可信的
//     manifest 拒绝被覆盖、也拒绝据其产生 update。
//   * sourceVersion：只来自随三件套分发的 manage-fb-skill/bundle.json；
//     不额外写来源元数据文件，绝不取目标项目自己的 package 版本。
//   * 旧 fb-rules 源码仓、fb1.1.js monorepo、fb-skill 源仓库自身 → 拒绝 plan/apply，
//     仅允许 scan。apply 还要求每个 op path 必须出现在计划 files 清单内，杜绝外部
//     手造 metadata 借 apply 删除用户文件。
//   * 身份不在这里推断：actor 只取审计链中匹配当前修订的真实 approval 事件操作人
//     （workflow.recordApproval 已校验 confirmed 身份）；绝不使用 OS/Git/SVN 候选。
//
// 已知限制：本地哈希与审计链防「无意损坏与本地误操作」；能整文件重写并重算链的
// 本地攻击者不在防护范围内（与 workflow.cjs 一致，README/报告需注明）。

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const F = require('../../../create-fb-feature/scripts/lib/files.cjs')
const SF = require('../../../create-fb-feature/scripts/lib/skill-format.cjs')
const AUDIT = require('../../../create-fb-feature/scripts/lib/audit.cjs')
const W = require('../../../create-fb-feature/scripts/workflow.cjs')

const INSTALLER_SCHEMA = 1
const ACTIONS = ['install', 'clean-legacy', 'install-and-clean']
const LOCATIONS = ['.agents/skills', '.claude/skills']
const MANIFEST_REL = '.agents/fb-feature/install-manifest.json'
const WORKFLOWS_REL = '.agents/fb-feature/workflows'
const ANCHOR_MIN_EXCLUSIVE = 8
const LEGACY_TARGET_DIRS = ['.fb', '.lingma', '.qoder', '.trae', '.codebuddy', '.comate', '.calude', '.gemini', '.iflow', '.agent', '.cursor', '.amazonq']

// 分发时不混入开发/测试产物（skill-format 已对 tests/fixtures/evals 等硬性拒绝，
// 这里再加 docs 与文件名模式的双重防线）。
const COPY_EXCLUDED_SEGMENTS = new Set(['docs', 'tests', 'fixtures', 'evals', '.validation-output', 'node_modules', '.git'])
const COPY_EXCLUDED_FILE_RE = /(?:\.test\.|\.spec\.|\.tgz$|\.zip$)/i

const HASH_RE = /^[0-9a-f]{64}$/

function toPosix (p) {
  return p.split(path.sep).join('/')
}

function sha256Buffer (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

// 仅 CRLF→LF 吸收 autocrlf 差异；不做其他任何文本归一化。
function canonicalLfSha256 (buf) {
  return sha256Buffer(Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1'))
}

// ---------------------------------------------------------------------------
// 文件检视：区分 missing / 常规文件 / symlink / 其他；绝不跟随链接读内容。
function inspectFile (abs) {
  let st
  try {
    st = fs.lstatSync(abs)
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return { state: 'missing' }
    throw new F.FbError('SCAN_FAILED', '检视文件失败 ' + abs + '：' + F.firstLine(e.message))
  }
  if (st.isSymbolicLink()) return { state: 'symlink', size: st.size, nlink: st.nlink }
  if (!st.isFile()) return { state: 'other', size: st.size, nlink: st.nlink }
  let buf
  try {
    buf = fs.readFileSync(abs)
  } catch (e) {
    return { state: 'unreadable', reason: F.firstLine(e.message) }
  }
  return { state: 'file', buf: buf, size: buf.length, sha256: sha256Buffer(buf), canonicalLfSha256: canonicalLfSha256(buf), nlink: st.nlink }
}

// 逐段检查从项目根到目标文件的已存在祖先：任一为 symlink/junction 即返回其相对路径。
// junction 即使指向项目内，沿路径 unlink/写文件也会落到计划范围之外的物理位置，
// 因此宁可保留并如实报告，绝不跟随。
function firstLinkAncestor (rootReal, abs) {
  const rel = path.relative(rootReal, abs)
  const parts = rel.split(path.sep)
  let probe = rootReal
  for (let i = 0; i < parts.length - 1; i++) {
    probe = path.join(probe, parts[i])
    let st
    try {
      st = fs.lstatSync(probe)
    } catch (e) {
      return null // 剩余祖先尚不存在（新建文件），无链接
    }
    if (st.isSymbolicLink()) return toPosix(path.relative(rootReal, probe))
  }
  return null
}

function refusedPathReason (rootReal, rel, error) {
  if (error.code === 'SYMLINK_ESCAPE') {
    const ancestor = firstLinkAncestor(rootReal, path.join(rootReal, rel))
    return ancestor ? 'ancestor-is-link: ' + ancestor : 'target-is-link'
  }
  return 'scope-refused: ' + F.firstLine(error.message)
}

// ---------------------------------------------------------------------------
// bundle 解析：默认从本文件定位（lib → scripts → manage-fb-skill → skills）。
// --skill-source 接受两种合理布局：bundle 根自身含 3 个 skill 目录，或仓库根
// （其下 skills/ 含 3 个目录）。已安装的 skills 根同样是合法源。
// sourceVersion 只来自 bundle 内部 manage-fb-skill/bundle.json（name 必须是
// 'fb-skill'、version 必须 semver）——它随分发复制，安装后的 skills 根自包含、
// 可自我管理；绝不向上取目标项目 package.json 的版本当 bundle 版本。
function bundleHasAllSkills (dir) {
  for (const name of SF.NAMES) {
    const st = (function () {
      try { return fs.lstatSync(path.join(dir, name)) } catch (e) { return null }
    })()
    if (!st || !st.isDirectory() || st.isSymbolicLink()) return false
  }
  return true
}

function resolveBundleRoot (options) {
  const o = options || {}
  let root
  if (o.skillSource) {
    root = path.resolve(o.skillSource)
  } else {
    root = path.resolve(__dirname, '..', '..', '..')
  }
  let st
  try {
    st = fs.lstatSync(root)
  } catch (e) {
    throw new F.FbError('BUNDLE_INVALID', 'bundle 根不存在：' + root)
  }
  if (st.isSymbolicLink()) throw new F.FbError('BUNDLE_INVALID', 'bundle 根是链接，拒绝：' + root)
  if (!st.isDirectory()) throw new F.FbError('BUNDLE_INVALID', 'bundle 根不是目录：' + root)
  root = fs.realpathSync(root)
  if (!bundleHasAllSkills(root)) {
    const nested = path.join(root, 'skills')
    if (bundleHasAllSkills(nested)) {
      root = fs.realpathSync(nested)
    } else {
      throw new F.FbError('BUNDLE_INVALID', 'bundle 根需直接包含 ' + SF.NAMES.join('/') + ' 三个 skill 目录（或为含 skills/ 的仓库根）：' + root)
    }
  }

  const metaFile = path.join(root, 'manage-fb-skill', 'bundle.json')
  const meta = F.readJson(metaFile)
  if (!meta.exists || !meta.value || typeof meta.value !== 'object' ||
      meta.value.schemaVersion !== INSTALLER_SCHEMA ||
      meta.value.name !== 'fb-skill' || typeof meta.value.version !== 'string' ||
      !/^\d+\.\d+\.\d+$/.test(meta.value.version) ||
      !Array.isArray(meta.value.skills) || meta.value.skills.join(',') !== SF.NAMES.join(',')) {
    throw new F.FbError('BUNDLE_INVALID', 'bundle 内 manage-fb-skill/bundle.json 缺失或不合法（需 schemaVersion=' + INSTALLER_SCHEMA + '、name=fb-skill、semver version、skills 三件套）；不接受目标项目 package 版本：' + metaFile)
  }
  return { root: root, source: { name: meta.value.name, version: meta.value.version, via: 'bundle.json', file: toPosix(metaFile) } }
}

function loadBundle (options) {
  const o = options || {}
  const resolved = resolveBundleRoot(o)
  const root = resolved.root
  const skills = []
  const skipped = []
  const validations = []
  for (const name of SF.NAMES) {
    const dir = path.join(root, name)
    // checkSkillDirectory：frontmatter 校验、拒绝 symlink/junction、拒绝开发产物、断链检查。
    const info = SF.checkSkillDirectory(dir)
    validations.push(Object.assign({ skill: name }, info))
    const files = []
    for (const abs of SF.walk(dir)) {
      const relative = toPosix(path.relative(dir, abs))
      const segments = relative.split('/')
      if (segments.some(function (seg) { return COPY_EXCLUDED_SEGMENTS.has(seg) }) ||
          COPY_EXCLUDED_FILE_RE.test(relative)) {
        skipped.push({ skill: name, relative: relative, reason: 'excluded from distribution' })
        continue
      }
      const buf = fs.readFileSync(abs)
      files.push({
        rel: name + '/' + relative,
        abs: abs,
        size: buf.length,
        sha256: sha256Buffer(buf)
      })
    }
    skills.push({ name: name, dir: dir, files: files })
  }
  return { root: root, source: resolved.source, skills: skills, validations: validations, skipped: skipped }
}

// ---------------------------------------------------------------------------
// catalog：旧 fb-rules 指纹（paths/hash/size，无规则原文）。默认取 bundle 内
// manage-fb-skill/legacy/catalog.json（分发后清理能力自带指纹）。
function loadCatalog (options) {
  const o = options || {}
  const file = o.catalogPath || path.join(__dirname, '..', '..', 'legacy', 'catalog.json')
  const parsed = F.readJson(file)
  if (!parsed.exists) throw new F.FbError('CATALOG_MISSING', '旧规则指纹目录缺失：' + file)
  const catalog = parsed.value
  if (!catalog || typeof catalog !== 'object' || catalog.schemaVersion !== 1 || !Array.isArray(catalog.files) || !catalog.files.length) {
    throw new F.FbError('CATALOG_INVALID', 'catalog 结构不合法（schemaVersion/files）：' + file)
  }
  if (!catalog.package || catalog.package.name !== 'fb-rules' || !/^\d+\.\d+\.\d+$/.test(String(catalog.package.version))) {
    throw new F.FbError('CATALOG_INVALID', 'catalog.package 不是 fb-rules@semver：' + file)
  }
  const byPath = new Map()
  for (const entry of catalog.files) {
    if (!entry || typeof entry.path !== 'string' || !Array.isArray(entry.variants) || !entry.variants.length) {
      throw new F.FbError('CATALOG_INVALID', 'catalog 条目缺 path/variants：' + file)
    }
    for (const v of entry.variants) {
      if (!HASH_RE.test(String(v.contentSha256)) || typeof v.bytes !== 'number') {
        throw new F.FbError('CATALOG_INVALID', 'catalog 变体缺合法 contentSha256/bytes：' + entry.path)
      }
    }
    if (byPath.has(entry.path)) throw new F.FbError('CATALOG_INVALID', 'catalog 路径重复：' + entry.path)
    byPath.set(entry.path, entry)
  }
  return { file: toPosix(file), package: catalog.package, byPath: byPath, entries: catalog.files, matching: catalog.matching || null }
}

// ---------------------------------------------------------------------------
// manifest：只信本工具写出的 schema/root/location/键形状；旧/陌生 metadata 一律不可信。
function validManifestKey (manifest, key) {
  const prefix = manifest.location + '/'
  if (typeof key !== 'string' || !key.startsWith(prefix) || key.includes('\\')) return false
  const parts = key.slice(prefix.length).split('/')
  if (parts.length < 2 || !SF.NAMES.includes(parts[0])) return false
  return parts.every(function (seg) {
    return seg !== '' && seg !== '.' && seg !== '..' && !F.CONTROL_RE.test(seg) &&
      !/[:<>"|?*]/.test(seg) && !/[. ]$/.test(seg) &&
      !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(seg)
  })
}

function readManifest (rootReal) {
  const file = path.join(rootReal, MANIFEST_REL)
  const st = inspectFile(file)
  if (st.state === 'missing') return { exists: false, trusted: false, manifest: null, file: file, sha256: null, reason: null }
  if (st.state !== 'file') return { exists: true, trusted: false, manifest: null, file: file, sha256: null, reason: st.state === 'symlink' ? 'manifest 是链接，不可信' : 'manifest 不是常规文件，不可信' }
  let value
  try {
    value = JSON.parse(st.buf.toString('utf8'))
  } catch (e) {
    return { exists: true, trusted: false, manifest: null, file: file, sha256: st.sha256, reason: 'manifest JSON 损坏，不可信' }
  }
  const problems = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) problems.push('顶层不是对象')
  if (!value || value.schemaVersion !== INSTALLER_SCHEMA) problems.push('schemaVersion 不是 ' + INSTALLER_SCHEMA)
  if (!value || value.root !== toPosix(rootReal)) problems.push('root 与当前项目根不符')
  if (!value || !LOCATIONS.includes(value.location)) problems.push('location 不在允许集合')
  if (value && (!value.files || typeof value.files !== 'object' || Array.isArray(value.files))) problems.push('files 缺失')
  else if (value && value.files) {
    for (const key of Object.keys(value.files)) {
      if (!HASH_RE.test(String(value.files[key]))) { problems.push('files 含非法哈希：' + key); break }
      if (!validManifestKey(value, key)) { problems.push('files 含越界路径：' + key); break }
    }
  }
  if (problems.length) return { exists: true, trusted: false, manifest: value, file: file, sha256: st.sha256, reason: problems.join('；') }
  return { exists: true, trusted: true, manifest: value, file: file, sha256: st.sha256, reason: null }
}

// ---------------------------------------------------------------------------
// 安装扫描：create / adopt / update / conflict（conflict 存在即拒绝整个 install）。
function scanInstall (rootReal, bundle, location, manifestInfo) {
  const ops = []
  for (const skill of bundle.skills) {
    for (const file of skill.files) {
      const op = {
        op: null,
        path: location + '/' + file.rel,
        skill: skill.name,
        sha256: file.sha256,
        size: file.size,
        preSha256: null,
        reason: null
      }
      let scope
      try {
        scope = F.assertRelativeFileInRoot(rootReal, op.path)
      } catch (error) {
        op.op = 'conflict'
        op.reason = refusedPathReason(rootReal, op.path, error)
        ops.push(op)
        continue
      }
      const target = scope.abs
      const cur = inspectFile(target)
      if (cur.state === 'missing') {
        const link = firstLinkAncestor(rootReal, target)
        if (link) {
          op.op = 'conflict'
          op.reason = 'ancestor-is-link: ' + link
        } else {
          op.op = 'create'
        }
      } else if (cur.state === 'symlink' || cur.state === 'other') {
        op.op = 'conflict'
        op.reason = cur.state === 'symlink' ? 'target-is-link' : 'target-not-regular-file'
      } else if (cur.state === 'unreadable') {
        op.op = 'conflict'
        op.reason = 'target-unreadable: ' + cur.reason
      } else {
        op.preSha256 = cur.sha256
        const link = firstLinkAncestor(rootReal, target)
        if (link) {
          op.op = 'conflict'
          op.reason = 'ancestor-is-link: ' + link
        } else if (cur.sha256 === file.sha256) {
          op.op = 'adopt'
        } else if (manifestInfo.trusted && manifestInfo.manifest.files[op.path] === cur.sha256) {
          op.op = 'update'
        } else {
          op.op = 'conflict'
          op.reason = manifestInfo.exists
            ? 'target differs and manifest has no matching hash（' + (manifestInfo.reason || 'trusted') + '）'
            : 'target differs and no trusted install manifest'
        }
      }
      ops.push(op)
    }
  }
  ops.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0 })
  const counts = { create: 0, update: 0, adopt: 0, conflict: 0 }
  for (const op of ops) counts[op.op]++
  return { ops: ops, counts: counts }
}

// ---------------------------------------------------------------------------
// 旧规则扫描：仅精确指纹（字节或仅 EOL 差异）成为清理候选；generic/空文件需强锚。
function matchVariant (entry, cur) {
  for (const v of entry.variants) {
    if (v.contentSha256 === cur.sha256) return { variant: v, matchType: 'byte-exact' }
  }
  for (const v of entry.variants) {
    if (v.canonicalLfSha256 && v.canonicalLfSha256 === cur.canonicalLfSha256) return { variant: v, matchType: 'eol-variant' }
  }
  return null
}

function scanLegacy (rootReal, catalog) {
  const anchor = { indexMatch: false, exclusiveExactMatches: 0, minExclusive: ANCHOR_MIN_EXCLUSIVE, ok: false }
  const results = []
  for (const entry of catalog.entries) {
    let scope
    try {
      scope = F.assertRelativeFileInRoot(rootReal, entry.path)
    } catch (e) {
      results.push({ path: entry.path, kind: entry.kind, requiresAnchor: entry.requiresAnchor === true, op: 'preserve', preSha256: null, matchType: null, variantSha256: null, reason: refusedPathReason(rootReal, entry.path, e) })
      continue
    }
    const cur = inspectFile(scope.abs)
    const base = { path: scope.rel, kind: entry.kind, requiresAnchor: entry.requiresAnchor === true }
    if (cur.state === 'missing') {
      results.push(Object.assign(base, { op: 'absent', preSha256: null, matchType: null, variantSha256: null }))
      continue
    }
    if (cur.state !== 'file') {
      // symlink/junction/目录等：保留并报告，绝不跟随、绝不让整次扫描崩溃。
      results.push(Object.assign(base, { op: 'preserve', preSha256: null, matchType: null, variantSha256: null, reason: cur.state === 'symlink' ? 'target-is-link' : 'target-not-regular-file' }))
      continue
    }
    const matched = matchVariant(entry, cur)
    if (!matched) {
      results.push(Object.assign(base, { op: 'preserve', preSha256: cur.sha256, matchType: null, variantSha256: null, reason: 'modified-or-unknown-content' }))
      continue
    }
    const link = firstLinkAncestor(rootReal, scope.abs)
    if (link) {
      results.push(Object.assign(base, { op: 'preserve', preSha256: cur.sha256, matchType: matched.matchType, variantSha256: matched.variant.contentSha256, reason: 'ancestor-is-link: ' + link }))
      continue
    }
    // 锚证据：anchor 文件精确命中计入 indexMatch；独占文件命中（含 EOL 变体）计入独占数。
    if (entry.kind === 'anchor' && matched.matchType === 'byte-exact') anchor.indexMatch = true
    if (entry.kind === 'exclusive' && !entry.requiresAnchor) anchor.exclusiveExactMatches++
    results.push(Object.assign(base, {
      op: 'matched',
      preSha256: cur.sha256,
      matchType: matched.matchType,
      variantSha256: matched.variant.contentSha256,
      nlink: cur.nlink
    }))
  }
  // 强锚：.lingma/index.json 精确命中 且 至少 1 个独占文件命中；或 ≥8 个独占文件命中。
  anchor.ok = (anchor.indexMatch && anchor.exclusiveExactMatches >= 1) || anchor.exclusiveExactMatches >= ANCHOR_MIN_EXCLUSIVE

  const clean = []
  const preserved = []
  const absent = []
  for (const r of results) {
    if (r.op === 'absent') { absent.push(r); continue }
    if (r.op !== 'matched') { preserved.push(r); continue }
    if (r.requiresAnchor && !anchor.ok) {
      preserved.push(Object.assign(r, { op: 'preserve', reason: 'no-strong-anchor' }))
      continue
    }
    clean.push(Object.assign(r, { op: 'clean' }))
  }

  // 目标目录里的未知/额外文件：一律保留（只在报告中列出，绝不删除）。
  const unknown = []
  const notes = []
  let visited = 0
  let capped = false
  for (const dirName of LEGACY_TARGET_DIRS) {
    const base = path.join(rootReal, dirName)
    let st
    try {
      st = fs.lstatSync(base)
    } catch (e) { continue }
    if (!st.isDirectory() || st.isSymbolicLink()) continue
    const stack = [{ dir: base, depth: 0 }]
    while (stack.length) {
      if (unknown.length + visited > 4000) { capped = true; break }
      const item = stack.pop()
      visited++
      let children
      try {
        children = fs.readdirSync(item.dir, { withFileTypes: true })
      } catch (e) {
        notes.push('未知文件遍历读取失败 ' + toPosix(item.dir) + '：' + F.firstLine(e.message))
        continue
      }
      for (const child of children.sort(function (a, b) { return a.name.localeCompare(b.name) })) {
        const full = path.join(item.dir, child.name)
        const rel = toPosix(path.relative(rootReal, full))
        if (child.isSymbolicLink()) { notes.push('未知文件遍历跳过链接（保留）：' + rel); continue }
        if (child.isDirectory()) {
          if (item.depth < 8) stack.push({ dir: full, depth: item.depth + 1 })
          continue
        }
        if (!child.isFile()) continue
        if (catalog.byPath.has(rel)) continue
        const cur = inspectFile(full)
        unknown.push({ path: rel, size: cur.size || 0, sha256: cur.sha256 || null, state: cur.state })
      }
    }
    if (capped) break
  }
  if (capped) notes.push('未知文件遍历达到预算上限，仅列出前 4000 项；清理范围不受影响（只清精确指纹）')

  return { anchor: anchor, clean: clean, preserved: preserved, absent: absent, unknown: unknown, notes: notes }
}

// ---------------------------------------------------------------------------
// 写入范围守卫：fb-rules 源码仓 / fb1.1.js monorepo / fb-skill 源仓库自身 → 拒绝写。
// 向上最多 3 层找最近 package.json 的 name 签名；普通目标项目不受影响。
function writesRefused (rootReal) {
  const reasons = []
  let probe = rootReal
  for (let i = 0; i < 3; i++) {
    const pkg = F.readJson(path.join(probe, 'package.json'))
    if (pkg.exists && pkg.value && typeof pkg.value.name === 'string') {
      if (pkg.value.name === 'fb-rules') reasons.push('目标位于 fb-rules 源码仓内（' + toPosix(probe) + '），仅允许 scan')
      if (pkg.value.name === 'fb-skill') reasons.push('目标位于 fb-skill 源仓库内（' + toPosix(probe) + '），仅允许 scan')
      break // 最近一层 package.json 即定论，不穿透
    }
    const parent = path.dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  for (const marker of ['packages/fb-rules', 'packages/fb-cli', 'packages/fb-core']) {
    const st = (function () {
      try { return fs.lstatSync(path.join(rootReal, marker)) } catch (e) { return null }
    })()
    if (st && st.isDirectory() && !st.isSymbolicLink()) {
      reasons.push('检测到 ' + marker + '（' + (marker === 'packages/fb-rules' ? '旧规则源码仓' : 'fb1.1.js monorepo') + '），仅允许 scan')
    }
  }
  return { refused: reasons.length > 0, reasons: reasons }
}

// ---------------------------------------------------------------------------
// op path 形状校验：install op 必须落在 <location>/<skill-name>/…；legacy op 必须在
// 旧规则目标目录前缀下。这是 apply 的第二道防线（第一道是 plan.files 绑定）。
function assertInstallPathShape (location, relPath) {
  const prefix = location + '/'
  if (typeof relPath !== 'string' || !relPath.startsWith(prefix)) {
    throw new F.FbError('OP_PATH_INVALID', 'install op 越出 ' + prefix + '：' + JSON.stringify(relPath))
  }
  const parts = relPath.slice(prefix.length).split('/')
  if (!SF.NAMES.includes(parts[0]) || parts.length < 2) {
    throw new F.FbError('OP_PATH_INVALID', 'install op 未落在三个 skill 目录内：' + JSON.stringify(relPath))
  }
  for (const seg of parts.slice(1)) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new F.FbError('OP_PATH_INVALID', 'install op 含非法路径段：' + JSON.stringify(relPath))
    }
  }
}

function assertLegacyPathShape (relPath) {
  const ok = LEGACY_TARGET_DIRS.some(function (d) { return relPath === d || relPath.startsWith(d + '/') })
  if (!ok) {
    throw new F.FbError('OP_PATH_INVALID', 'legacy op 不在旧规则目标目录内：' + JSON.stringify(relPath))
  }
}

// ---------------------------------------------------------------------------
function validateAction (action) {
  if (!ACTIONS.includes(action)) {
    throw new F.FbError('BAD_ACTION', '--action 必须是 ' + ACTIONS.join('|') + '：' + JSON.stringify(action))
  }
  return action
}

function validateLocation (location) {
  const value = location === undefined || location === null || location === '' ? LOCATIONS[0] : location
  if (!LOCATIONS.includes(value)) {
    throw new F.FbError('BAD_LOCATION', '--location 只支持 ' + LOCATIONS.join('|') + '（不安装到其他位置）：' + JSON.stringify(value))
  }
  return value
}

function acceptanceFor (payload) {
  return [
    '安装写入仅限 ' + payload.location + '/{create-fb-feature,use-fbjs-vue2,manage-fb-skill}/ 与安装元数据文件内的常规文件，绝不越出项目根。',
    '存在 conflict（目标与来源不同且无匹配 manifest 哈希）或 manifest 不可信时整个 install 拒绝执行，一个字节都不写。',
    'update 仅当目标当前哈希等于既有 manifest 记录的受管哈希；替换前先把旧内容备份到 workflows/' + payload.id + '/backups/。',
    '旧规则清理只 unlink 与 catalog 变体精确哈希匹配（字节或仅 CRLF/LF 差异）的文件，逐文件先备份再 unlink，unlink 前再次复验。',
    'generic/空指纹条目仅在强 bundle 锚（.lingma/index.json 精确命中且 ≥1 个独占文件命中，或 ≥' + ANCHOR_MIN_EXCLUSIVE + ' 个独占文件命中）时清理，否则保留。',
    '被修改内容、未知额外文件与目录链接/硬链接一律保留并在报告中列明；不递归删除、不清空工具目录、不动 AGENTS.md/CLAUDE.md/node_modules/锁文件/.git/.svn。',
    '执行全程持 workflow 独占锁并先整份预验：源/目标/manifest 哈希与计划不符即 blocked，不写入；implementation-start 追加失败即停止。',
    '批准必须来自 workflow.recordApproval 的真实 approval 事件（已确认操作人 + 来源证据）；无批准 apply 直接拒绝。过程不是事务，局部失败如实报告。'
  ]
}

function buildPayload (input) {
  const action = input.action
  const includeInstall = action === 'install' || action === 'install-and-clean'
  const includeClean = action === 'clean-legacy' || action === 'install-and-clean'
  return {
    schemaVersion: INSTALLER_SCHEMA,
    tool: 'fb-skill-installer',
    id: input.id,
    action: action,
    projectRoot: toPosix(input.rootReal),
    location: input.location,
    bundle: { root: toPosix(input.bundle.root), source: input.bundle.source },
    catalog: { file: input.catalog.file, package: input.catalog.package, fileCount: input.catalog.entries.length },
    manifestPre: {
      exists: input.manifestInfo.exists,
      trusted: input.manifestInfo.trusted,
      sha256: input.manifestInfo.sha256
    },
    install: includeInstall
      ? { ops: input.installScan.ops, counts: input.installScan.counts }
      : { ops: [], counts: { create: 0, update: 0, adopt: 0, conflict: 0 } },
    legacy: {
      anchor: input.legacyScan.anchor,
      clean: includeClean ? input.legacyScan.clean : [],
      preserved: input.legacyScan.preserved,
      unknown: input.legacyScan.unknown,
      absentCount: input.legacyScan.absent.length,
      notes: input.legacyScan.notes
    },
    bundleValidations: input.bundle.validations,
    bundleSkipped: input.bundle.skipped,
    createdAt: F.nowIso().atLocal
  }
}

function planAuditFiles (payload) {
  const files = payload.install.ops.map(function (op) { return op.path })
    .concat(payload.legacy.clean.map(function (op) { return op.path }))
  if (payload.action !== 'clean-legacy') {
    files.push(MANIFEST_REL)
  }
  // workflow.createPlan 要求 files 非空；零操作时以 manifest 路径占位（真实存在）。
  if (!files.length) files.push(MANIFEST_REL)
  return files
}

// ---------------------------------------------------------------------------
// scan：纯只读预览（不写任何文件、不触审计）。
function scan (options) {
  const o = options || {}
  const rootReal = F.resolveRoot(o.projectRoot)
  const action = validateAction(o.action)
  const location = validateLocation(o.location)
  const bundle = loadBundle(o)
  const guard = writesRefused(rootReal)
  const manifestInfo = readManifest(rootReal)
  const catalog = loadCatalog({ catalogPath: path.join(bundle.root, 'manage-fb-skill', 'legacy', 'catalog.json') })
  const installScan = scanInstall(rootReal, bundle, location, manifestInfo)
  const legacyScan = scanLegacy(rootReal, catalog)
  return {
    ok: true,
    mode: 'scan',
    readOnly: true,
    action: action,
    projectRoot: toPosix(rootReal),
    location: location,
    bundle: { root: toPosix(bundle.root), source: bundle.source, files: bundle.skills.reduce(function (n, s) { return n + s.files.length }, 0) },
    catalog: { file: catalog.file, package: catalog.package, paths: catalog.entries.length },
    writesRefused: guard,
    counts: {
      install: installScan.counts,
      legacy: {
        cleanCandidates: legacyScan.clean.length,
        preserved: legacyScan.preserved.length,
        absent: legacyScan.absent.length,
        unknownExtra: legacyScan.unknown.length,
        anchorOk: legacyScan.anchor.ok
      }
    },
    installOps: installScan.ops,
    legacyClean: legacyScan.clean,
    legacyPreserved: legacyScan.preserved,
    legacyUnknown: legacyScan.unknown,
    notes: legacyScan.notes
  }
}

// ---------------------------------------------------------------------------
// plan：经 workflow.createPlan 落唯一 plan-vN.json（payload 在 metadata.installation）。
function createInstallPlan (options) {
  const o = options || {}
  const rootReal = F.resolveRoot(o.projectRoot)
  const id = F.assertSlug(F.safeSlug(o.id))
  const action = validateAction(o.action)
  const location = validateLocation(o.location)
  const bundle = loadBundle(o)
  const guard = writesRefused(rootReal)
  if (guard.refused) {
    throw new F.FbError('WRITES_REFUSED', '该项目只允许 scan，拒绝生成计划：' + guard.reasons.join('；'))
  }
  const manifestInfo = readManifest(rootReal)
  const catalog = loadCatalog({ catalogPath: path.join(bundle.root, 'manage-fb-skill', 'legacy', 'catalog.json') })
  const installScan = scanInstall(rootReal, bundle, location, manifestInfo)
  const legacyScan = scanLegacy(rootReal, catalog)
  const payload = buildPayload({ id: id, action: action, location: location, rootReal: rootReal, bundle: bundle, catalog: catalog, installScan: installScan, legacyScan: legacyScan, manifestInfo: manifestInfo })

  const summary = 'fb-skill ' + action + '：install create/' + payload.install.counts.create +
    ' update/' + payload.install.counts.update + ' adopt/' + payload.install.counts.adopt +
    ' conflict/' + payload.install.counts.conflict +
    '；legacy clean 候选 ' + payload.legacy.clean.length +
    '、保留(修改/未知/无锚) ' + (payload.legacy.preserved.length + payload.legacy.unknown.length) +
    '、锚 ' + (payload.legacy.anchor.ok ? '成立' : '不成立')
  const result = W.createPlan({
    projectRoot: rootReal,
    id: id,
    kind: action,
    summary: summary,
    files: planAuditFiles(payload),
    acceptance: acceptanceFor(payload),
    metadata: { installation: payload, ...(o.hostApproval ? { hostApproval: o.hostApproval } : {}) }
  })
  return {
    ok: true,
    mode: 'plan',
    id: result.id,
    revision: result.revision,
    hash: result.hash,
    planFile: toPosix(result.file),
    payload: payload,
    summary: summary,
    counts: {
      install: payload.install.counts,
      legacy: {
        cleanCandidates: payload.legacy.clean.length,
        preserved: payload.legacy.preserved.length,
        absent: payload.legacy.absentCount,
        unknownExtra: payload.legacy.unknown.length,
        anchorOk: payload.legacy.anchor.ok
      }
    },
    notes: [
      'plan 只通过 workflow.createPlan 写入唯一 plan-vN.json；执行需先按批准流程录入真实 approval 事件。',
      ...(payload.install.counts.conflict > 0 ? ['存在 conflict：apply 会整体拒绝 install，需先人工处置目标差异。'] : []),
      ...(manifestInfo.exists && !manifestInfo.trusted ? ['现有 install-manifest 不可信（' + manifestInfo.reason + '）：拒绝安装覆盖，需人工确认后删除或修正。'] : [])
    ]
  }
}

// ---------------------------------------------------------------------------
// apply 前置工具：先校验既有祖先（缺省即止），创建后全链 re-lstat（防 TOCTOU 换链）。
function ensureAncestorsForFile (rootReal, absFile) {
  const rel = path.relative(rootReal, absFile)
  const parts = rel.split(path.sep)
  const dirParts = parts.slice(0, -1)
  let probe = rootReal
  for (let i = 0; i < dirParts.length; i++) {
    probe = path.join(probe, dirParts[i])
    let st = null
    try {
      st = fs.lstatSync(probe)
    } catch (e) {
      break // 其余祖先尚不存在，交给 ensureDir
    }
    if (st.isSymbolicLink()) throw new F.FbError('SYMLINK_ESCAPE', '目标祖先是链接，拒绝写入：' + probe)
    if (!st.isDirectory()) throw new F.FbError('TARGET_PARENT_NOT_DIR', '目标祖先不是目录：' + probe)
  }
  F.ensureDir(path.dirname(absFile))
  // 创建后全链 re-lstat：ensureDir 期间被换成链接/文件立即拒绝。
  let probe2 = rootReal
  for (let i = 0; i < dirParts.length; i++) {
    probe2 = path.join(probe2, dirParts[i])
    const st = fs.lstatSync(probe2)
    if (st.isSymbolicLink()) throw new F.FbError('SYMLINK_ESCAPE', '目录创建后出现链接，拒绝写入：' + probe2)
    if (!st.isDirectory()) throw new F.FbError('TARGET_PARENT_NOT_DIR', '目录创建后不是目录：' + probe2)
  }
}

function writeNewFile (abs, buf) {
  let fd
  try {
    fd = fs.openSync(abs, 'wx')
  } catch (e) {
    if (e.code === 'EEXIST') throw new F.FbError('TARGET_CHANGED', '目标已存在（计划时不存在）：' + abs)
    throw e
  }
  try {
    fs.writeSync(fd, buf)
  } finally {
    fs.closeSync(fd)
  }
}

function replaceFile (abs, buf, expectedSha) {
  const tmp = path.join(path.dirname(abs), '.' + path.basename(abs) + '.fbinstall-' + crypto.randomBytes(6).toString('hex') + '.tmp')
  const fd = fs.openSync(tmp, 'wx')
  try {
    fs.writeSync(fd, buf)
  } finally {
    fs.closeSync(fd)
  }
  try {
    const tmpSha = sha256Buffer(fs.readFileSync(tmp))
    if (tmpSha !== expectedSha) throw new F.FbError('WRITE_VERIFY_FAILED', '临时文件哈希与来源不符：' + tmp)
    fs.renameSync(tmp, abs)
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch (e2) { /* 保留现场 */ }
    throw e
  }
}

// 备份任意现有文件到 workflows/<id>/backups/<relPath>（wx 独占 + 哈希校验）。
function backupFile (rootReal, id, relPath, expectedSha) {
  const abs = F.assertRelativeFileInRoot(rootReal, relPath).abs
  const cur = inspectFile(abs)
  if (cur.state !== 'file' || cur.sha256 !== expectedSha) {
    throw new F.FbError('TARGET_CHANGED', '备份目标与预期哈希不符：' + relPath)
  }
  const backupAbs = path.join(rootReal, WORKFLOWS_REL, id, 'backups', relPath.split('/').join(path.sep))
  ensureAncestorsForFile(rootReal, backupAbs)
  let fd
  try {
    fd = fs.openSync(backupAbs, 'wx')
  } catch (e) {
    if (e.code === 'EEXIST') throw new F.FbError('BACKUP_EXISTS', '备份已存在（先前执行过？），跳过以免覆盖：' + toPosix(backupAbs))
    throw e
  }
  try {
    fs.writeSync(fd, cur.buf)
  } finally {
    fs.closeSync(fd)
  }
  const backupSha = sha256Buffer(fs.readFileSync(backupAbs))
  if (backupSha !== expectedSha) {
    try { fs.unlinkSync(backupAbs) } catch (e2) { /* 保留现场 */ }
    throw new F.FbError('BACKUP_VERIFY_FAILED', '备份哈希校验失败，已删除备份：' + relPath)
  }
  return { abs: backupAbs, sha256: backupSha, bytes: cur.buf.length }
}

// apply 事件：implementation-start 必须落盘成功才允许写入（must-persist-before-write）。
function appendEventOrThrow (rootReal, id, type, actor, details) {
  return W.appendEvent({ projectRoot: rootReal, id: id, type: type, actor: actor === undefined ? null : actor, details: details || {} })
}

function appendEventRecorded (rootReal, id, type, actor, details) {
  // 完成类事件失败不吞：返回 {ok:false,...}，由调用方把 report.ok 置 false 并如实报告。
  try {
    const rec = W.appendEvent({ projectRoot: rootReal, id: id, type: type, actor: actor === undefined ? null : actor, details: details || {} })
    return { ok: true, seq: rec.seq, hash: rec.hash }
  } catch (e) {
    return { ok: false, code: e.code || 'ERROR', message: F.firstLine(e.message) }
  }
}

function actorOf (rootReal, id, plan) {
  // actor 只取审计链里与当前修订/计划哈希匹配的真实 approval 事件的操作人
  // （recordApproval 已校验 confirmed 身份）；绝不使用 OS 用户名 / Git / SVN 候选。
  const records = AUDIT.readAuditRecords(rootReal, id)
  for (const rec of (records.records || []).slice().reverse()) {
    if (rec.type !== 'approval' || !rec.details) continue
    if (rec.details.revision === plan.revision && rec.details.planHash === plan.hash) {
      return typeof rec.actor === 'string' ? rec.actor : null
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// apply：assertApproved → 锁内整份预验 → 备份/写入/清理 → 审计事件。非事务。
function applyPlan (options) {
  const o = options || {}
  const rootReal = F.resolveRoot(o.projectRoot)
  const id = F.assertSlug(F.safeSlug(o.id))
  const requestedAction = o.action === undefined || o.action === null || o.action === '' ? null : validateAction(o.action)

  return F.withLock(AUDIT.lockPath(rootReal, id), function () {
    const plan = W.assertApproved({ projectRoot: rootReal, id: id, kind: requestedAction || undefined })
    const payload = plan && plan.metadata && plan.metadata.installation
    if (!payload || typeof payload !== 'object' || payload.schemaVersion !== INSTALLER_SCHEMA || payload.tool !== 'fb-skill-installer') {
      throw new F.FbError('PLAN_PAYLOAD_INVALID', '计划 metadata.installation 缺失或不是本工具 payload（schema ' + INSTALLER_SCHEMA + '）')
    }
    if (requestedAction && requestedAction !== payload.action) {
      throw new F.FbError('ACTION_MISMATCH', '--action 与计划不符：计划 ' + payload.action + '，请求 ' + requestedAction)
    }
    if (payload.projectRoot !== toPosix(rootReal)) {
      throw new F.FbError('ROOT_MISMATCH', 'payload 绑定其他项目根：' + payload.projectRoot)
    }
    const location = validateLocation(payload.location)
    if (o.location !== undefined && o.location !== null && o.location !== '' && o.location !== location) {
      throw new F.FbError('LOCATION_MISMATCH', '--location 与计划不符：计划 ' + location + '，请求 ' + o.location)
    }
    if (!Array.isArray(plan.files)) throw new F.FbError('PLAN_FILES_INVALID', '计划 files 缺失')
    const planFiles = new Set(plan.files)

    // op path 双重防线：必须在计划 files 清单内 + 必须落在自己的根/形状里，
    // 外部手造的合法哈希 metadata 无法借 apply 删除/覆盖用户任意文件。
    for (const op of payload.install.ops || []) {
      assertInstallPathShape(location, op.path)
      if (!planFiles.has(op.path)) throw new F.FbError('OP_PATH_NOT_IN_PLAN', 'install op 不在计划 files 清单内：' + op.path)
    }
    for (const op of payload.legacy.clean || []) {
      assertLegacyPathShape(op.path)
      if (!planFiles.has(op.path)) throw new F.FbError('OP_PATH_NOT_IN_PLAN', 'legacy op 不在计划 files 清单内：' + op.path)
    }

    // ---- 整份预验（TOCTOU 第一层）：源 bundle、目标状态、manifest、锚与计划一致。
    const bundle = loadBundle({ skillSource: payload.bundle.root })
    if (toPosix(bundle.root) !== payload.bundle.root) {
      throw new F.FbError('SOURCE_RELOCATED', 'bundle 源已移动：计划 ' + payload.bundle.root + '，现 ' + toPosix(bundle.root))
    }
    const guard = writesRefused(rootReal)
    if (guard.refused) throw new F.FbError('WRITES_REFUSED', '执行前守卫拒绝：' + guard.reasons.join('；'))

    const drift = []
    if (payload.install.ops.length) {
      // key 统一为 bundle 内相对路径（<skill>/<rel>），与 op.path（<location>/…）剥前缀对齐。
      const bundleFiles = new Map()
      for (const skill of bundle.skills) {
        for (const file of skill.files) bundleFiles.set(file.rel, file.sha256)
      }
      const payloadFiles = new Map()
      for (const op of payload.install.ops) payloadFiles.set(op.path.slice(location.length + 1), op.sha256)
      if (bundleFiles.size !== payloadFiles.size) {
        drift.push('bundle 文件集变化：计划 ' + payloadFiles.size + ' 个，现 ' + bundleFiles.size + ' 个')
      }
      for (const [rel, sha] of payloadFiles) {
        if (bundleFiles.get(rel) !== sha) drift.push('源文件变化：' + rel)
      }
      const manifestNow = readManifest(rootReal)
      if (manifestNow.exists !== payload.manifestPre.exists ||
          manifestNow.trusted !== payload.manifestPre.trusted ||
          manifestNow.sha256 !== payload.manifestPre.sha256) {
        drift.push('install-manifest 在计划后变化（' + (manifestNow.reason || '内容哈希不符') + '）')
      }
      if (manifestNow.exists && !manifestNow.trusted) {
        drift.push('install-manifest 不可信，拒绝据其更新或覆盖：' + (manifestNow.reason || ''))
      }
      const freshInstall = scanInstall(rootReal, bundle, location, manifestNow)
      const freshByPath = new Map(freshInstall.ops.map(function (op) { return [op.path, op] }))
      for (const op of payload.install.ops) {
        const now = freshByPath.get(op.path)
        if (!now || now.op !== op.op || now.preSha256 !== op.preSha256) {
          drift.push('目标状态变化：' + op.path + '（计划 ' + op.op + '/' + (op.preSha256 || '-') + '，现 ' + (now ? now.op + '/' + (now.preSha256 || '-') : 'missing-op') + '）')
        }
      }
      if (payload.install.counts.conflict > 0) {
        drift.push('计划本身含 conflict ' + payload.install.counts.conflict + ' 个：install 拒绝全部写入')
      }
    }

    if (payload.legacy.clean.length) {
      const catalog = loadCatalog({ catalogPath: path.join(bundle.root, 'manage-fb-skill', 'legacy', 'catalog.json') })
      const freshLegacy = scanLegacy(rootReal, catalog)
      const freshClean = new Map(freshLegacy.clean.map(function (op) { return [op.path, op] }))
      if (!freshLegacy.anchor.ok && payload.legacy.anchor.ok) drift.push('强 bundle 锚在执行前不再成立')
      for (const op of payload.legacy.clean) {
        const now = freshClean.get(op.path)
        if (!now) { drift.push('清理候选不再是精确匹配：' + op.path); continue }
        if (now.preSha256 !== op.preSha256 || now.matchType !== op.matchType || now.variantSha256 !== op.variantSha256) {
          drift.push('清理候选状态变化：' + op.path)
        }
      }
      if (freshLegacy.clean.length !== payload.legacy.clean.length) {
        drift.push('清理候选数量变化：计划 ' + payload.legacy.clean.length + '，现 ' + freshLegacy.clean.length)
      }
    }

    const actor = actorOf(rootReal, id, plan)
    if (drift.length) {
      try {
        W.appendEvent({ projectRoot: rootReal, id: id, type: 'blocked', actor: actor, details: { reason: 'DRIFT', count: drift.length, first: drift.slice(0, 8), planRevision: plan.revision, planHash: plan.hash } })
      } catch (e) { /* blocked 记录失败也必须拒绝执行；错误随 DRIFT 一起暴露 */ }
      throw new F.FbError('DRIFT_DETECTED', '执行前预验发现变化，拒绝执行（重新 plan 后再走批准）：' + drift.slice(0, 5).join('；'))
    }

    // must-persist-before-write：implementation-start 追加失败即停止，不写任何目标文件。
    try {
      appendEventOrThrow(rootReal, id, 'implementation-start', actor, { revision: plan.revision, planHash: plan.hash, action: payload.action })
    } catch (e) {
      throw new F.FbError('AUDIT_APPEND_FAILED', 'implementation-start 事件追加失败，停止执行（不写目标文件）：' + F.firstLine(e.message))
    }

    const report = {
      ok: true,
      mode: 'apply',
      action: payload.action,
      projectRoot: toPosix(rootReal),
      location: location,
      plan: { id: id, revision: plan.revision, hash: plan.hash },
      actor: actor,
      install: { created: [], updated: [], adopted: [], failed: [], manifest: null, backups: [] },
      legacy: { removed: [], failed: [], preservedCount: payload.legacy.preserved.length, unknownCount: payload.legacy.unknown.length, absentCount: payload.legacy.absentCount, backupsDir: toPosix(path.join(rootReal, WORKFLOWS_REL, id, 'backups')) },
      notAtomic: true,
      audit: { implementationStart: true },
      notes: [
        '本过程不是事务：逐文件执行并记录；失败条目见 install.failed / legacy.failed（含备份路径与恢复说明）。',
        '强 bundle 锚成立才清理 generic/空指纹条目；被修改、未知、链接与硬文件一律保留。'
      ]
    }

    // ---- install 写入（逐文件 TOCTOU 复验；失败跳过该文件并记录，不中断其余）。
    if (payload.install.ops.length) {
      const bundleByRel = new Map()
      for (const skill of bundle.skills) {
        for (const file of skill.files) bundleByRel.set(file.rel, file)
      }
      for (const op of payload.install.ops) {
        const target = F.assertRelativeFileInRoot(rootReal, op.path).abs
        const rel = op.path.slice(location.length + 1)
        try {
          const cur = inspectFile(target)
          if (op.op === 'create') {
            if (cur.state !== 'missing') throw new F.FbError('TARGET_CHANGED', '目标状态已变化：' + op.path)
            ensureAncestorsForFile(rootReal, target)
            const source = bundleByRel.get(rel)
            if (!source) throw new F.FbError('SOURCE_MISSING', 'bundle 中找不到源文件：' + rel)
            const buf = fs.readFileSync(source.abs)
            if (sha256Buffer(buf) !== op.sha256) throw new F.FbError('SOURCE_CHANGED', '源文件哈希变化：' + rel)
            writeNewFile(target, buf)
            verifyWritten(target, op.sha256)
            report.install.created.push({ path: op.path, sha256: op.sha256 })
          } else if (op.op === 'update') {
            if (cur.state !== 'file' || cur.sha256 !== op.preSha256) throw new F.FbError('TARGET_CHANGED', '目标哈希与计划不符：' + op.path)
            const link = firstLinkAncestor(rootReal, target)
            if (link) throw new F.FbError('SYMLINK_ESCAPE', '目标祖先是链接：' + link)
            const backup = backupFile(rootReal, id, op.path, op.preSha256)
            report.install.backups.push({ path: op.path, backup: toPosix(backup.abs), backupSha256: backup.sha256 })
            const source = bundleByRel.get(rel)
            if (!source) throw new F.FbError('SOURCE_MISSING', 'bundle 中找不到源文件：' + rel)
            const buf = fs.readFileSync(source.abs)
            if (sha256Buffer(buf) !== op.sha256) throw new F.FbError('SOURCE_CHANGED', '源文件哈希变化：' + rel)
            replaceFile(target, buf, op.sha256)
            verifyWritten(target, op.sha256)
            report.install.updated.push({ path: op.path, sha256: op.sha256, preSha256: op.preSha256, backup: toPosix(backup.abs) })
          } else if (op.op === 'adopt') {
            if (cur.state !== 'file' || cur.sha256 !== op.sha256) throw new F.FbError('TARGET_CHANGED', 'adopt 目标哈希已变化：' + op.path)
            report.install.adopted.push({ path: op.path, sha256: op.sha256 })
          } else {
            throw new F.FbError('OP_UNKNOWN', '未知 install op：' + op.op)
          }
        } catch (e) {
          report.install.failed.push({
            path: op.path,
            op: op.op,
            code: e.code || 'ERROR',
            message: F.firstLine(e.message),
            recovery: '文件保持执行前状态或已备份；重跑 scan 确认后重新 plan/apply'
          })
        }
      }

      // manifest 合并先前受管条目；来源版本已随 bundle.json 分发，不额外写元数据。
      const manifestOps = report.install.adopted.concat(report.install.created).concat(report.install.updated)
      const manifestFiles = {}
      const prev = readManifest(rootReal)
      let carriedOver = 0
      if (prev.trusted && prev.manifest && prev.manifest.files) {
        for (const [key, sha] of Object.entries(prev.manifest.files)) {
          manifestFiles[key] = sha
          carriedOver++
        }
      }
      for (const item of manifestOps) manifestFiles[item.path] = item.sha256
      try {
        if (prev.exists !== payload.manifestPre.exists || prev.trusted !== payload.manifestPre.trusted || prev.sha256 !== payload.manifestPre.sha256) throw new F.FbError('TARGET_CHANGED', 'manifest 在写入前变化，拒绝覆盖')
        const manifestBody = {
          schemaVersion: INSTALLER_SCHEMA,
          installedAt: F.nowIso().atLocal,
          root: toPosix(rootReal),
          location: location,
          source: bundle.source,
          files: manifestFiles
        }
        const manifestAbs = F.assertRelativeFileInRoot(rootReal, MANIFEST_REL).abs
        ensureAncestorsForFile(rootReal, manifestAbs)
        F.writeJsonAtomic(manifestAbs, manifestBody)
        const written = inspectFile(manifestAbs)
        if (written.state !== 'file') throw new F.FbError('WRITE_VERIFY_FAILED', 'manifest 不是常规文件')
        report.install.manifest = { path: MANIFEST_REL, sha256: written.sha256, fileCount: Object.keys(manifestFiles).length, carriedOver: carriedOver }
      } catch (e) {
        report.install.failed.push({
          path: MANIFEST_REL,
          op: 'manifest',
          code: e.code || 'ERROR',
          message: e.message,
          recovery: 'manifest/元数据未完整更新；下次安装按现有 manifest 语义重估，请人工核对后重试'
        })
      }
    }

    // ---- legacy 清理：备份（wx 独占）→ unlink 前二次复验（TOCTOU）→ unlink；失败逐条记录。
    if (payload.legacy.clean.length) {
      for (const op of payload.legacy.clean) {
        const abs = F.assertRelativeFileInRoot(rootReal, op.path).abs
        try {
          const cur = inspectFile(abs)
          if (cur.state !== 'file' || cur.sha256 !== op.preSha256) {
            throw new F.FbError('TARGET_CHANGED', '清理目标已变化，跳过：' + op.path)
          }
          if (cur.nlink && cur.nlink > 1) {
            throw new F.FbError('HARDLINK_REFUSED', '目标为硬链接（nlink>1），拒绝删除：' + op.path)
          }
          const backup = backupFile(rootReal, id, op.path, op.preSha256)
          report.legacy.removed.push({ path: op.path, preSha256: op.preSha256, backup: toPosix(backup.abs), backupSha256: backup.sha256 })
          // 备份后二次复验（备份期间文件可能被换）：祖先链接 / 类型 / 哈希全部重验再 unlink。
          const link = firstLinkAncestor(rootReal, abs)
          if (link) throw new F.FbError('SYMLINK_ESCAPE', 'unlink 前发现祖先链接：' + link)
          const again = inspectFile(abs)
          if (again.state !== 'file' || again.sha256 !== op.preSha256) {
            throw new F.FbError('TARGET_CHANGED', 'unlink 前二次复验失败：' + op.path)
          }
          fs.unlinkSync(abs)
          let gone = false
          try {
            fs.lstatSync(abs)
          } catch (e) {
            gone = e.code === 'ENOENT'
          }
          if (!gone) throw new F.FbError('UNLINK_VERIFY_FAILED', 'unlink 后目标仍存在：' + op.path)
          report.legacy.removed[report.legacy.removed.length - 1].recovery = '如需恢复：将备份文件复制回原路径 ' + op.path
        } catch (e) {
          report.legacy.failed.push({ path: op.path, code: e.code || 'ERROR', message: F.firstLine(e.message), kept: true, recovery: '文件保留原样；处置后重跑 plan/apply' })
          // 失败时把预push的 removed 条目回退，避免虚报已删除。
          const idx = report.legacy.removed.findIndex(function (item) { return item.path === op.path })
          if (idx !== -1) report.legacy.removed.splice(idx, 1)
        }
      }
    }

    // ---- 复验（verification）：重扫 install 目标应全部为 adopt。
    let verification = null
    if (payload.install.ops.length) {
      const manifestInfo = readManifest(rootReal)
      const fresh = scanInstall(rootReal, bundle, location, manifestInfo)
      verification = {
        counts: fresh.counts,
        ok: fresh.counts.conflict === 0 && fresh.counts.create === 0 && fresh.counts.update === 0
      }
    }

    // 完成类事件失败不吞：ok 置 false（CLI 退 1），但如实返回已发生的报告。
    const complete = appendEventRecorded(rootReal, id, 'implementation-complete', actor, {
      revision: plan.revision,
      planHash: plan.hash,
      install: { created: report.install.created.length, updated: report.install.updated.length, adopted: report.install.adopted.length, failed: report.install.failed.length, manifest: report.install.manifest && report.install.manifest.fileCount },
      legacy: { removed: report.legacy.removed.length, failed: report.legacy.failed.length },
      verification: verification
    })
    report.audit.implementationComplete = complete
    if (!complete.ok) report.notes.push('implementation-complete 事件追加失败：' + complete.message + '；执行结果不能视为通过')
    if (verification && !verification.ok) {
      const v = appendEventRecorded(rootReal, id, 'verification', actor, { ok: false, counts: verification.counts, note: '安装后复验仍有未就位文件，见报告' })
      if (!v.ok) report.notes.push('verification 事件追加失败：' + v.message)
    }

    // ok 由失败/复验/审计共同决定；局部失败绝不冒充通过。
    report.verification = verification
    report.ok = report.install.failed.length === 0 &&
      report.legacy.failed.length === 0 &&
      (!verification || verification.ok) &&
      complete.ok
    if (!report.ok) {
      const blocked = appendEventRecorded(rootReal, id, 'blocked', actor, { revision: plan.revision, planHash: plan.hash, reason: 'PARTIAL_FAILURE', installFailures: report.install.failed.length, legacyFailures: report.legacy.failed.length })
      report.audit.blocked = blocked
      if (!blocked.ok) report.notes.push('blocked 事件追加失败：' + blocked.message)
    }
    return report
  })
}

function verifyWritten (abs, expectedSha) {
  const cur = inspectFile(abs)
  if (cur.state !== 'file' || cur.sha256 !== expectedSha) {
    throw new F.FbError('WRITE_VERIFY_FAILED', '写入后哈希与来源不符：' + abs)
  }
}

module.exports = {
  INSTALLER_SCHEMA: INSTALLER_SCHEMA,
  ACTIONS: ACTIONS,
  LOCATIONS: LOCATIONS,
  MANIFEST_REL: MANIFEST_REL,
  WORKFLOWS_REL: WORKFLOWS_REL,
  ANCHOR_MIN_EXCLUSIVE: ANCHOR_MIN_EXCLUSIVE,
  LEGACY_TARGET_DIRS: LEGACY_TARGET_DIRS,
  resolveBundleRoot: resolveBundleRoot,
  loadBundle: loadBundle,
  loadCatalog: loadCatalog,
  readManifest: readManifest,
  scanInstall: scanInstall,
  scanLegacy: scanLegacy,
  writesRefused: writesRefused,
  scan: scan,
  createInstallPlan: createInstallPlan,
  applyPlan: applyPlan,
  ensureAncestorsForFile: ensureAncestorsForFile,
  assertInstallPathShape: assertInstallPathShape,
  assertLegacyPathShape: assertLegacyPathShape,
  toPosix: toPosix,
  sha256Buffer: sha256Buffer,
  canonicalLfSha256: canonicalLfSha256
}
