/**
 * reverse-requirements fixture 的独立构建主入口（CLI + runBuild API，async）。
 *
 * 用法（全部参数显式，无自动批准通道）：
 *   node tests/fixtures/reverse-requirements/build.cjs --project-root <dir> --id <slug> --round first|repaired
 *
 * 流程（fail-closed，任何拒绝都不产出）：
 * 1. E.checkGeneration({projectRoot,id,round,stage:'build'})——E 接口缺失/未就绪即拒绝；
 * 2. 校验冻结 source-manifest.json：hash 自洽、与 checkGeneration 哈希一致、每个文件
 *    在本轮 workspace 内真实存在且 sha256/bytes 匹配（无链接、无穿越）；
 * 3. dist/build-report.json/build.log 已存在或 dist 非空即拒绝（同 round 不可覆盖，
 *    最终由 wx 独占写兜底）；锁内追加本轮 build claim，编译期间也拒绝第二个构建；
 * 4. 目标 webpack（Node API）按 webpack.config.cjs 的 createConfig 编译；webpack4 回调
 *    异步完成，runBuild 拆为 锁内准备 → await 编译 → 锁内复核与写产物 三段；
 *    成功后 dist 只允许出现 app.js（多余产物=失败），再 wx 写入 fixture 自有 index.html；
 * 5. build.log 与 build-report.json 均 wx 独占、一次写入：报告含 manifest/plan/input/scope
 *    哈希、实际依赖版本、assets bytes+sha256、errors/warnings、真实时间与自洽 hash。
 *    编译失败也保存真实失败报告（非 0 退出、ok:false），保留现场，绝不假绿或覆盖。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const F = require('../../../skills/create-fb-feature/scripts/lib/files.cjs')
const W = require('../../../skills/create-fb-feature/scripts/workflow.cjs')
const A = require('../../../skills/create-fb-feature/scripts/lib/audit.cjs')

const E = require('../../../scripts/eval-reverse-requirements.cjs')

const ROUNDS = ['first', 'repaired']
const ASSET_ALLOWLIST = ['app.js'] // webpack 允许产出的文件；index.html 由本入口最后写入

function buildError(code, message, details) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

function isDirectory(dir) {
  return typeof dir === 'string' && path.isAbsolute(dir) && fs.existsSync(dir) && fs.statSync(dir).isDirectory()
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function listFilesRecursive(dir) {
  const found = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    F.assertNoLinks(full)
    const stat = fs.lstatSync(full)
    if (stat.isDirectory()) found.push(...listFilesRecursive(full))
    else if (stat.isFile()) found.push(full)
    else throw buildError('UNSAFE_ASSET', '构建产物不是普通文件：' + full)
  }
  return found
}

function scanAssets(dist) {
  return listFilesRecursive(dist).map(file => {
    const content = fs.readFileSync(file)
    return {
      path: path.relative(dist, file).split(path.sep).join('/'),
      bytes: content.length,
      sha256: sha256(content)
    }
  }).sort((a, b) => a.path < b.path ? -1 : 1)
}

// 冻结清单格式（freezeGeneration）：files[].path 为相对项目根的 / 分隔路径，
// 全部必须落在该 round 的 workspace 内（精确 workspace 快照由 E 的 freeze 保证）。
function verifyFrozenManifest(root, ctx, checked) {
  const manifestFile = ctx.sourceManifest
  if (typeof manifestFile !== 'string' || !fs.existsSync(manifestFile)) {
    throw buildError('MANIFEST_MISSING', '冻结清单不存在：' + manifestFile)
  }
  F.assertNoLinks(manifestFile)
  const manifest = F.readJson(manifestFile).value
  if (!manifest || manifest.hash !== F.hashObject(F.withoutHash(manifest))) {
    throw buildError('MANIFEST_CORRUPT', '冻结清单 hash 自洽性校验失败：' + manifestFile)
  }
  if (checked.inputHash !== undefined && manifest.inputHash !== checked.inputHash) throw buildError('MANIFEST_MISMATCH', '清单 inputHash 与 checkGeneration 不一致')
  if (checked.planHash !== undefined && manifest.planHash !== checked.planHash) throw buildError('MANIFEST_MISMATCH', '清单 planHash 与 checkGeneration 不一致')
  if (checked.scopeHash !== undefined && manifest.scopeHash !== checked.scopeHash) throw buildError('MANIFEST_MISMATCH', '清单 scopeHash 与 checkGeneration 不一致')
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw buildError('MANIFEST_CORRUPT', '清单缺少 files 数组')

  const rootReal = fs.realpathSync(root)
  const workspaceReal = fs.realpathSync(ctx.workspace)
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== 'string' || path.isAbsolute(entry.path) || entry.path.includes('\\')) {
      throw buildError('MANIFEST_CORRUPT', '清单文件路径非法：' + JSON.stringify(entry))
    }
    const file = path.join(rootReal, ...entry.path.split('/'))
    if (!file.startsWith(workspaceReal + path.sep)) throw buildError('MANIFEST_TRAVERSAL', '清单文件不在本轮工作区内：' + entry.path)
    if (!fs.existsSync(file)) throw buildError('MANIFEST_FILE_MISSING', '清单文件缺失：' + entry.path)
    F.assertNoLinks(file)
    const content = fs.readFileSync(file)
    if (content.length !== entry.bytes || sha256(content) !== entry.sha256) {
      throw buildError('MANIFEST_HASH_MISMATCH', '清单文件内容与冻结时不一致：' + entry.path)
    }
  }
  return manifest
}

function assertNoPreExistingArtifacts(ctx) {
  if (fs.existsSync(ctx.buildReport)) throw buildError('BUILD_OUTPUT_EXISTS', '同 round 构建报告已存在，不可覆盖：' + ctx.buildReport)
  if (fs.existsSync(ctx.buildLog)) throw buildError('BUILD_OUTPUT_EXISTS', '同 round 构建日志已存在，不可覆盖：' + ctx.buildLog)
  if (fs.existsSync(ctx.output)) {
    if (!fs.statSync(ctx.output).isDirectory()) throw buildError('BUILD_OUTPUT_EXISTS', 'dist 位置不是目录：' + ctx.output)
    if (fs.readdirSync(ctx.output).length) throw buildError('BUILD_OUTPUT_EXISTS', 'dist 已存在且非空，拒绝覆盖：' + ctx.output)
  }
}

function writeBuildArtifacts(ctx, report, logText) {
  try {
    F.writeTextExclusive(ctx.buildLog, logText)
    F.writeJsonImmutable(ctx.buildReport, report)
    if (F.readText(ctx.buildLog).raw !== logText || F.readText(ctx.buildReport).raw !== JSON.stringify(report, null, 2) + '\n') throw buildError('BUILD_INCOMPLETE', '构建日志或报告写入不完整')
  } catch (error) {
    const retained = [ctx.buildLog, ctx.buildReport].filter(file => fs.existsSync(file))
    throw buildError('BUILD_WRITE_FAILED', '构建产物写入失败；已写文件保留，禁止覆盖：' + error.message, { retainedPaths: retained })
  }
}

async function runBuild(options) {
  const o = options || {}
  const { projectRoot, id, round } = o
  if (!isDirectory(projectRoot)) throw buildError('PROJECT_ROOT_INVALID', 'projectRoot 必须是已存在的绝对路径目录：' + projectRoot)
  if (!ROUNDS.includes(round)) throw buildError('BAD_ROUND', 'round 必须是 first 或 repaired：' + round)
  if (typeof id !== 'string' || !id) throw buildError('BAD_ID', '缺少 id')
  if (typeof E.checkGeneration !== 'function') {
    throw buildError('E_INTERFACE_MISSING', 'eval-reverse-requirements.cjs 尚未实现 checkGeneration：独立构建拒绝执行（fail-closed）')
  }

  // —— 第一段（工作流锁内）：E 就绪核验 + 冻结清单核验 + 配置工厂 ——
  const root = F.resolveRoot(projectRoot)
  const checked = E.checkGeneration({ projectRoot, id, round, stage: 'build' })
  if (!checked || checked.ok !== true || checked.ready !== true) {
    throw buildError('BUILD_NOT_READY', '生成未批准或未冻结，构建拒绝执行', checked ? checked.blockers : undefined)
  }
  const ctx = checked.context
  E.assertGenerationTools(ctx, __dirname)
  for (const key of ['workspace', 'output', 'buildReport', 'buildLog', 'sourceManifest', 'dependencyRoot']) {
    if (typeof ctx[key] !== 'string' || !path.isAbsolute(ctx[key])) throw buildError('E_CONTEXT_INVALID', 'E.context 缺少绝对路径字段：' + key)
  }
  if (!ctx.expectedVersions || typeof ctx.expectedVersions !== 'object') throw buildError('E_CONTEXT_INVALID', 'E.context 缺少 expectedVersions')

  const prepared = F.withLock(path.join(root, '.agents/fb-feature/workflows', id, '.lock'), () => {
    const current = E.checkGeneration({ projectRoot: root, id, round, stage: 'build' })
    if (!current.ready || current.planHash !== checked.planHash || current.scopeHash !== checked.scopeHash) throw buildError('BUILD_NOT_READY', '构建前输入、工具或方案发生变化', current.blockers)
    assertNoPreExistingArtifacts(ctx)
    const events = A.readAuditRecords(root, id).records
    if (events.some(event => event.details && event.details.action === 'generation-build-claimed' && event.details.round === round)) throw buildError('BUILD_OUTPUT_EXISTS', '本轮构建已经开始；不得并发或重跑覆盖')
    const manifest = verifyFrozenManifest(root, ctx, checked)
    const createConfigModule = require('./webpack.config.cjs')
    const factory = createConfigModule.createConfig({
      workspace: ctx.workspace,
      output: ctx.output,
      dependencyRoot: ctx.dependencyRoot,
      expectedVersions: ctx.expectedVersions
    })
    const claim = W.appendEvent({ projectRoot: root, id, type: 'note', actor: 'fb-skill-isolated-builder', details: { action: 'generation-build-claimed', round, planHash: checked.planHash, inputHash: checked.inputHash, scopeHash: checked.scopeHash } })
    return { manifest, factory, claimHash: claim.hash }
  })

  // —— 第二段（锁外）：目标 webpack Node API 编译（回调异步完成，必须等待） ——
  const startedAt = F.nowIso().atLocal
  const startedMs = Date.now()
  const webpackModule = require(prepared.factory.toolchain.resolved.webpack)
  let compileFatal = null
  let stats = null
  await new Promise(resolve => {
    try {
      webpackModule(prepared.factory.config, (error, result) => { compileFatal = error; stats = result; resolve() })
    } catch (error) {
      compileFatal = error
      resolve()
    }
  })

  // —— 第三段（工作流锁内）：产物核验 + wx 写日志/报告（不可覆盖） ——
  return F.withLock(path.join(root, '.agents/fb-feature/workflows', id, '.lock'), () => {
    const statsJson = stats ? stats.toJson({ all: false, errors: true, warnings: true }) : { errors: [], warnings: [] }
    const errors = [].concat(
      compileFatal ? [String(compileFatal.stack || compileFatal.message)] : [],
      (statsJson.errors || []).map(entry => typeof entry === 'string' ? entry : String((entry && entry.message) || JSON.stringify(entry)))
    )
    const warnings = (statsJson.warnings || []).map(entry => typeof entry === 'string' ? entry : String((entry && entry.message) || JSON.stringify(entry)))
    const current = E.checkGeneration({ projectRoot: root, id, round, stage: 'build' })
    if (!current.ready || current.planHash !== checked.planHash || current.inputHash !== checked.inputHash || current.scopeHash !== checked.scopeHash) errors.push('GENERATION_CHANGED: ' + JSON.stringify(current.blockers))

    if (!fs.existsSync(ctx.output)) F.ensureDir(ctx.output)
    let assets = scanAssets(ctx.output)
    let status = 'success'
    let exitCode = 0
    if (compileFatal || !stats || stats.hasErrors() || errors.length) {
      status = 'fail'
      exitCode = 1
    } else {
      const unexpected = assets.map(asset => asset.path).filter(name => !ASSET_ALLOWLIST.includes(name))
      if (unexpected.length) {
        status = 'fail'
        exitCode = 1
        errors.push('DIST_EXTRA_ASSETS: ' + unexpected.join(', '))
      } else {
        // 唯一允许的第二产物：fixture 自有 index.html（wx 独占；不加载 CDN / 真实 HTTP）
        const fixtureHtml = path.join(__dirname, 'index.html')
        F.assertNoLinks(fixtureHtml)
        const html = fs.readFileSync(fixtureHtml, 'utf8')
        F.writeTextExclusive(path.join(ctx.output, 'index.html'), html)
        assets = scanAssets(ctx.output)
      }
    }
    const finishedAt = F.nowIso().atLocal
    const durationMs = Date.now() - startedMs

    const report = {
      schemaVersion: 1,
      nature: 'isolated-fixture-build-not-production-acceptance',
      id,
      round,
      dist: ctx.output,
      dependencyRoot: ctx.dependencyRoot,
      sourceManifestHash: prepared.manifest.hash,
      inputHash: prepared.manifest.inputHash,
      planHash: prepared.manifest.planHash,
      scopeHash: prepared.manifest.scopeHash,
      dependencies: prepared.factory.toolchain.versions,
      expectedVersions: ctx.expectedVersions,
      assets,
      errors,
      warnings,
      status,
      exitCode,
      startedAt,
      finishedAt,
      durationMs
    }
    report.hash = F.hashObject(F.withoutHash(report))
    const logLines = [
      '# reverse-requirements fixture build log',
      `round=${round} id=${id} status=${status} exitCode=${exitCode}`,
      `sourceManifestHash=${prepared.manifest.hash} inputHash=${prepared.manifest.inputHash} planHash=${prepared.manifest.planHash} scopeHash=${prepared.manifest.scopeHash}`,
      stats ? String(stats.toString({ colors: false, all: false, errors: true, warnings: true, timings: true })) : (compileFatal ? String(compileFatal.stack || compileFatal.message) : 'no webpack stats'),
      `assets=${JSON.stringify(assets)}`,
      `durationMs=${durationMs}`
    ]
    const logText = logLines.join('\n') + '\n'
    report.logSha256 = sha256(Buffer.from(logText))
    report.hash = F.hashObject(F.withoutHash(report))
    try {
      writeBuildArtifacts(ctx, report, logText)
      W.appendEvent({ projectRoot: root, id, type: status === 'success' ? 'note' : 'blocked', actor: 'fb-skill-isolated-builder', details: { action: 'generation-build-finished', round, planHash: checked.planHash, inputHash: checked.inputHash, scopeHash: checked.scopeHash, claimHash: prepared.claimHash, reportHash: report.hash, status, exitCode } })
    } catch (error) {
      try { W.appendEvent({ projectRoot: root, id, type: 'blocked', actor: 'fb-skill-isolated-builder', details: { action: 'generation-build-write-failed', round, code: error.code || 'ERROR', message: error.message } }) } catch (auditError) { error.details = { ...error.details, auditError: auditError.message } }
      throw error
    }

    return {
      ok: status === 'success',
      status,
      exitCode,
      dist: ctx.output,
      report: ctx.buildReport,
      log: ctx.buildLog,
      assets,
      durationMs
    }
  })
}

const USAGE = [
  'Usage:',
  '  node tests/fixtures/reverse-requirements/build.cjs --project-root <dir> --id <slug> --round first|repaired',
  '',
  'All arguments are explicit; there is no --yes and no fixture auto-approval.',
  'Exit codes: 0 success; 1 build failed (real report saved); 2 invalid input/refusal; 3 not ready.'
].join('\n')

function parseArgs(argv) {
  const known = new Set(['--project-root', '--id', '--round', '--help'])
  const args = {}
  for (let index = 0; index < argv.length; index++) {
    const raw = argv[index]
    const split = raw.indexOf('=')
    const name = split > 2 ? raw.slice(0, split) : raw
    const inline = split > 2 ? raw.slice(split + 1) : undefined
    if (!known.has(name)) throw buildError('UNKNOWN_ARG', '未知参数（不存在自动批准通道）：' + raw)
    if (Object.hasOwn(args, name)) throw buildError('DUP_ARG', '重复参数：' + name)
    if (name === '--help') {
      if (inline !== undefined) throw buildError('BAD_ARG', '--help 不接受值')
      args[name] = true
    } else {
      const value = inline === undefined ? argv[++index] : inline
      if (!value || value.startsWith('--')) throw buildError('MISSING_VALUE', '缺少值：' + name)
      args[name] = value
    }
  }
  if (!args['--help'] && (!args['--project-root'] || !args['--id'] || !args['--round'])) {
    throw buildError('USAGE', USAGE)
  }
  return args
}

function main(argv) {
  let args
  try {
    args = parseArgs(argv)
  } catch (error) {
    process.stderr.write(JSON.stringify({ ok: false, code: error.code || 'ERROR', error: error.message, details: error.details }, null, 2) + '\n')
    process.exitCode = 2
    return
  }
  if (args['--help']) {
    process.stdout.write(USAGE + '\n')
    return
  }
  runBuild({ projectRoot: args['--project-root'], id: args['--id'], round: args['--round'] })
    .then(result => {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n')
      process.exitCode = result.ok ? 0 : 1
    })
    .catch(error => {
      process.stderr.write(JSON.stringify({ ok: false, code: error.code || 'ERROR', error: error.message, details: error.details }, null, 2) + '\n')
      process.exitCode = error.code === 'BUILD_NOT_READY' ? 3 : 2
    })
}

if (require.main === module) main(process.argv.slice(2))

module.exports = { runBuild }
