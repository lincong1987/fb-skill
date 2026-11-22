/**
 * screen-validation.test.cjs —— screen-validation fixture 的只读 / 隔离测试（node:test）。
 *
 * 测试对象（committed，可复现）：
 * - tests/fixtures/screen-validation/src/*（独立合成大屏页 + mock 数据）
 * - tests/fixtures/screen-validation/webpack.config.cjs / build.cjs / serve.cjs
 *   （独立 fixture 构建与静态服务配置，127.0.0.1:18737）
 * - .validation-output/release-validation/screen/*（build.cjs 产物，存在时校验框架标记）
 *
 * 验证目标（对应本轮 Node20 + 大屏隔离验证）：
 * 1) fixture 源码契约：真实框架 theme（screen-base theme/*.less import）、真实
 *    ScreenUtil（setTheme/calcScale 不被 fixture 复刻）、真实 screen-panel 与
 *    fb-third FbEcharts/FbecMapBase、30s 自然轮询、唯一拥有者清理、无真实服务 URL；
 * 2) 产物契约（产物存在时）：bundle 内含真实框架标记 —— html.theme-* 主题选择器、
 *    fb-mixins 混入色值（#2790FB）、screen-panel/screen-shell 框架类、screen-base
 *    版本横幅、调试句柄 —— 防止「自定义 CSS 冒充框架主题」；
 * 3) 版本一致性：fixture package.json 的 vue == vue-template-compiler == 2.6.12、
 *    screen-base 1.0.81；FB_SCREEN_DEPS_ROOT 显式给出时核对其安装版本。
 *
 * 边界声明：
 * - 全部为 synthetic fixture 测试；mock 数据 / debug 句柄不代表任何真实批准，
 *   不连接真实接口 / 地图 / 视频服务；本文件不启动服务器、不写任何文件。
 * - 浏览器端的运行时验证（DOM 几何 / computed style / 30s 轮询实际触发）由主会话
 *   按 serve.cjs + selectors 契约执行，不在本文件内做浏览器自动化。
 * - 产物相关断言在产物缺失时显式 skip（提示先构建），不静默通过。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

// ---- 路径 ----

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'screen-validation')
const FIXTURE_SRC = path.join(FIXTURE_ROOT, 'src')
const MAIN_PATH = path.join(FIXTURE_SRC, 'main.js')
const SCREEN_PATH = path.join(FIXTURE_SRC, 'ScreenValidation.vue')
const MOCK_PATH = path.join(FIXTURE_SRC, 'mock.js')
const WEBPACK_CONFIG_PATH = path.join(FIXTURE_ROOT, 'webpack.config.cjs')
const BUILD_PATH = path.join(FIXTURE_ROOT, 'build.cjs')
const SERVE_PATH = path.join(FIXTURE_ROOT, 'serve.cjs')
const FIXTURE_PKG_PATH = path.join(FIXTURE_ROOT, 'package.json')

const REPO_ROOT = path.resolve(__dirname, '..')
const SCREEN_OUTPUT = path.join(REPO_ROOT, '.validation-output', 'release-validation', 'screen')

// ---- 读取 fixture 源码 ----

const mainSrc = fs.readFileSync(MAIN_PATH, 'utf8')
const screenSrc = fs.readFileSync(SCREEN_PATH, 'utf8')
const mockSrc = fs.readFileSync(MOCK_PATH, 'utf8')
const serveSrc = fs.readFileSync(SERVE_PATH, 'utf8')

// ---- 产物存在性（缺失时产物测试显式 skip） ----

function bundlePath() {
  const js = path.join(SCREEN_OUTPUT, 'app.js')
  if (!fs.existsSync(js)) return null
  return js
}

// ===========================================================================
// 1) fixture 源码契约（始终运行）
// ===========================================================================

test('fixture main.js 真实引入框架主题样式与真实 ScreenUtil（不复刻 setTheme）', () => {
  // 框架主题样式：screen-base 实际 theme/*.less 入口（html.theme-* 选择器所在）
  assert.match(
    mainSrc,
    /import\s+'@topinfo\/screen-base\/src\/assets\/styles\/index\.less'/,
    'main.js 必须 import 真实框架主题样式入口（theme/*.less），不允许自定义 CSS 冒充'
  )
  // 真实 ScreenUtil 类来自安装包，且真实实例化
  assert.match(mainSrc, /import\s+ScreenBase,\s*\{\s*ScreenUtil\s*\}\s+from\s+'@topinfo\/screen-base'/)
  assert.match(mainSrc, /new\s+ScreenUtil\(/, '必须真实实例化安装包 ScreenUtil')
  // fixture 不复刻 setTheme 的 html.className 覆写逻辑（真实实现只应在 ScreenUtil）
  assert.doesNotMatch(
    screenSrc,
    /document\.getElementsByTagName\('html'\)\[0\]\.className\s*=/,
    '页面组件不得复刻 ScreenUtil.setTheme（html.className 覆写只属于真实 ScreenUtil）'
  )
  assert.doesNotMatch(
    mainSrc,
    /document\.getElementsByTagName\('html'\)\[0\]\.className\s*=/,
    'main.js 不得复刻 ScreenUtil.setTheme'
  )
})

test('fixture 页面使用真实 screen-panel / FbEcharts / FbecMapBase 组件标签', () => {
  // 真实大屏面板（screen-base install 注册的全局组件）
  assert.match(screenSrc, /<screen-panel/, '页面必须使用真实 screen-panel 组件')
  // 真实图表（fb-third install 注册的 FbEcharts）
  assert.match(screenSrc, /<fb-echarts/, '页面必须使用真实 fb-third FbEcharts 组件')
  // 真实地图模型（fb-third 导出、本 fixture main.js 注册；mapJson 为 owner mock 边界）
  assert.match(screenSrc, /<fbec-map-base/, '页面必须使用真实 fb-third FbecMapBase 组件')
  assert.match(screenSrc, /:map-json="syntheticMapJson"/, '地图 geoJSON 必须经 mapJson prop（owner 可 mock 边界）注入')
  assert.match(mainSrc, /import\s+\{\s*FbecMapBase\s*\}\s+from\s+'fb-third'/, 'FbecMapBase 必须来自真实 fb-third 导出')
})

test('30s 自然轮询为真实 setInterval，页面组件为唯一拥有者', () => {
  assert.match(mockSrc, /export const POLL_INTERVAL_MS = 30000/, 'mock.js 必须导出 30000ms 轮询间隔')
  assert.match(screenSrc, /setInterval\(this\.handlePollTick,\s*POLL_INTERVAL_MS\)/, '轮询必须是真实 setInterval')
  assert.match(screenSrc, /clearInterval\(this\._screenPollTimer\)/, 'beforeDestroy 必须 clearInterval')
  assert.match(screenSrc, /removeEventListener\('resize',\s*this\.handleResize\)/, 'beforeDestroy 必须 removeEventListener')
  assert.match(screenSrc, /delete window\.__fbScreenValidation/, 'beforeDestroy 必须删除调试句柄')
  // 唯一拥有者守卫（started 标记防重复启动/重复清理）
  assert.match(screenSrc, /_screenOwnerStarted/, '必须有唯一拥有者守卫')
})

test('fixture 不连接真实服务（无 http(s) 端点、无地图/视频服务 import）', () => {
  const all = mainSrc + '\n' + screenSrc + '\n' + mockSrc
  // 允许 xmlns/命名空间类字符串；本 fixture 不应出现任何真实服务端点
  const urlMatches = all.match(/https?:\/\/(?!www\.w3\.org)[^\s'"`)]+/g) || []
  assert.deepEqual(urlMatches, [], 'fixture 源码不得包含真实 http(s) 服务端点')
  assert.doesNotMatch(all, /fetch\(|XMLHttpRequest|axios/, '不得发起网络请求')
  // 视频播放器 wrapper 不被本 fixture 挂载（只读取证，未测范围在报告中声明）
  assert.doesNotMatch(all, /EasyVideoWall|HikPlayer|EasyPlayer/, '不得挂载视频 player wrapper（不连真实视频服务）')
  // 天地图（真实地图服务）不得引入
  assert.doesNotMatch(all, /vue-tianditu|FbTmap|tianditu/, '不得引入真实地图服务（vue-tianditu/FbTmap）')
})

test('mock 数据为合成数据：geoJSON 仅注入 mapJson 边界，统计值由 refresh 重算', () => {
  assert.match(mockSrc, /export const MOCK_BANNER = 'MOCK/, '必须有 MOCK 横幅声明')
  assert.match(mockSrc, /syntheticMapJson = \{/, '必须提供合成 geoJSON')
  assert.match(mockSrc, /'FeatureCollection'/, '合成 geoJSON 必须是 FeatureCollection 结构')
  assert.match(mockSrc, /export const screenMock = \{/, '必须有可重算的合成统计')
})

// ===========================================================================
// 2) 构建与服务配置契约（始终运行）
// ===========================================================================

test('serve.cjs 固定 127.0.0.1:18737，冲突即停止，产物缺失明确报错', () => {
  assert.match(serveSrc, /const HOST = '127\.0\.0\.1'/, '必须固定绑定 127.0.0.1')
  assert.match(serveSrc, /const PORT = 18737/, '必须固定端口 18737（任务约定，不提供覆盖）')
  assert.doesNotMatch(serveSrc, /process\.env\.\w*PORT\w*/, '不得用环境变量覆盖端口')
  assert.match(serveSrc, /EADDRINUSE/, '必须处理端口冲突')
  assert.match(serveSrc, /process\.exit\(1\)/, '端口冲突必须以非零退出（冲突即停止）')
  assert.match(serveSrc, /release-validation', 'screen'/, '服务对象必须是本 fixture 的构建产物目录')
})

test('webpack.config.cjs 独立输出到 .validation-output/release-validation/screen，无硬编码盘符', () => {
  const configSrc = fs.readFileSync(WEBPACK_CONFIG_PATH, 'utf8')
  assert.match(configSrc, /release-validation', 'screen'/, '输出目录必须是 .validation-output/release-validation/screen')
  assert.match(configSrc, /process\.env\.FB_SCREEN_DEPS_ROOT/, '依赖根必须来自显式 env')
  assert.doesNotMatch(
    configSrc.replace(/\/\/[^\n]*/g, ''),
    /[A-Za-z]:[\\/](projects|Users)/,
    '配置代码不得硬编码盘符路径（注释除外）'
  )
  // 构建入口同样只依赖 FB_SCREEN_DEPS_ROOT
  const buildSrc = fs.readFileSync(BUILD_PATH, 'utf8')
  assert.match(buildSrc, /process\.env\.FB_SCREEN_DEPS_ROOT/, 'build.cjs 必须使用显式 FB_SCREEN_DEPS_ROOT')
  assert.doesNotMatch(
    buildSrc.replace(/\/\/[^\n]*/g, ''),
    /[A-Za-z]:[\\/](projects|Users)/,
    'build.cjs 不得硬编码盘符路径（注释除外）'
  )
})

// ===========================================================================
// 3) 版本一致性
// ===========================================================================

test('fixture 版本契约：vue 与 vue-template-compiler 一致 2.6.12，screen-base 1.0.81', () => {
  const pkg = JSON.parse(fs.readFileSync(FIXTURE_PKG_PATH, 'utf8'))
  assert.equal(pkg.dependencies.vue, '2.6.12')
  assert.equal(pkg.dependencies['vue-template-compiler'], '2.6.12', 'vue-template-compiler 必须与 vue 版本一致')
  assert.equal(pkg.dependencies['@topinfo/screen-base'], '1.0.81')
  assert.equal(pkg.dependencies['fb-third'], '1.1.810')
  assert.equal(pkg.dependencies['fb-ui'], '1.1.840')
  assert.equal(pkg.dependencies.echarts, '5.6.0')
})

test('FB_SCREEN_DEPS_ROOT 显式给出时：安装版本与 fixture 契约一致（未设置则显式 skip）', (t) => {
  // scope 分离（主会话约定）：FBJS_DEPS_ROOT 服务旧 catalog guard / runtime-smoke
  // （主会话最终整套可能指向 SOL07），本 screen 契约的版本核对只认专属
  // FB_SCREEN_DEPS_ROOT（准确 GMRHCP mew-manage-ui）。本测试不读 FBJS_DEPS_ROOT，
  // 指向 scope 不符的根时按失败如实保存，不换版本兼容。
  const depsRoot = process.env.FB_SCREEN_DEPS_ROOT
  if (!depsRoot) {
    t.skip('FB_SCREEN_DEPS_ROOT 未设置：安装版本核对跳过（scope 分离：不读 FBJS_DEPS_ROOT，fixture 契约测试不受影响，无硬编码 fallback）')
    return
  }
  const readPkgVersion = (rel) => {
    const p = path.join(depsRoot, 'node_modules', rel, 'package.json')
    if (!fs.existsSync(p)) return null
    return JSON.parse(fs.readFileSync(p, 'utf8')).version
  }
  assert.equal(readPkgVersion('vue'), '2.6.12', 'FB_SCREEN_DEPS_ROOT 内 vue 必须是 2.6.12')
  assert.equal(readPkgVersion('vue-template-compiler'), '2.6.12', 'FB_SCREEN_DEPS_ROOT 内 vue-template-compiler 必须一致')
  assert.equal(readPkgVersion('@topinfo/screen-base'), '1.0.81', 'FB_SCREEN_DEPS_ROOT 内 screen-base 必须是 1.0.81')
  assert.equal(readPkgVersion('fb-third'), '1.1.810')
  assert.equal(readPkgVersion('fb-ui'), '1.1.840')
  assert.equal(readPkgVersion('echarts'), '5.6.0')
})

// ===========================================================================
// 4) 产物契约（产物存在时；缺失显式 skip）
// ===========================================================================

test('构建产物存在时：bundle 含真实框架主题标记（防自定义 CSS 冒充）', (t) => {
  const js = bundlePath()
  if (!js) {
    t.skip('构建产物缺失：请先运行 FB_SCREEN_DEPS_ROOT=<app-root> node tests/fixtures/screen-validation/build.cjs')
    return
  }
  const bundle = fs.readFileSync(js, 'utf8')
  // 框架主题：全部 11 个 html.theme-* 主题选择器被编译进 bundle（screen-base theme/*.less）
  const themes = ['midnight-blue', 'sky-blue', 'dark-blue', 'navy-blue', 'cornflower-blue', 'royal-blue', 'geekl-blue', 'trans-blue', 'black-feather-blue', 'daishan-green', 'cerulean-blue']
  for (const theme of themes) {
    assert.ok(bundle.includes(`theme-${theme}`), `bundle 必须包含框架主题选择器 theme-${theme}`)
  }
  // fb-mixins .blue-theme() 混入的真实色值（jpx-input 边框 #2790FB，ScreenUtil.setTheme 后生效）
  assert.ok(/border:\s*1px solid #2790FB/i.test(bundle), 'bundle 必须包含 fb-mixins 混入的真实主题色值 #2790FB')
})

test('构建产物存在时：bundle 含真实 screen-base 组件与版本横幅、真实 echarts', (t) => {
  const js = bundlePath()
  if (!js) {
    t.skip('构建产物缺失：请先运行 build.cjs')
    return
  }
  const bundle = fs.readFileSync(js, 'utf8')
  assert.ok(bundle.includes('screen-panel__wrapper'), 'bundle 必须包含真实 ScreenPanel 结构类名')
  assert.ok(bundle.includes('screen-shell'), 'bundle 必须包含真实 screen-shell 框架画布类名')
  assert.ok(bundle.includes('@topinfo/screen-base v'), 'bundle 必须包含 screen-base 版本横幅（真实包入口 console）')
  assert.ok(bundle.includes('fb-ui v'), 'bundle 必须包含 fb-ui 版本横幅')
  assert.ok(bundle.includes('fb-third v'), 'bundle 必须包含 fb-third 版本横幅')
  assert.ok(/echarts/i.test(bundle), 'bundle 必须包含真实 echarts')
})

test('构建产物存在时：bundle 含 fixture 公开调试契约与 mock 横幅', (t) => {
  const js = bundlePath()
  if (!js) {
    t.skip('构建产物缺失：请先运行 build.cjs')
    return
  }
  const bundle = fs.readFileSync(js, 'utf8')
  assert.ok(bundle.includes('__fbScreenValidation'), 'bundle 必须暴露 __fbScreenValidation 调试句柄')
  assert.ok(bundle.includes('MOCK 大屏验证'), 'bundle 必须包含 MOCK 横幅（synthetic 声明）')
  assert.ok(bundle.includes('MOCK-A'), 'bundle 必须包含合成 geoJSON 数据（FbecMapBase mapJson 边界）')
  // 产物 index.html 挂载点与 fixture 契约一致
  const html = fs.readFileSync(path.join(SCREEN_OUTPUT, 'index.html'), 'utf8')
  assert.match(html, /id="fb-screen-root"/, '产物 index.html 必须包含挂载点')
})
