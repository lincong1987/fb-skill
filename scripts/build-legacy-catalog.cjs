#!/usr/bin/env node
'use strict'

// build-legacy-catalog.cjs — 只读采集旧 fb-rules@1.0.13 两个实存副本的精确文件指纹，
// 生成 skills/manage-fb-skill/legacy/catalog.json。
//
// 边界：
//   * 只读采集，绝不修改两个源副本；只写 catalog.json 一个文件。
//   * catalog 只记录 paths/hash/size，不打包规则原文（不把旧规则全集注入模型）。
//   * 哈希是字节级 contentSha256；另记 canonicalLfSha256 仅用于吸收 autocrlf 造成的
//     CRLF/LF 差异，不做任何其他文本归一化（不去 BOM、不去尾空白）。
//   * 两个副本同版本但内容不同 → 同一 path 记录多个 variants（带 provenance source id）。
//   * 空 .cursor/.amazonq 目录记录为 notes，不产生指纹条目（无文件可清）。
//   * 分类（kind）：
//       exclusive —— fb-rules 包独占发布的规则/配置子目录，精确哈希命中即可清理候选；
//       anchor    —— .lingma/index.json，fb-rules 安装元数据（含 version），命中即为强锚；
//       generic   —— 工具通用文件（.comate/mcp.json、.calude/settings.json、
//                    .calude/CLAUDE.md、.fb/README.md 等），须强 bundle 锚 +
//                    精确 .lingma/index 或包安装元数据才成为清理候选，否则保留。
//       空文件（bytes===0）一律要求锚：空文件哈希无区分度。
//
// 用法：node scripts/build-legacy-catalog.cjs [--out <catalog.json>]

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const F = require('../skills/create-fb-feature/scripts/lib/files.cjs')

const PACKAGE_NAME = 'fb-rules'
const PACKAGE_VERSION = '1.0.13'

// 两个实存副本（只读）。顺序固定，保证 catalog 可复现。
const SOURCES = [
  { id: 'fb-rules-repo', root: 'D:/projects/fb-rules/packages/fb-rules' },
  { id: 'topinfo-fb-rules-copy', root: 'D:/projects/topinfo/fb-rules/packages/fb-rules' }
]

// 采集目标：fb-rules 包 files 声明分发的工具目录；.cursor/.amazonq 为空目录仅记 note。
const TARGET_DIRS = ['.fb', '.lingma', '.qoder', '.trae', '.codebuddy', '.comate', '.calude', '.gemini', '.iflow', '.agent', '.cursor', '.amazonq']

const EXCLUSIVE_PREFIXES = [
  '.fb/rules/', '.fb/agents/', '.fb/lsp/', '.fb/mcp/', '.fb/prompt/', '.fb/skills/',
  '.lingma/rules/', '.qoder/rules/', '.trae/rules/', '.trae/skills/',
  '.codebuddy/', '.comate/rules/', '.gemini/antigravity/rules/', '.iflow/rules/',
  '.agent/', '.calude/rules/', '.calude/skills/'
]

const ANCHOR_PATHS = new Set(['.lingma/index.json'])

function toPosix (p) {
  return p.split(path.sep).join('/')
}

function sha256Buffer (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

// 仅 CRLF→LF 归一（autocrlf 场景）；不做其他任何文本改写。
function canonicalLfSha256 (buf) {
  const normalized = Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')
  return sha256Buffer(normalized)
}

function classify (rel) {
  if (ANCHOR_PATHS.has(rel)) return 'anchor'
  for (const prefix of EXCLUSIVE_PREFIXES) {
    if (rel.startsWith(prefix)) return 'exclusive'
  }
  return 'generic'
}

// 收集一个源副本下某目录树中的常规文件；拒绝 symlink/junction 与非常规类型。
function collectFiles (sourceRoot, dirName, notes) {
  const base = path.join(sourceRoot, dirName)
  const out = []
  let exists = false
  try {
    const st = fs.lstatSync(base)
    if (st.isSymbolicLink()) throw new F.FbError('SOURCE_LINK', '源目录是链接，拒绝采集：' + base)
    exists = st.isDirectory()
  } catch (e) {
    if (e.code === 'ENOENT') {
      notes.push({ source: sourceRoot, path: dirName, note: 'directory absent in this copy' })
      return out
    }
    throw e
  }
  if (!exists) {
    notes.push({ source: sourceRoot, path: dirName, note: 'not a directory in this copy' })
    return out
  }
  const stack = [base]
  while (stack.length) {
    const dir = stack.pop()
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort(function (a, b) { return a.name.localeCompare(b.name) })) {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        notes.push({ source: sourceRoot, path: toPosix(path.relative(sourceRoot, full)), note: 'skipped link' })
        continue
      }
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile()) {
        notes.push({ source: sourceRoot, path: toPosix(path.relative(sourceRoot, full)), note: 'skipped non-regular file' })
        continue
      }
      out.push({
        rel: toPosix(path.relative(sourceRoot, full)).split('/').join('/'),
        abs: full
      })
    }
  }
  return out
}

function readPackageMeta (sourceRoot) {
  const file = path.join(sourceRoot, 'package.json')
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (e) {
    throw new F.FbError('SOURCE_INVALID', '源副本缺 package.json：' + sourceRoot)
  }
  let pkg
  try {
    pkg = JSON.parse(raw)
  } catch (e) {
    throw new F.FbError('SOURCE_INVALID', '源副本 package.json 无法解析：' + sourceRoot)
  }
  if (pkg.name !== PACKAGE_NAME || pkg.version !== PACKAGE_VERSION) {
    throw new F.FbError('SOURCE_INVALID', '源副本不是 ' + PACKAGE_NAME + '@' + PACKAGE_VERSION + '（实得 ' + pkg.name + '@' + pkg.version + '）：' + sourceRoot)
  }
  return { name: pkg.name, version: pkg.version }
}

function buildCatalog (options) {
  const o = options || {}
  const sources = o.sources || SOURCES
  const targetDirs = o.targetDirs || TARGET_DIRS
  const notes = []
  const perSource = []

  for (const source of sources) {
    const rootReal = fs.realpathSync(path.resolve(source.root))
    const meta = readPackageMeta(rootReal)
    const files = {}
    let count = 0
    for (const dirName of targetDirs) {
      for (const item of collectFiles(rootReal, dirName, notes)) {
        const buf = fs.readFileSync(item.abs)
        files[item.rel] = {
          bytes: buf.length,
          contentSha256: sha256Buffer(buf),
          canonicalLfSha256: canonicalLfSha256(buf)
        }
        count++
      }
    }
    perSource.push({ id: source.id, root: toPosix(rootReal), meta: meta, files: files, fileCount: count })
  }

  // 汇总所有源的路径并集，逐路径合并变体。
  const allPaths = new Set()
  for (const s of perSource) {
    for (const rel of Object.keys(s.files)) allPaths.add(rel)
  }
  const files = []
  for (const rel of Array.from(allPaths).sort()) {
    // 同一 path 下字节完全一致的来源合并为一个 variant（sources 列出 provenance）。
    const merged = []
    for (const s of perSource) {
      const f = s.files[rel]
      if (!f) continue
      const hit = merged.find(function (v) {
        return v.bytes === f.bytes && v.contentSha256 === f.contentSha256 && v.canonicalLfSha256 === f.canonicalLfSha256
      })
      if (hit) hit.sources.push(s.id)
      else merged.push({ sources: [s.id], bytes: f.bytes, contentSha256: f.contentSha256, canonicalLfSha256: f.canonicalLfSha256 })
    }
    const kind = classify(rel)
    files.push({
      path: rel,
      kind: kind,
      // 空文件哈希无区分度，无论目录归属一律要求强锚（如 .calude/CLAUDE.md、PROJECT 空规则）。
      empty: merged.every(function (v) { return v.bytes === 0 }),
      requiresAnchor: kind === 'generic' || merged.every(function (v) { return v.bytes === 0 }),
      variants: merged
    })
  }

  const emptyDirs = []
  for (const s of perSource) {
    for (const dirName of targetDirs) {
      const base = path.join(s.root, dirName)
      let st
      try { st = fs.lstatSync(base) } catch (e) { continue }
      if (!st.isDirectory() || st.isSymbolicLink()) continue
      let hasContent = false
      const stack = [base]
      while (stack.length && !hasContent) {
        const dir = stack.pop()
        let entries
        try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { continue }
        for (const entry of entries) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) stack.push(full)
          else if (entry.isFile()) { hasContent = true; break }
        }
      }
      if (!hasContent) emptyDirs.push({ source: s.id, path: dirName })
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: F.nowIso().at,
    generator: 'fb-skill/scripts/build-legacy-catalog.cjs',
    package: { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    sources: perSource.map(function (s) {
      return { id: s.id, root: s.root, name: s.meta.name, version: s.meta.version, fileCount: s.fileCount }
    }),
    emptyDirs: emptyDirs,
    matching: {
      rule: 'target file matches a variant when contentSha256 equals the variant sha256 (byte-exact) or when canonicalLfSha256 equals (CRLF/LF-only difference under autocrlf); no other normalization',
      anchorRule: 'kind=generic or empty files are cleanup candidates only when strong bundle anchor holds: exact .lingma/index.json match (fb-rules install metadata) or >= ' + 8 + ' exact exclusive-file matches',
      anchorMinExclusiveMatches: 8
    },
    notes: notes,
    files: files
  }
}

function main () {
  const argv = process.argv.slice(2)
  let out = path.join(__dirname, '..', 'skills', 'manage-fb-skill', 'legacy', 'catalog.json')
  if (argv.length === 2 && argv[0] === '--out') out = path.resolve(argv[1])
  else if (argv.length !== 0) throw new F.FbError('BAD_USAGE', '用法：node scripts/build-legacy-catalog.cjs [--out <catalog.json>]')

  const catalog = buildCatalog({})
  const kinds = {}
  for (const f of catalog.files) kinds[f.kind] = (kinds[f.kind] || 0) + 1
  const variantCount = catalog.files.reduce(function (n, f) { return n + f.variants.length }, 0)
  const multiVariant = catalog.files.filter(function (f) { return f.variants.length > 1 }).length

  F.ensureDir(path.dirname(out))
  F.writeJsonAtomic(out, catalog)
  process.stdout.write(JSON.stringify({
    ok: true,
    out: toPosix(out),
    sources: catalog.sources,
    fileCount: catalog.files.length,
    kinds: kinds,
    variantCount: variantCount,
    multiVariantPaths: multiVariant,
    emptyDirs: catalog.emptyDirs
  }, null, 2) + '\n')
}

if (require.main === module) main()

module.exports = { buildCatalog, classify, TARGET_DIRS, EXCLUSIVE_PREFIXES, ANCHOR_PATHS }
