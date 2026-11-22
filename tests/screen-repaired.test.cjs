/**
 * screen-repaired.test.cjs —— screen-repaired fixture 的只读 / 隔离测试（node:test）。
 *
 * 背景：首轮 screen-validation 产物在浏览器验证中发现 panel/chart/map 不可见
 * （取证根因：真实 ScreenPanel 默认 zoom-center-to-corner enter 动画
 * fb-ui pc3 transition.less:272-282（enter=opacity:0+scale(0)，0.3s）在自动化
 * 环境被冻结在中间态；首轮证据 screen-validation 的源码/产物保持不动）。
 *
 * 本文件只验证 repaired fixture 的源码契约（不做浏览器自动化，浏览器端由主会话
 * 按 serve.cjs + __fbScreenRepaired 公开契约执行）：
 * 1) 真实 ScreenPanel 显式传自有公开 prop transition-name（绕过默认 enter 动画）；
 * 2) 真实 calcScale 调用带视口守卫（视口为 0 不调用）；
 * 3) wrapper 提供「卸载验证（真实 $destroy）/重新挂载」按钮与销毁报告渲染；
 * 4) 图表渲染实测契约（getChartStatus / canvas 实测行）存在；
 * 5) 框架真实件不回退：theme less import / 真实 ScreenUtil 实例化 / 真实
 *    FbEcharts+FbecMapBase / 30s 轮询 / 清理链 / 无真实服务 URL；
 * 6) 独立产物路径与固定端口契约（不覆盖首轮证据）。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'screen-repaired')
const MAIN_PATH = path.join(FIXTURE_ROOT, 'src', 'main.js')
const SCREEN_PATH = path.join(FIXTURE_ROOT, 'src', 'ScreenRepaired.vue')
const SERVE_PATH = path.join(FIXTURE_ROOT, 'serve.cjs')
const WEBPACK_CONFIG_PATH = path.join(FIXTURE_ROOT, 'webpack.config.cjs')

const REPO_ROOT = path.resolve(__dirname, '..')

const mainSrc = fs.readFileSync(MAIN_PATH, 'utf8')
const screenSrc = fs.readFileSync(SCREEN_PATH, 'utf8')
const serveSrc = fs.readFileSync(SERVE_PATH, 'utf8')
const configSrc = fs.readFileSync(WEBPACK_CONFIG_PATH, 'utf8')

test('修复 1：真实 ScreenPanel 显式传自有公开 prop transition-name 绕过默认 enter 动画', () => {
  // ScreenPanel.vue:97-101 定义 transitionName prop；默认 '' 时走框架
  // zoom-center-to-corner enter（首轮不可见根因）
  const matches = screenSrc.match(/transition-name="fb-screen-repaired-none"/g) || []
  assert.ok(matches.length >= 2, '两个真实 screen-panel 都必须显式传 transition-name（实占 ' + matches.length + ' 处）')
  assert.match(screenSrc, /const PANEL_TRANSITION_NAME = 'fb-screen-repaired-none'/, '固定值必须具名常量并在 debug 契约公开')
  assert.match(screenSrc, /PANEL_TRANSITION_NAME,\n/, 'debug 句柄必须公开 PANEL_TRANSITION_NAME')
})

test('修复 2：真实 calcScale 带视口守卫（视口为 0 不调用，防 scale(0) 毒化首帧）', () => {
  assert.match(screenSrc, /if\s*\(!\(window\.innerWidth > 0 && window\.innerHeight > 0\)\)\s*\{\s*return/, 'handleResize 必须先做视口守卫')
  assert.match(screenSrc, /window\.app\.\$screenUtil\.calcScale\(\)/, '守卫之后必须仍调用真实 calcScale')
  // 不复刻缩放计算：不得出现本组件自行计算 zoom/scale 的代码
  assert.doesNotMatch(screenSrc, /innerWidth\s*\/\s*DESIGN_WIDTH|innerHeight\s*\/\s*DESIGN_HEIGHT/, '不得在本组件复刻缩放计算（真实缩放只属于 ScreenUtil.calcScale）')
})

test('修复 3：wrapper 提供「卸载验证（真实 $destroy）/重新挂载」按钮与销毁报告', () => {
  // attempt-02 装配修复守卫：ScreenRepaired 必须在 Wrapper 上真实注册
  // （attempt-01 缺 components 注册导致 <screen-repaired> unknown tag，页面只剩控制条）
  assert.match(mainSrc, /components:\s*\{\s*ScreenRepaired\s*\}/, 'Wrapper 必须注册 components: { ScreenRepaired }')
  assert.match(mainSrc, /import ScreenRepaired from '\.\/ScreenRepaired\.vue'/, '页面组件必须真实 import')
  // unknown tag 等提示类警告必须可观察（warnHandler 收集，errorHandler 不收警告）
  assert.match(mainSrc, /Vue\.config\.warnHandler/, '必须挂 warnHandler 收集警告到 __fixtureWarnings')
  assert.match(mainSrc, /__fixtureWarnings/, '警告必须落到 window.__fixtureWarnings')
  assert.match(mainSrc, /unmountPage\(\)\s*\{\s*this\.isAlive = false/, '卸载按钮必须置 isAlive=false（触发真实 $destroy）')
  assert.match(mainSrc, /remountPage\(\)\s*\{\s*this\.destroyedReport = null/, '重新挂载按钮必须清报告并重建')
  assert.match(mainSrc, /<screen-repaired v-if="isAlive" @destroyed="handleDestroyed">/, '页面组件必须受 v-if 控制并接收销毁上报')
  assert.match(mainSrc, /data-testid="btn-unmount"/, '卸载按钮必须有稳定 testid')
  assert.match(mainSrc, /data-testid="btn-remount"/, '重新挂载按钮必须有稳定 testid')
  assert.match(mainSrc, /data-testid="destroyed-report"/, '销毁清理计数报告必须有稳定 testid')
  assert.match(screenSrc, /this\.\$emit\('destroyed', report\)/, 'beforeDestroy 必须上报清理计数')
  assert.match(screenSrc, /countersFinal:\s*\{\s*\.\.\.this\.lifecycle/, '销毁后调试句柄必须是清理计数快照')
})

test('图表渲染实测契约：getChartStatus 返回 canvas 数量/尺寸与 computed opacity', () => {
  assert.match(screenSrc, /getChartStatus\(\)\s*\{/, 'debug 句柄必须提供 getChartStatus')
  assert.match(screenSrc, /querySelectorAll\('#app canvas'\)/, '必须实测 #app 下 canvas')
  assert.match(screenSrc, /getComputedStyle\(body\)\.opacity/, '必须实测 panel body computed opacity')
  assert.match(screenSrc, /chart-status-line/, '工具栏必须有图表实测行（可观察）')
})

test('框架真实件不回退：theme less / 真实 ScreenUtil / 真实图表组件 / 30s 轮询 / 清理链', () => {
  assert.match(mainSrc, /import\s+'@topinfo\/screen-base\/src\/assets\/styles\/index\.less'/, '必须仍真实引入框架主题样式')
  assert.match(mainSrc, /new\s+ScreenUtil\(/, '必须仍真实实例化 ScreenUtil')
  assert.match(screenSrc, /<fb-echarts/, '必须仍使用真实 FbEcharts')
  assert.match(screenSrc, /<fbec-map-base/, '必须仍使用真实 FbecMapBase')
  assert.match(screenSrc, /:map-json="syntheticMapJson"/, '地图仍走 mapJson owner mock 边界')
  assert.match(screenSrc, /setInterval\(this\.handlePollTick,\s*POLL_INTERVAL_MS\)/, '轮询必须仍是真实 setInterval')
  assert.match(screenSrc, /clearInterval\(this\._screenPollTimer\)/, '卸载必须 clearInterval')
  assert.match(screenSrc, /removeEventListener\('resize',\s*this\.handleResize\)/, '卸载必须 removeEventListener')

  const all = mainSrc + '\n' + screenSrc
  const urlMatches = all.match(/https?:\/\/(?!www\.w3\.org)[^\s'"`)]+/g) || []
  assert.deepEqual(urlMatches, [], 'repaired fixture 同样不得包含真实 http(s) 服务端点')
  assert.doesNotMatch(all, /fetch\(|XMLHttpRequest|axios/, '不得发起网络请求')
  assert.doesNotMatch(all, /EasyVideoWall|HikPlayer|EasyPlayer|vue-tianditu|FbTmap|tianditu/, '不得挂载视频 player / 真实地图服务')
})

test('独立产物路径与固定端口：attempt-02 输出，attempt-01 证据保留，可显式指 artifact root', () => {
  // 构建输出：screen-repaired/build-attempt-02（attempt-01 bundle/log 保留在
  // screen-repaired/ 根部不动）
  assert.match(configSrc, /release-validation', 'screen-repaired', 'build-attempt-02'/, '构建必须输出到 build-attempt-02')
  // 服务默认仍指 attempt-01 目录（保留证据），支持显式 artifact root 参数
  assert.match(serveSrc, /process\.env\.FBJS_SCREEN_REPAIRED_ARTIFACT_ROOT/, 'serve 必须支持显式 artifact root 参数')
  assert.match(serveSrc, /path\.resolve\(process\.env\.FBJS_SCREEN_REPAIRED_ARTIFACT_ROOT\)/, 'artifact root 必须经 path.resolve 规整')
  assert.match(serveSrc, /const HOST = '127\.0\.0\.1'/)
  assert.match(serveSrc, /const PORT = 18737/, '仍固定 18737 端口（参数只切目录不切端口）')
  assert.match(serveSrc, /EADDRINUSE/, '冲突即停止契约保留')
  assert.match(serveSrc, /process\.exit\(1\)/)
  // 首轮证据不被本 fixture 触碰：剥注释后，repaired 构建/服务代码不得引用
  // screen-validation 目录（注释里说明「不覆盖首轮证据」是允许的）
  const functional = (serveSrc + '\n' + configSrc)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(functional, /screen-validation/, 'repaired 构建与服务不得指向首轮产物目录')
})
