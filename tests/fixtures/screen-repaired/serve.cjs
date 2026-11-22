/**
 * screen-repaired fixture 静态服务（fixture 专用）。
 *
 * 用法：node tests/fixtures/screen-repaired/serve.cjs
 * - 固定绑定 127.0.0.1:18737（与首轮约定端口一致；端口被占用时明确报错退出，
 *   冲突即停止，不自动换端口。注意：先停掉占用 18737 的服务再启动本 fixture）；
 * - 服务对象是本 fixture 构建产物：<repoRoot>/.validation-output/release-validation/screen-repaired
 *   （独立产物路径，不覆盖首轮证据 screen-validation 的产物）；
 * - 产物不存在时明确报错并提示先构建，不自动构建、不联网、无 API 代理。
 */
const http = require('http')
const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
// 默认服务 attempt-01 产物（保留证据不覆盖）；可用显式参数指向新产物根
// （如 attempt-02），仅切换服务目录，固定端口不变：
//   FBJS_SCREEN_REPAIRED_ARTIFACT_ROOT=<产物根绝对路径> node tests/fixtures/screen-repaired/serve.cjs
const SCREEN_OUTPUT = process.env.FBJS_SCREEN_REPAIRED_ARTIFACT_ROOT
  ? path.resolve(process.env.FBJS_SCREEN_REPAIRED_ARTIFACT_ROOT)
  : path.join(REPO_ROOT, '.validation-output', 'release-validation', 'screen-repaired')
const HOST = '127.0.0.1'
const PORT = 18737

const entryHtml = path.join(SCREEN_OUTPUT, 'index.html')
const entryJs = path.join(SCREEN_OUTPUT, 'app.js')
if (!fs.existsSync(entryHtml) || !fs.existsSync(entryJs)) {
  process.stderr.write(
    `ERROR: screen-repaired 产物不完整（需要 index.html 与 app.js）：${SCREEN_OUTPUT}\n` +
      '请先运行：FB_SCREEN_DEPS_ROOT=<已验证应用依赖根> node tests/fixtures/screen-repaired/build.cjs\n' +
      '或用 FBJS_SCREEN_REPAIRED_ARTIFACT_ROOT=<产物根绝对路径> 显式指向已构建产物根\n'
  )
  process.exit(1)
}

const root = fs.realpathSync(SCREEN_OUTPUT)
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json' }
const server = http.createServer((request, response) => {
  let relative
  try { relative = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${PORT}`).pathname) } catch { response.writeHead(400).end(); return }
  if (relative === '/') relative = '/index.html'
  const file = path.resolve(root, `.${relative}`)
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end('Not found'); return }
  response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(response)
})
server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    process.stderr.write(`ERROR: 端口 ${PORT} 已被占用（127.0.0.1）。按约定冲突即停止：请先释放 ${PORT} 再重试，本服务不自动换端口。\n`)
    process.exit(1)
  }
  process.stderr.write(`ERROR: 静态服务启动失败：${(error && error.message) || error}\n`)
  process.exit(1)
})
server.listen(PORT, HOST, () => process.stdout.write(`MOCK screen-repaired fixture available at http://127.0.0.1:${PORT}/ (local only, no API proxy, no real map/video service, serving ${root})\n`))
