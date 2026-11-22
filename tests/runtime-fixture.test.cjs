/**
 * runtime-fixture.test.cjs —— runtime-smoke fixture 的只读 / 隔离测试（node:test）。
 *
 * 测试输入（主入口，committed，可复现）：
 * - tests/fixtures/runtime-smoke/src/mock.js（CSV 公式注入防护 + mock 契约）
 * - tests/fixtures/runtime-smoke/src/Screen.vue（主题机制 / 30s 轮询 / 生命周期清理 / contain 缩放）
 * - 以上为 .validation-output/runtime-smoke/src 浏览器现版本的复制；二者同时存在时
 *   必须逐字节一致（防漂移测试）。不读取任何 gitignore 之外的运行时生成物作为主输入。
 *
 * 安装源码取证（反证）：
 * - 只接受显式环境变量 FBJS_DEPS_ROOT（指向已验证应用依赖根，其下 node_modules 内
 *   必须有 @topinfo/screen-base@1.0.81）；未设置或源不存在时这两条测试明确 skip，
 *   不使用任何硬编码 fallback 路径。组件行为 / CSV 测试不依赖该 env，始终运行。
 *
 * ESM 处理（不依赖 Node24 语法自动探测）：
 * - mock.js 与 Screen.vue <script> 均通过「受限 import/export 字符串转换 + new Function」
 *   在内存求值（不写临时文件）；转换不完整时断言直接失败，防止静默跑偏。
 *
 * 边界声明：
 * - 全部为 synthetic fixture 测试；测试中的 mock 状态、合成数据、debug 句柄
 *   都不代表任何真实用户批准，也不连接真实接口。
 * - 不启动服务器 / 浏览器 / 构建；本文件不写任何文件。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

// ---- 路径：主输入 = committed fixtures；漂移对照 = .validation-output 浏览器现版本 ----

const FIXTURE_SRC = path.join(__dirname, 'fixtures', 'runtime-smoke', 'src')
const FIXTURE_MOCK_PATH = path.join(FIXTURE_SRC, 'mock.js')
const FIXTURE_SCREEN_PATH = path.join(FIXTURE_SRC, 'Screen.vue')

const BROWSER_SRC = path.resolve(__dirname, '..', '.validation-output', 'runtime-smoke', 'src')
const BROWSER_MOCK_PATH = path.join(BROWSER_SRC, 'mock.js')
const BROWSER_SCREEN_PATH = path.join(BROWSER_SRC, 'Screen.vue')

// ---- 安装源码根：仅显式 FBJS_DEPS_ROOT，无 fallback ----

function resolveScreenBase() {
  const depsRoot = process.env.FBJS_DEPS_ROOT
  if (!depsRoot) {
    return {
      skip: 'FBJS_DEPS_ROOT 未设置：安装源码取证测试跳过（组件行为/CSV 测试不受影响，无硬编码 fallback）',
    }
  }
  const root = path.join(depsRoot, 'node_modules', '@topinfo', 'screen-base')
  const pkgPath = path.join(root, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    return {
      skip: `FBJS_DEPS_ROOT 下未找到 @topinfo/screen-base/package.json：${pkgPath}（安装源码取证测试跳过）`,
    }
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  // 显式指定了依赖根 → 版本契约必须满足（不匹配=失败，不是 skip）
  assert.equal(pkg.name, '@topinfo/screen-base')
  assert.equal(pkg.version, '1.0.81', 'FBJS_DEPS_ROOT 指向的 screen-base 必须是 1.0.81')
  return { root, pkgPath, pkg }
}

const screenBase = resolveScreenBase()
const SCREEN_BASE_SKIP_REASON = screenBase.skip || false

// ---- mock.js 加载：受限 import/export 转换 + new Function（不依赖语法自动探测） ----

let mockModuleCache = null

/**
 * 把 committed fixture 的 mock.js（ESM 语法）转换为普通函数体并求值：
 * - 仅剥除行首 `export const|function|let|var|class` 声明的 export 关键字；
 * - 拒绝任何 import 语句、拒绝转换后残留的 export（含 export {} / export default 形态）；
 * - 收集全部导出名并构造 return 对象，导出面缺失即失败。
 * 每次调用产生一份全新模块状态（与 ESM 单实例语义一致：本文件只构建一次并复用）。
 */
function buildMockModule() {
  assert.ok(fs.existsSync(FIXTURE_MOCK_PATH), `committed fixture mock.js 必须存在：${FIXTURE_MOCK_PATH}`)
  const src = fs.readFileSync(FIXTURE_MOCK_PATH, 'utf8')
  assert.ok(!/^import\b/m.test(src), 'mock.js fixture 不得包含 import 语句（转换器不支持）')

  const names = []
  const transformed =
    "'use strict';\n" +
    src.replace(
      /^export\s+(const|function|let|var|class)\s+([A-Za-z_$][\w$]*)/gm,
      (decl, kind, name) => {
        names.push(name)
        return decl.replace(/^export\s+/, '')
      }
    )
  assert.ok(!/^export\b/m.test(transformed), '转换后不得残留 export 语句（export {} / export default 不支持）')
  assert.ok(names.length >= 10, `mock.js 导出面不完整（仅 ${names.length} 个导出）`)

  const required = ['MOCK_BANNER', 'mockState', 'screenMock', 'deviceService', 'saveDevice', 'getAllDevices', 'buildDevicesCsv', 'sanitizeCsvCell', 'resetMockRuntime', 'STATUS_MAP']
  for (const name of required) {
    assert.ok(names.includes(name), `mock.js 缺少测试所需导出：${name}`)
  }

  const factory = new Function(transformed + '\nreturn {' + names.map((n) => `${n}: ${n}`).join(', ') + '};')
  return factory()
}

function loadMock() {
  if (!mockModuleCache) {
    mockModuleCache = buildMockModule()
  }
  return mockModuleCache
}

// ---- Screen.vue <script> 块的内存转换（不写文件，同一受限转换思路） ----

function readScreenSfc() {
  assert.ok(fs.existsSync(FIXTURE_SCREEN_PATH), `committed fixture Screen.vue 必须存在：${FIXTURE_SCREEN_PATH}`)
  return fs.readFileSync(FIXTURE_SCREEN_PATH, 'utf8')
}

function extractScriptBlock(sfc) {
  const match = sfc.match(/<script>([\s\S]*?)<\/script>/)
  assert.ok(match, 'Screen.vue 必须含 <script> 块')
  return match[1]
}

function extractTemplateBlock(sfc) {
  const match = sfc.match(/<template>([\s\S]*?)<\/template>/)
  assert.ok(match, 'Screen.vue 必须含 <template> 块')
  return match[1]
}

/**
 * 把 Screen.vue <script> 转成组件 options 并立即求值。
 * env 的 window/document/setInterval/clearInterval fake 在构建时注入（方法体内引用
 * 的是本函数闭包参数），因此每个测试用例都要用新 env 构建一份 options。
 */
function buildScreenOptions(mockModule, env) {
  const script = extractScriptBlock(readScreenSfc())
  const transformed = script
    .replace(
      /^import\s+\{[^}]+\}\s+from\s+['"]\.\/mock\.js['"]\s*$/m,
      'const { MOCK_BANNER, mockState, screenMock } = __mock__;'
    )
    .replace(/^export default\s*\{/m, 'return {')
  assert.ok(!/^\s*import\b/m.test(transformed), '转换后不得残留 import 语句')
  assert.ok(!/export\s+default/.test(transformed), '转换后不得残留 export default')
  // window / document / setInterval / clearInterval 以参数注入，屏蔽真实全局
  const build = new Function('__mock__', 'window', 'document', 'setInterval', 'clearInterval', transformed)
  return build(mockModule, env.windowFake, env.documentFake, env.setIntervalFake, env.clearIntervalFake)
}

// ---- Screen.vue 生命周期测试用的合成环境（全部为测试内 fake，非真实 DOM） ----

function makeEnv(initialHtmlClassName) {
  const state = {
    intervals: [],
    clearedIntervalIds: [],
    nextIntervalId: 1,
    addedListeners: [],
    removedListeners: [],
  }
  const html = { className: initialHtmlClassName }
  const windowFake = {
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener(type, fn) {
      state.addedListeners.push({ type, fn })
    },
    removeEventListener(type, fn) {
      state.removedListeners.push({ type, fn })
    },
  }
  const documentFake = { documentElement: html }
  const setIntervalFake = (fn, delay) => {
    const id = state.nextIntervalId++
    state.intervals.push({ id, fn, delay })
    return id
  }
  const clearIntervalFake = (id) => {
    state.clearedIntervalIds.push(id)
  }
  return { state, html, windowFake, documentFake, setIntervalFake, clearIntervalFake }
}

// 复刻 Vue2 语义：data() 产出响应式初值，methods 绑定到同一实例（引用稳定）
function makeVm(options, refs) {
  const vm = {}
  const data = options.data ? options.data.call(vm) : {}
  Object.assign(vm, data)
  for (const name of Object.keys(options.methods || {})) {
    vm[name] = options.methods[name].bind(vm)
  }
  vm.$refs = refs
  return vm
}

// ============================== fixtures：存在性与防漂移 ==============================

test('committed runtime-smoke fixtures exist and match the browser sources when both exist', () => {
  for (const [name, fixturePath, browserPath] of [
    ['mock.js', FIXTURE_MOCK_PATH, BROWSER_MOCK_PATH],
    ['Screen.vue', FIXTURE_SCREEN_PATH, BROWSER_SCREEN_PATH],
  ]) {
    assert.ok(fs.existsSync(fixturePath), `committed fixture ${name} 必须存在（测试主输入）`)
    if (fs.existsSync(browserPath)) {
      assert.equal(
        fs.readFileSync(fixturePath, 'utf8'),
        fs.readFileSync(browserPath, 'utf8'),
        `${name}：committed fixture 与 .validation-output 浏览器现版本内容漂移`
      )
    }
    // .validation-output 不存在（如干净检出）时只要求 committed fixture 在场，不做对比
  }
})

// ============================== mock 模块构建（受限转换，非语法自动探测） ==============================

test('mock module builds via restricted import/export transform with full export surface', () => {
  const mock = loadMock()
  for (const name of ['MOCK_BANNER', 'STATUS_MAP', 'STATUS_OPTIONS', 'mockState', 'deviceService', 'saveDevice', 'getAllDevices', 'sanitizeCsvCell', 'buildDevicesCsv', 'screenMock', 'resetMockRuntime']) {
    assert.ok(mock[name] !== undefined, `转换后的 mock 模块必须导出 ${name}`)
  }
  assert.equal(typeof mock.sanitizeCsvCell, 'function')
  assert.equal(typeof mock.buildDevicesCsv, 'function')
})

// ============================== mock.js：CSV 公式注入防护 ==============================

test('sanitizeCsvCell blocks formula prefixes (=, +, -, @) including whitespace-prefixed variants', () => {
  const mock = loadMock()
  // OWASP CSV Injection 常见导出处理：危险前缀 → 原值前加半角单引号
  assert.equal(mock.sanitizeCsvCell('=1+1'), "'=1+1")
  assert.equal(mock.sanitizeCsvCell('+SUM(A1)'), "'+SUM(A1)")
  assert.equal(mock.sanitizeCsvCell('@SUM(A1)'), "'@SUM(A1)")
  assert.equal(mock.sanitizeCsvCell('-cmd'), "'-cmd")
  // 空白前缀（空格 / 制表符 / 回车 / 换行）后接危险字符同样防护
  assert.equal(mock.sanitizeCsvCell(' =SUM(A1)'), "' =SUM(A1)")
  assert.equal(mock.sanitizeCsvCell('\t=HYPERLINK("http://x","y")'), "'\t=HYPERLINK(\"http://x\",\"y\")")
  assert.equal(mock.sanitizeCsvCell('\r=cmd'), "'\r=cmd")
  assert.equal(mock.sanitizeCsvCell('\n=cmd'), "'\n=cmd")
  assert.equal(mock.sanitizeCsvCell('   - 3'), "'   - 3")
  assert.equal(mock.sanitizeCsvCell('\t+2'), "'\t+2")
  // 纯制表符 / 回车 / 换行开头（OWASP 列表中的 tab / CR 前缀）
  assert.equal(mock.sanitizeCsvCell('\tpure-tab'), "'\tpure-tab")
  assert.equal(mock.sanitizeCsvCell('\r\npure-crlf'), "'\r\npure-crlf")
})

test('sanitizeCsvCell does not damage ordinary text (dangerous char not at start)', () => {
  const mock = loadMock()
  assert.equal(mock.sanitizeCsvCell('示例设备-甲'), '示例设备-甲')
  assert.equal(mock.sanitizeCsvCell('DEV-0001'), 'DEV-0001')
  assert.equal(mock.sanitizeCsvCell('abc=def'), 'abc=def')
  assert.equal(mock.sanitizeCsvCell('hello world'), 'hello world')
  assert.equal(mock.sanitizeCsvCell('在线'), '在线')
  assert.equal(mock.sanitizeCsvCell('离线'), '离线')
  // 纯空白不是公式，不加前缀
  assert.equal(mock.sanitizeCsvCell('  '), '  ')
  // 空值与数值
  assert.equal(mock.sanitizeCsvCell(''), '')
  assert.equal(mock.sanitizeCsvCell(null), '')
  assert.equal(mock.sanitizeCsvCell(undefined), '')
  assert.equal(mock.sanitizeCsvCell(42), '42')
  // 已知取舍：以 - 开头的负数也加前缀（与 OWASP 建议一致，宁多不漏）
  assert.equal(mock.sanitizeCsvCell('-5'), "'-5")
})

test('buildDevicesCsv quotes cells, escapes quotes and sanitizes dangerous cells (CRLF, header row)', async () => {
  const mock = loadMock()
  mock.resetMockRuntime()
  const before = mock.getAllDevices().length
  assert.ok(before >= 2, 'fixture 初始合成设备至少 2 条')

  const base = mock.buildDevicesCsv()
  const rows = base.split('\r\n')
  assert.equal(rows[0], 'id,name,status', '首行为表头，CRLF 分行')
  assert.ok(rows[1].startsWith('"DEV-0001","示例设备-甲","在线"'), '普通合成行仅做引号包裹，不被损坏')

  // 注入危险名称 → CSV 单元格带 ' 前缀；含引号名称 → 转义为两个引号
  const add1 = await mock.saveDevice({ name: '=1+1', status: '1' })
  assert.equal(add1.code, 1)
  const add2 = await mock.saveDevice({ name: 'a"b', status: '0' })
  assert.equal(add2.code, 1)
  assert.equal(mock.getAllDevices().length, before + 2, 'saveDevice 成功分支追加合成记录')

  const csv = mock.buildDevicesCsv()
  assert.ok(csv.includes('"' + "'=1+1" + '"'), '危险单元格被加 \' 前缀后包裹：该单元格应为 "' + "'=1+1" + '"')
  assert.ok(csv.includes('"a""b"'), '含引号单元格按 CSV 规则转义为两个引号')
  assert.ok(!csv.includes('"=1+1"'), '不得出现未防护的 = 开头单元格')
})

// ============================== mock.js：mock 契约 ==============================

test('deviceService.list returns fb-simple-table IPage contract and counts requests', async () => {
  const mock = loadMock()
  mock.resetMockRuntime()

  // 无过滤查询：total 等于全部合成设备数
  const all = await mock.deviceService.list({ current: 1, size: 10 })
  assert.equal(all.code, 1)
  assert.equal(all.data.total, mock.getAllDevices().length)
  assert.ok(Array.isArray(all.data.records))
  assert.equal(all.data.current, 1)
  assert.equal(all.data.size, 10)
  assert.equal(typeof all.data.pages, 'number')
  assert.equal(mock.mockState.requestStats.list, 1)

  // 按名称过滤：total 与过滤后集合一致（首个合成设备名含「示例」）
  const expectedNamed = mock.getAllDevices().filter((d) => d.name.indexOf('示例') !== -1).length
  assert.ok(expectedNamed >= 1, 'fixture 初始合成数据应包含「示例设备」')
  const named = await mock.deviceService.list({ name: '示例', current: 1, size: 10 })
  assert.equal(named.data.total, expectedNamed)
  assert.equal(named.data.records.length, expectedNamed)

  const miss = await mock.deviceService.list({ name: '不存在-xyz' })
  assert.equal(miss.data.total, 0)
  assert.deepEqual(miss.data.records, [])

  const paged = await mock.deviceService.list({ current: 2, size: 1 })
  assert.equal(paged.data.records.length, 1)
  assert.equal(paged.data.current, 2)
  assert.equal(mock.mockState.requestStats.list, 4)
})

test('saveDevice honors failure switch; success appends exactly one synthetic record', async () => {
  const mock = loadMock()
  mock.resetMockRuntime()
  const before = mock.getAllDevices().length

  mock.mockState.saveFailureMode = true
  const failed = await mock.saveDevice({ name: '失败用例', status: '1' })
  assert.equal(failed.code, 0)
  assert.ok(/失败/.test(failed.message))
  assert.equal(mock.getAllDevices().length, before, '失败分支不得追加记录')

  mock.mockState.saveFailureMode = false
  const ok = await mock.saveDevice({ name: '成功用例', status: '0' })
  assert.equal(ok.code, 1)
  assert.ok(/^DEV-\d{4}$/.test(ok.data.id))
  assert.equal(mock.getAllDevices().length, before + 1)

  mock.resetMockRuntime()
  assert.equal(mock.mockState.requestStats.save, 0)
  assert.equal(mock.mockState.saveFailureMode, false)
})

test('screenMock.refresh recomputes from synthetic devices and increments observable counter', () => {
  const mock = loadMock()
  mock.resetMockRuntime()
  const devices = mock.getAllDevices()
  const expectedOnline = devices.filter((d) => d.status === '1').length
  const expectedOffline = devices.filter((d) => d.status === '0').length

  const r1 = mock.screenMock.refresh()
  assert.equal(r1.total, devices.length)
  assert.equal(r1.online, expectedOnline)
  assert.equal(r1.offline, expectedOffline)
  assert.equal(r1.screenRefresh, 1)
  assert.equal(mock.mockState.requestStats.screenRefresh, 1)

  const r2 = mock.screenMock.refresh()
  assert.equal(r2.screenRefresh, 2)
})

// ============================== Screen.vue：主题机制行为（D1 整改，committed fixture） ==============================

test('Screen.vue theme uses the two declared global theme values applied via html.theme-* class', () => {
  const mock = loadMock()
  const sfc = readScreenSfc()
  const script = extractScriptBlock(sfc)
  // 主题值固化在 committed fixture 源码中（与安装源码 themeList 的交叉验证在 env 门控测试）
  assert.match(script, /const THEME_A = 'sky-blue'/)
  assert.match(script, /const THEME_B = 'midnight-blue'/)
  assert.match(script, /const POLL_INTERVAL_MS = 30000/)

  // 模板不得向 Panel 传局部 theme prop（首轮 D1 错误形态）
  const template = extractTemplateBlock(sfc)
  assert.ok(!/:theme=/.test(template), '模板不得绑定 Panel 局部 :theme prop')
  assert.ok(!/ theme="/.test(template), '模板不得绑定 Panel 局部 theme=" prop')

  // 运行行为：html.theme-* 类切换，保留非 theme-* 类；两个主题值轮换
  const env = makeEnv('root-class other')
  const options = buildScreenOptions(mock, env)
  const vm = makeVm(options, { viewport: { clientWidth: 1920, clientHeight: 1080 } })
  options.mounted.call(vm)

  assert.equal(env.html.className, 'root-class other theme-sky-blue')
  assert.equal(vm.theme, 'sky-blue')
  assert.equal(vm.lifecycle.themeApplied, 1)

  options.methods.handleToggleTheme.call(vm)
  assert.equal(vm.theme, 'midnight-blue')
  assert.equal(env.html.className, 'root-class other theme-midnight-blue')
  assert.ok(!env.html.className.includes('theme-sky-blue'))
  assert.equal(vm.lifecycle.themeApplied, 2)

  options.methods.handleToggleTheme.call(vm)
  assert.equal(vm.theme, 'sky-blue')
  assert.equal(env.html.className, 'root-class other theme-sky-blue')
})

// ============================== Screen.vue：缩放声明（自定义 contain，非 ScreenUtil） ==============================

test('Screen.vue scaling is fixture-custom contain (min of width/height ratios), not ScreenUtil', () => {
  const mock = loadMock()
  const script = extractScriptBlock(readScreenSfc())
  assert.match(script, /Math\.min\(w \/ DESIGN_WIDTH, h \/ DESIGN_HEIGHT\)/, 'contain 缩放公式必须在源码中')
  assert.match(script, /非 ScreenUtil 框架缩放|不是.*ScreenUtil/, '源码必须明示非 ScreenUtil 缩放')

  const env = makeEnv('')
  const options = buildScreenOptions(mock, env)
  const viewport = { clientWidth: 1920, clientHeight: 1080 }
  const vm = makeVm(options, { viewport })
  options.mounted.call(vm)
  assert.equal(vm.scale, 1)
  assert.equal(vm.lifecycle.resizeApply, 1)

  viewport.clientWidth = 960
  viewport.clientHeight = 540
  vm.handleResize()
  assert.equal(vm.scale, 0.5, '960x540 → 0.5')

  viewport.clientWidth = 3840
  viewport.clientHeight = 1080
  vm.handleResize()
  assert.equal(vm.scale, 1, '3840x1080 受高度限制 → 1（等比 contain）')

  viewport.clientWidth = 1920
  viewport.clientHeight = 540
  vm.handleResize()
  assert.equal(vm.scale, 0.5, '1920x540 受高度限制 → 0.5')
  assert.equal(vm.lifecycle.resizeApply, 4)
  assert.equal(env.state.addedListeners.filter((l) => l.type === 'resize').length, 1, 'resize 监听只注册一次')
})

// ============================== Screen.vue：30s 轮询与生命周期唯一拥有者（D2 整改） ==============================

test('Screen.vue mounted starts exactly one 30000ms poll; repeated mount does not duplicate (single owner)', () => {
  const mock = loadMock()
  const env = makeEnv('')
  const options = buildScreenOptions(mock, env)
  const vm = makeVm(options, { viewport: { clientWidth: 1920, clientHeight: 1080 } })

  options.mounted.call(vm)
  assert.equal(env.state.intervals.length, 1)
  assert.equal(env.state.intervals[0].delay, 30000, '轮询间隔必须为 30000ms（30 秒）')
  assert.equal(vm.lifecycle.pollStarted, 1)
  assert.equal(vm.pollIntervalMs, 30000)

  // 唯一拥有者：同一实例重复 mounted 不得再启动定时器 / 监听 / 主题
  options.mounted.call(vm)
  options.mounted.call(vm)
  assert.equal(env.state.intervals.length, 1)
  assert.equal(vm.lifecycle.pollStarted, 1)
  assert.equal(vm.lifecycle.themeApplied, 1)
  assert.equal(env.state.addedListeners.length, 1)

  // 调试句柄（synthetic，仅供浏览器自动化；非真实批准/接口）
  const handle = env.windowFake.__fbScreenFixture
  assert.ok(handle, 'mounted 后 window.__fbScreenFixture 必须存在')
  assert.equal(handle.isAlive, true)
  assert.equal(handle.POLL_INTERVAL_MS, 30000)
  assert.equal(handle.counters, vm.lifecycle, '句柄计数与组件计数同一对象（实时可读）')
})

test('Screen.vue poll tick (interval fn and debug hook) increments counters and mock stats', () => {
  const mock = loadMock()
  mock.resetMockRuntime()
  const env = makeEnv('')
  const options = buildScreenOptions(mock, env)
  const vm = makeVm(options, { viewport: { clientWidth: 1920, clientHeight: 1080 } })
  options.mounted.call(vm)

  // mounted 初始刷新计入 screenRefresh
  assert.equal(mock.mockState.requestStats.screenRefresh, 1)
  assert.equal(vm.stats.screenRefresh, 1)

  // 30s interval 到点（直接调用捕获的定时器函数，等价于定时器触发）
  env.state.intervals[0].fn()
  assert.equal(vm.lifecycle.pollTick, 1)
  assert.equal(mock.mockState.requestStats.screenRefresh, 2)
  assert.ok(vm.lastPollAt, 'lastPollAt 必须可观察')

  // 调试句柄复用同一处理函数（不伪造 interval）
  const handle = env.windowFake.__fbScreenFixture
  handle.debugPollTick()
  assert.equal(vm.lifecycle.pollTick, 2)
  assert.equal(mock.mockState.requestStats.screenRefresh, 3)
})

test('Screen.vue beforeDestroy clears owned timer, removes same listener, restores html class, deletes debug handle; idempotent', () => {
  const mock = loadMock()
  const env = makeEnv('root-class other')
  const options = buildScreenOptions(mock, env)
  const vm = makeVm(options, { viewport: { clientWidth: 1920, clientHeight: 1080 } })
  options.mounted.call(vm)

  const intervalId = env.state.intervals[0].id
  const addedResize = env.state.addedListeners.find((l) => l.type === 'resize')
  assert.ok(addedResize, 'mounted 必须注册 resize 监听')

  options.beforeDestroy.call(vm)
  assert.deepEqual(env.state.clearedIntervalIds, [intervalId], '销毁必须清除同一 30s 定时器')
  assert.equal(vm.lifecycle.pollCleared, 1)
  assert.equal(env.state.removedListeners.length, 1)
  assert.equal(env.state.removedListeners[0].type, 'resize')
  assert.equal(env.state.removedListeners[0].fn, addedResize.fn, '移除的必须是注册时的同一函数引用')
  assert.equal(vm.lifecycle.resizeUnbound, 1)
  assert.equal(env.html.className, 'root-class other', 'html className 必须精确还原挂载前状态')
  assert.equal(vm.lifecycle.themeRestored, 1)
  assert.equal(env.windowFake.__fbScreenFixture, undefined, '销毁后调试句柄必须删除（清理证据）')

  // 幂等：重复 destroy 不重复清理
  options.beforeDestroy.call(vm)
  assert.deepEqual(env.state.clearedIntervalIds, [intervalId])
  assert.equal(env.state.removedListeners.length, 1)
  assert.equal(vm.lifecycle.pollCleared, 1)
  assert.equal(vm.lifecycle.themeRestored, 1)
})

// ============================== 安装源码取证（仅显式 FBJS_DEPS_ROOT，无 fallback） ==============================

test('installed-source evidence: themeList values and panel-local theme has no CSS backing', { skip: SCREEN_BASE_SKIP_REASON }, () => {
  const root = screenBase.root

  // ScreenUtil.js themeList 必须包含本 fixture 用到的两个主题值（:2-47）
  const screenUtilSrc = fs.readFileSync(path.join(root, 'src', 'util', 'ScreenUtil.js'), 'utf8')
  const themeListBlock = screenUtilSrc.slice(
    screenUtilSrc.indexOf('const themeList'),
    screenUtilSrc.indexOf('// 路由过度列表')
  )
  const themeValues = Array.from(themeListBlock.matchAll(/value:\s*'([a-zA-Z-]+)'/g)).map((m) => m[1])
  assert.ok(themeValues.includes('sky-blue'), 'sky-blue 必须是 ScreenUtil.js themeList 真实值')
  assert.ok(themeValues.includes('midnight-blue'), 'midnight-blue 必须是 ScreenUtil.js themeList 真实值')

  // D1 反证：screen-panel.less 无任何 theme 相关选择器 → 不得宣称 Panel 局部主题
  const panelLess = fs.readFileSync(path.join(root, 'src', 'assets', 'styles', 'components', 'screen-panel.less'), 'utf8')
  assert.ok(!panelLess.includes('theme'), 'screen-panel.less 不应含 theme 选择器（本取证）')
  // 对照：ScreenPanel.vue 的确产出 screen-panel--theme-* 类名（prop 存在但无配套 CSS）
  const panelVue = fs.readFileSync(path.join(root, 'src', 'components', 'ScreenPanel.vue'), 'utf8')
  assert.ok(panelVue.includes('screen-panel--theme-'), 'ScreenPanel.vue 产出 theme 类名（无 CSS 依托）')
})

test('installed-source evidence: @topinfo/screen-base version pin is 1.0.81', { skip: SCREEN_BASE_SKIP_REASON }, () => {
  assert.equal(screenBase.pkg.name, '@topinfo/screen-base')
  assert.equal(screenBase.pkg.version, '1.0.81')
})
