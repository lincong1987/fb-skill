/**
 * reverse-requirements fixture 的独立静态服务主入口（CLI + startServer API）。
 *
 * 用法（全部参数显式，无自动批准通道）：
 *   node tests/fixtures/reverse-requirements/serve.cjs --project-root <dir> --id <slug> --round first|repaired [--port <n>]
 *
 * 流程（fail-closed，任何核验失败都不绑定端口）：
 * 1. E.checkGeneration({stage:'serve'})——批准/冻结清单/工具 hash 的权威校验由 E 完成；
 *    E 接口缺失或未就绪即拒绝；
 * 2. 本入口负责详细核验（asset/buildreport）：build-report.json hash 自洽、status=success、
 *    exitCode=0，与冻结清单/checkGeneration 的 input/plan/scope 哈希逐一一致，
 *    dist 绑定报告内唯一输出；实际 dist 文件集合必须与报告 assets 精确一致
 *    （无缺失、无多余、无链接），每个文件 bytes+sha256 与报告一致；
 * 3. 只绑定批准范围里的 127.0.0.1/端口；显式 --port 只能与其相等，占用即报错，不扫描；
 * 4. HTTP 层只允许 GET/HEAD；路径必须精确命中报告 assets 清单（/ 与 /index.html→index.html、
 *    /app.js→app.js），目录穿越/编码变体/API 路径一律不在清单内 → 拒绝；每次响应前
 *    重算 sha256 比对报告（磁盘被改动 → 500），不加载 CDN、无 API 代理、无目录列表。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const http = require('http')
const F = require('../../../skills/create-fb-feature/scripts/lib/files.cjs')

const E = require('../../../scripts/eval-reverse-requirements.cjs')

const ROUNDS = ['first', 'repaired']
const HOST = '127.0.0.1'
const DEFAULT_PORT = 18733
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }

function serveError(code, message, details) {
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
    else throw serveError('UNSAFE_ASSET', '服务产物不是普通文件：' + full)
  }
  return found
}

function appendServeLog(ctx, line) {
  if (typeof (ctx && ctx.serveLog) !== 'string') return
  try {
    F.assertNoLinks(ctx.serveLog)
    F.ensureDir(path.dirname(ctx.serveLog))
    F.assertNoLinks(ctx.serveLog)
    fs.appendFileSync(ctx.serveLog, new Date().toISOString() + ' ' + line + '\n')
  } catch (error) {
    process.stderr.write('WARN: serve.log 追加失败（不影响核验）：' + error.message + '\n')
  }
}

// 详细核验（本入口职责）：报告 ↔ 冻结清单 ↔ 实际 dist 三方一致
function verifyBuildArtifacts(ctx, checked) {
  if (typeof ctx.buildReport !== 'string' || !fs.existsSync(ctx.buildReport)) {
    throw serveError('BUILD_REPORT_MISSING', '构建报告不存在，先完成本轮构建：' + ctx.buildReport)
  }
  F.assertNoLinks(ctx.buildReport)
  const report = F.readJson(ctx.buildReport).value
  if (!report || report.schemaVersion !== 1) throw serveError('BUILD_REPORT_CORRUPT', '构建报告格式非法：' + ctx.buildReport)
  if (report.hash !== F.hashObject(F.withoutHash(report))) throw serveError('BUILD_REPORT_CORRUPT', '构建报告 hash 自洽性校验失败')
  const buildLog = F.readText(ctx.buildLog)
  if (!buildLog.exists || report.logSha256 !== sha256(Buffer.from(buildLog.raw))) throw serveError('BUILD_LOG_CHANGED', '构建日志缺失或内容变化')
  if (report.status !== 'success' || report.exitCode !== 0) {
    throw serveError('BUILD_REPORT_NOT_SUCCESS', '构建报告不是成功状态，拒绝服务：status=' + report.status)
  }
  if (report.dist !== ctx.output) throw serveError('BUILD_REPORT_DIST_MISMATCH', '报告 dist 与 E.context.output 不一致，拒绝绑定')
  if (typeof ctx.sourceManifest === 'string' && fs.existsSync(ctx.sourceManifest)) {
    const manifest = F.readJson(ctx.sourceManifest).value
    if (!manifest || manifest.hash !== F.hashObject(F.withoutHash(manifest))) throw serveError('MANIFEST_CORRUPT', '冻结清单 hash 自洽性校验失败')
    if (report.sourceManifestHash !== manifest.hash) throw serveError('BUILD_REPORT_MISMATCH', '报告 sourceManifestHash 与冻结清单不一致')
    if (manifest.inputHash !== report.inputHash) throw serveError('BUILD_REPORT_MISMATCH', '报告 inputHash 与冻结清单不一致')
  }
  for (const key of ['inputHash', 'planHash', 'scopeHash']) {
    if (checked[key] !== undefined && report[key] !== checked[key]) {
      throw serveError('BUILD_REPORT_MISMATCH', '报告 ' + key + ' 与 checkGeneration 不一致')
    }
  }
  if (!Array.isArray(report.assets) || report.assets.length !== 2 || report.assets.map(asset => asset.path).sort().join('|') !== 'app.js|index.html') throw serveError('BUILD_REPORT_CORRUPT', '报告必须包含两个精确的本地资产：index.html 与 app.js')

  const distReal = fs.realpathSync(report.dist)
  F.assertNoLinks(distReal)
  const expected = new Map(report.assets.map(asset => [String(asset.path), asset]))
  const actual = new Map(listFilesRecursive(distReal).map(file => {
    const relative = path.relative(distReal, file).split(path.sep).join('/')
    const content = fs.readFileSync(file)
    return [relative, { bytes: content.length, sha256: sha256(content) }]
  }))
  for (const [name, asset] of expected) {
    const found = actual.get(name)
    if (!found) throw serveError('ASSET_MISSING', '报告资产缺失：' + name)
    if (found.bytes !== asset.bytes || found.sha256 !== asset.sha256) {
      throw serveError('ASSET_HASH_MISMATCH', '实际文件与报告不一致：' + name)
    }
  }
  const extra = [...actual.keys()].filter(name => !expected.has(name))
  if (extra.length) throw serveError('ASSET_EXTRA', 'dist 出现报告之外的文件：' + extra.join(', '))
  return { report, distReal }
}

function buildRouteTable(report) {
  const routes = new Map(report.assets.map(asset => ['/' + asset.path, asset.path]))
  if (!routes.has('/index.html')) throw serveError('ASSET_MISSING', '报告资产缺少 index.html，无法提供入口页')
  routes.set('/', 'index.html')
  return routes
}

// 穿越形态在 URL 归一化之前拦下（原文点段、编码点/分隔符、反斜杠）——
// WHATWG URL 会把 %2e%2e 静默归一化成合法路径，因此必须先看原文。
function isTraversalShaped(rawUrl) {
  return /(^|\/|\\)\.{1,2}(\/|\\|\?|#|$)/.test(rawUrl) || /%2e|%2f|%5c/i.test(rawUrl)
}

function createRequestHandler(routes, distReal, report, ctx, port) {
  return (request, response) => {
    const rawUrl = String(request.url || '/')
    if (isTraversalShaped(rawUrl)) {
      response.writeHead(403).end()
      appendServeLog(ctx, `request 403 traversal-shaped ${request.method} ${rawUrl.slice(0, 80)}`)
      return
    }
    let pathname
    try {
      pathname = decodeURIComponent(new URL(rawUrl, `http://${HOST}:${port}`).pathname)
    } catch (error) {
      response.writeHead(400).end()
      appendServeLog(ctx, `request 400 decode-failure ${request.method}`)
      return
    }
    const assetName = routes.get(pathname)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end()
      appendServeLog(ctx, `request 405 ${request.method} ${pathname}`)
      return
    }
    if (!assetName) {
      // 不在报告 assets 精确清单内的请求（含目录穿越/编码变体/API 路径）一律拒绝
      response.writeHead(403).end()
      appendServeLog(ctx, `request 403 ${request.method} ${pathname}`)
      return
    }
    const file = path.join(distReal, assetName)
    let content
    try {
      F.assertNoLinks(file)
      content = fs.readFileSync(file)
    } catch (error) {
      response.writeHead(500).end()
      appendServeLog(ctx, `request 500 ${pathname} ${error.code || 'READ_FAILED'}`)
      return
    }
    if (sha256(content) !== report.assets.find(asset => asset.path === assetName).sha256) {
      response.writeHead(500).end()
      appendServeLog(ctx, `request 500 ${pathname} hash-drift`)
      return
    }
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(assetName)] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': 'no-store'
    })
    response.end(request.method === 'HEAD' ? undefined : content)
    appendServeLog(ctx, `request 200 ${request.method} ${pathname}`)
  }
}

async function startServer(options) {
  const o = options || {}
  const { projectRoot, id, round } = o
  if (!isDirectory(projectRoot)) throw serveError('PROJECT_ROOT_INVALID', 'projectRoot 必须是已存在的绝对路径目录：' + projectRoot)
  if (!ROUNDS.includes(round)) throw serveError('BAD_ROUND', 'round 必须是 first 或 repaired：' + round)
  if (typeof id !== 'string' || !id) throw serveError('BAD_ID', '缺少 id')
  if (typeof E.checkGeneration !== 'function') {
    throw serveError('E_INTERFACE_MISSING', 'eval-reverse-requirements.cjs 尚未实现 checkGeneration：独立服务拒绝执行（fail-closed）')
  }

  const checked = E.checkGeneration({ projectRoot, id, round, stage: 'serve' })
  if (!checked || checked.ok !== true || checked.ready !== true) {
    throw serveError('SERVE_NOT_READY', '生成未批准或未冻结，服务拒绝执行', checked ? checked.blockers : undefined)
  }
  const ctx = checked.context
  E.assertGenerationTools(ctx, __dirname)
  for (const key of ['output', 'buildReport', 'dependencyRoot']) {
    if (typeof ctx[key] !== 'string' || !path.isAbsolute(ctx[key])) throw serveError('E_CONTEXT_INVALID', 'E.context 缺少绝对路径字段：' + key)
  }
  // 端口纪律：绑定批准 scope 的端口；显式 port 只允许与 scope 一致（默认 18733 仅为 scope 未声明时的兜底）
  const scopePort = Number.isInteger(ctx.port) ? ctx.port : DEFAULT_PORT
  if (o.port !== undefined && o.port !== scopePort) {
    throw serveError('SERVE_PORT_MISMATCH', `显式端口 ${o.port} 与批准 scope 端口 ${scopePort} 不一致；本服务只绑定 scope 端口，不扫描`)
  }
  const port = scopePort

  F.assertNoLinks(ctx.serveLog)
  const { report, distReal } = verifyBuildArtifacts(ctx, checked)
  const routes = buildRouteTable(report)

  const server = http.createServer(createRequestHandler(routes, distReal, report, ctx, port))
  await new Promise((resolve, reject) => {
    const onError = error => {
      server.removeListener('listening', onListening)
      if (error && error.code === 'EADDRINUSE') {
        reject(serveError('SERVE_PORT_IN_USE', `端口 ${port} 已被占用（${HOST}）。请显式指定其他端口；本服务不扫描可用端口。`))
      } else {
        reject(serveError('SERVE_LISTEN_FAILED', '静态服务启动失败：' + ((error && error.message) || error)))
      }
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, HOST)
  })
  appendServeLog(ctx, `serve start ${HOST}:${port} id=${id} round=${round} reportHash=${report.hash} dist=${distReal}`)

  return {
    server,
    host: HOST,
    port,
    reportHash: report.hash,
    close() {
      appendServeLog(ctx, `serve close ${HOST}:${port}`)
      server.close()
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    }
  }
}

const USAGE = [
  'Usage:',
  '  node tests/fixtures/reverse-requirements/serve.cjs --project-root <dir> --id <slug> --round first|repaired [--port <n>]',
  '',
  'All arguments are explicit; there is no --yes and no fixture auto-approval.',
  'Binds 127.0.0.1 only (default port 18733); a busy port is an error, never scanned.',
  'Exit codes: 0 on clean shutdown; 2 invalid input/refusal; 3 not ready; 1 server error.'
].join('\n')

function parseArgs(argv) {
  const known = new Set(['--project-root', '--id', '--round', '--port', '--help'])
  const args = {}
  for (let index = 0; index < argv.length; index++) {
    const raw = argv[index]
    const split = raw.indexOf('=')
    const name = split > 2 ? raw.slice(0, split) : raw
    const inline = split > 2 ? raw.slice(split + 1) : undefined
    if (!known.has(name)) throw serveError('UNKNOWN_ARG', '未知参数（不存在自动批准通道）：' + raw)
    if (Object.hasOwn(args, name)) throw serveError('DUP_ARG', '重复参数：' + name)
    if (name === '--help') {
      if (inline !== undefined) throw serveError('BAD_ARG', '--help 不接受值')
      args[name] = true
    } else {
      const value = inline === undefined ? argv[++index] : inline
      if (value === undefined || String(value).startsWith('--')) throw serveError('MISSING_VALUE', '缺少值：' + name)
      args[name] = value
    }
  }
  if (!args['--help'] && (!args['--project-root'] || !args['--id'] || !args['--round'])) {
    throw serveError('USAGE', USAGE)
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
  const port = args['--port'] === undefined ? undefined : Number(args['--port'])
  startServer({ projectRoot: args['--project-root'], id: args['--id'], round: args['--round'], port })
    .then(handle => {
      process.stdout.write(`synthetic reverse-requirements fixture available at http://${handle.host}:${handle.port}/ (local only, report ${handle.reportHash})\n`)
      const shutdown = () => {
        handle.close()
        process.exitCode = 0
      }
      process.once('SIGINT', shutdown)
      process.once('SIGTERM', shutdown)
      handle.server.once('close', () => {
        process.stdout.write('server closed\n')
      })
    })
    .catch(error => {
      process.stderr.write(JSON.stringify({ ok: false, code: error.code || 'ERROR', error: error.message, details: error.details }, null, 2) + '\n')
      process.exitCode = error.code === 'SERVE_NOT_READY' ? 3 : error.code === 'SERVE_PORT_IN_USE' || error.code === 'SERVE_LISTEN_FAILED' ? 1 : 2
    })
}

if (require.main === module) main(process.argv.slice(2))

module.exports = { startServer }
