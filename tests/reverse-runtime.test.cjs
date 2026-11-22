/**
 * reverse-runtime.test.cjs —— reverse-requirements 独立 build/serve/config fixture 的回归测试（node:test）。
 *
 * 边界声明（与批准计划一致）：
 * - 全部为 synthetic 隔离回归：合成 Vue SFC 只写入 os.tmpdir 的临时工作区，
 *   不是公告页面、不是业务源码、不产生任何真实用户批准或身份。
 * - 目标依赖根来自本地候选 case（evals/reverse-requirements/smsnotice/contracts.json
 *   → runtime.projectRoot）；只读取该 root 下包元数据与公共构建库，不读业务 src/密钥/.env。
 * - 缺依赖源时相关测试显式 skip 并给出理由（无硬编码 fallback 路径）。
 * - 测试不安装包、不联网、不改目标 node_modules；只清理自己 mkdtemp 的目录。
 * - E 接口（checkGeneration/startGeneration/freezeGeneration）由 eval 脚本并行实现；
 *   未就绪时集成用例显式 skip，配置层用例（createConfig）不依赖 E，始终运行。
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const http = require('http')
const crypto = require('crypto')
const { spawnSync } = require('child_process')

const REPO_ROOT = path.resolve(__dirname, '..')
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'reverse-requirements')
const EVAL_SCRIPT = path.join(REPO_ROOT, 'scripts', 'eval-reverse-requirements.cjs')
const E = require(EVAL_SCRIPT)
const W = require(path.join(REPO_ROOT, 'skills', 'create-fb-feature', 'scripts', 'workflow.cjs'))
const F = require(path.join(REPO_ROOT, 'skills', 'create-fb-feature', 'scripts', 'lib', 'files.cjs'))

// ---- 目标依赖根：来自本地候选 case 的 contracts.runtime（单一事实来源，无 fallback） ----

function readRealTarget() {
  const caseContracts = path.join(REPO_ROOT, 'evals', 'reverse-requirements', 'smsnotice', 'contracts.json')
  let runtime
  try {
    runtime = JSON.parse(fs.readFileSync(caseContracts, 'utf8')).runtime
  } catch (error) {
    return { skip: `真实 case contracts.json 不可读（${error.message}）：目标工具链用例跳过` }
  }
  const projectRoot = runtime && runtime.projectRoot
  const expectedVersions = { ...((runtime && runtime.packages) || {}), ...((runtime && runtime.buildTooling) || {}) }
  if (!projectRoot || !fs.existsSync(path.join(projectRoot, 'package.json'))) {
    return { skip: `case runtime.projectRoot 不存在：${projectRoot}（目标工具链用例跳过，无 fallback）` }
  }
  for (const name of ['webpack', 'vue-loader', 'vue-template-compiler']) {
    if (!fs.existsSync(path.join(projectRoot, 'node_modules', name))) {
      return { skip: `目标依赖根缺少 ${name}：独立构建测试显式跳过（不安装、不替代）` }
    }
  }
  return { projectRoot, expectedVersions }
}

const realTarget = readRealTarget()
const TARGET_SKIP = realTarget.skip || false

// ---- 合成工作区：极简 synthetic Vue SFC，只存在于 os.tmpdir ----

function makeWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-reverse-runtime-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src', 'main.js'), 'export default {}\n')
  return root
}

// ============================== createConfig（独立公开只读边界，不依赖 E） ==============================

test('createConfig builds a single inline-bundle webpack4 config from the approved target toolchain', { skip: TARGET_SKIP }, t => {
  const workspace = makeWorkspace(t)
  const { createConfig } = require(path.join(FIXTURE_DIR, 'webpack.config.cjs'))
  const { config, toolchain } = createConfig({
    workspace,
    output: path.join(workspace, 'dist'),
    dependencyRoot: realTarget.projectRoot,
    expectedVersions: realTarget.expectedVersions
  })

  // 固定产物形状：单 bundle /app.js + publicPath / + 无 devtool
  assert.equal(config.output.filename, 'app.js')
  assert.equal(config.output.publicPath, '/')
  assert.equal(config.devtool, false)
  assert.equal(config.entry, path.join(workspace, 'src', 'main.js'))
  assert.equal(config.resolve.alias['@'], path.join(workspace, 'src'), 'installed dialogs must resolve @ only into the isolated workspace')

  // 单 bundle：禁 splitChunks/runtimeChunk，LimitChunkCountPlugin(maxChunks:1)
  assert.equal(config.optimization.splitChunks, false)
  assert.equal(config.optimization.runtimeChunk, false)
  const chunkPlugin = config.plugins.find(plugin => plugin.constructor.name === 'LimitChunkCountPlugin')
  assert.ok(chunkPlugin, '必须显式注册 LimitChunkCountPlugin')
  assert.equal(chunkPlugin.options.maxChunks, 1)
  assert.ok(config.plugins.some(plugin => plugin.constructor.name === 'VueLoaderPlugin'), '必须注册 VueLoaderPlugin')

  // 不用 webpack5 asset modules；url-loader 关闭 file 输出 fallback（limit:true 全内联）
  for (const rule of config.module.rules) {
    assert.ok(!rule.type || !String(rule.type).startsWith('asset/'), '不得使用 asset/resource 等 webpack5 asset modules')
  }
  const assetRule = config.module.rules.find(rule => rule.loader && /url-loader/.test(rule.loader))
  assert.ok(assetRule, '必须显式声明 url-loader 资源内联规则')
  assert.equal(assetRule.options.limit, true)

  // 工具链版本与已批准 contracts.runtime 一致；解析结果全部落在目标 root 的 node_modules 内
  const expected = realTarget.expectedVersions
  assert.equal(toolchain.versions.webpack, expected.webpack)
  assert.equal(toolchain.versions['vue-loader'], expected['vue-loader'])
  assert.equal(toolchain.versions.vue, expected.vue)
  const nodeModulesReal = fs.realpathSync(path.join(realTarget.projectRoot, 'node_modules'))
  for (const [name, resolved] of Object.entries(toolchain.resolved)) {
    const real = fs.realpathSync(resolved)
    assert.ok(real.startsWith(nodeModulesReal + path.sep), `${name} 必须解析到目标 root 内：${real}`)
  }
})

test('createConfig refuses an approved-version mismatch and a dependency root without package.json', { skip: TARGET_SKIP }, t => {
  const workspace = makeWorkspace(t)
  const { createConfig } = require(path.join(FIXTURE_DIR, 'webpack.config.cjs'))
  const base = { workspace, output: path.join(workspace, 'dist'), dependencyRoot: realTarget.projectRoot }

  assert.throws(
    () => createConfig({ ...base, expectedVersions: { ...realTarget.expectedVersions, webpack: '9.9.9' } }),
    error => error.code === 'TOOL_VERSION_MISMATCH'
  )
  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-reverse-emptyroot-'))
  t.after(() => fs.rmSync(emptyRoot, { recursive: true, force: true }))
  assert.throws(
    () => createConfig({ ...base, dependencyRoot: emptyRoot, expectedVersions: realTarget.expectedVersions }),
    error => error.code === 'DEPENDENCY_ROOT_INVALID'
  )
})

test('createConfig checks public FB package versions as well as build tools', { skip: TARGET_SKIP }, t => {
  const workspace = makeWorkspace(t)
  const { createConfig } = require(path.join(FIXTURE_DIR, 'webpack.config.cjs'))
  assert.throws(() => createConfig({ workspace, output: path.join(workspace, 'dist'), dependencyRoot: realTarget.projectRoot, expectedVersions: { ...realTarget.expectedVersions, 'fb-ui': '0.0.0' } }), error => error.code === 'TOOL_VERSION_MISMATCH')
})

test('createConfig disables disk caches and never reads target-side babel/postcss config', { skip: TARGET_SKIP }, t => {
  const workspace = makeWorkspace(t)
  const { createConfig } = require(path.join(FIXTURE_DIR, 'webpack.config.cjs'))
  const { config } = createConfig({
    workspace,
    output: path.join(workspace, 'dist'),
    dependencyRoot: realTarget.projectRoot,
    expectedVersions: realTarget.expectedVersions
  })
  assert.equal(config.cache, false)
  const babelRule = config.module.rules.find(rule => rule.use && /babel-loader/.test(rule.use.loader))
  assert.ok(babelRule, 'js 规则必须走 babel-loader')
  assert.equal(babelRule.use.options.babelrc, false)
  assert.equal(babelRule.use.options.configFile, false)
  assert.equal(babelRule.use.options.cacheDirectory, false)
})

// ============================== build.cjs：CLI 严格性 + 未就绪时拒绝且无输出 ==============================

test('build CLI requires explicit --project-root/--id/--round and has no auto-approve channel', () => {
  const cli = path.join(FIXTURE_DIR, 'build.cjs')
  const missingRound = spawnSync(process.execPath, [cli, '--project-root', REPO_ROOT, '--id', 'some-id'], { encoding: 'utf8' })
  assert.equal(missingRound.status, 2)
  assert.match((missingRound.stderr || '') + (missingRound.stdout || ''), /round/)

  const badRound = spawnSync(process.execPath, [cli, '--project-root', REPO_ROOT, '--id', 'some-id', '--round', 'third'], { encoding: 'utf8' })
  assert.equal(badRound.status, 2)

  const yes = spawnSync(process.execPath, [cli, '--project-root', REPO_ROOT, '--id', 'some-id', '--round', 'first', '--yes'], { encoding: 'utf8' })
  assert.equal(yes.status, 2, '不得存在 --yes / fixture 自动批准通道')
})

test('runBuild refuses an unprepared project and writes no output', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-reverse-unprepared-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const { runBuild } = require(path.join(FIXTURE_DIR, 'build.cjs'))
  await assert.rejects(() => runBuild({ projectRoot: root, id: 'unprepared', round: 'third' }), error => error.code === 'BAD_ROUND')
  await assert.rejects(
    () => runBuild({ projectRoot: root, id: 'unprepared', round: 'first' }),
    error => typeof error.code === 'string' && error.code !== 'BAD_ROUND'
  )
  assert.equal(fs.existsSync(path.join(root, '.validation-output')), false, '拒绝时不得创建任何输出目录')
})

// ============================== serve.cjs：CLI 严格性 + 未就绪时拒绝且不绑定端口 ==============================

test('serve CLI requires explicit --project-root/--id/--round and has no auto-approve channel', () => {
  const cli = path.join(FIXTURE_DIR, 'serve.cjs')
  const missingId = spawnSync(process.execPath, [cli, '--project-root', REPO_ROOT, '--round', 'first'], { encoding: 'utf8' })
  assert.equal(missingId.status, 2)
  assert.match((missingId.stderr || '') + (missingId.stdout || ''), /--id/)

  const badRound = spawnSync(process.execPath, [cli, '--project-root', REPO_ROOT, '--id', 'some-id', '--round', 'zero'], { encoding: 'utf8' })
  assert.equal(badRound.status, 2)

  const yes = spawnSync(process.execPath, [cli, '--project-root', REPO_ROOT, '--id', 'some-id', '--round', 'first', '--yes'], { encoding: 'utf8' })
  assert.equal(yes.status, 2, '不得存在 --yes 自动批准通道')
})

test('startServer refuses an unprepared project and never binds a port', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-reverse-serve-refuse-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const { startServer } = require(path.join(FIXTURE_DIR, 'serve.cjs'))
  await assert.rejects(
    () => startServer({ projectRoot: root, id: 'unprepared', round: 'first', port: 18799 }),
    error => typeof error.code === 'string' && error.code !== 'BAD_ROUND'
  )
  await assert.rejects(
    () => startServer({ projectRoot: root, id: 'unprepared', round: 'zero', port: 18799 }),
    error => error.code === 'BAD_ROUND'
  )
  assert.equal(fs.existsSync(path.join(root, '.validation-output')), false, '拒绝时不得创建任何输出')
})

// ============================== 集成引导：合成 4 文档 case + W.recordApproval + E 生成接口 ==============================

const TOOL_FILES = ['build.cjs', 'webpack.config.cjs', 'serve.cjs', 'index.html']
const BOOT_ID = 'boot-generation'

// 极简 synthetic Vue SFC（只写入 tmp 工作区；非公告页面，亦非 runtime-smoke 业务源码）
const SYNTHETIC_SRC = {
  'src/main.js': "import Vue from 'vue'\nimport App from './App.vue'\nimport { syntheticDevices } from './mock.js'\n\nnew Vue({\n  el: '#app',\n  render (h) { return h(App, { props: { devices: syntheticDevices() } }) }\n})\n",
  'src/App.vue': "<template>\n  <div class=\"reverse-fixture-app\">\n    <h1 class=\"app-title\">{{ title }}</h1>\n    <ul class=\"device-list\">\n      <li v-for=\"item in devices\" :key=\"item.id\" :class=\"item.online ? 'is-online' : 'is-offline'\">{{ item.name }}</li>\n    </ul>\n  </div>\n</template>\n<script>\nexport default {\n  name: 'ReverseFixtureApp',\n  props: { devices: { type: Array, default () { return [] } } },\n  data () { return { title: 'Synthetic build fixture (not a real page)' } }\n}\n</script>\n<style lang=\"less\">\n@fixture-accent: #10566a;\n.reverse-fixture-app {\n  .app-title { color: @fixture-accent; }\n  .device-list {\n    list-style: none;\n    .is-online { color: #1a7f37; }\n    .is-offline { color: #a40e26; }\n  }\n}\n</style>\n",
  'src/mock.js': "export function syntheticDevices () {\n  return [\n    { id: 'SYN-0001', name: 'Synthetic Device One', online: true },\n    { id: 'SYN-0002', name: 'Synthetic Device Two', online: false }\n  ]\n}\n"
}

function findFreeLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

/**
 * 临时根内引导一个已批准的生成工作流：
 * - 4 份合成 case 文档（requirements/contracts/acceptance/evidence），runtime 指向真实目标根；
 * - 4 个 fixture 工具文件复制进临时根同路径（prepare 按 content hash 绑定）；
 * - W.recordApproval 用既有回归合成操作人（非当前用户批准，fixture 标记一律被 W 拒绝）。
 */
function bootApprovedGeneration(t, port, htmlOverride) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-reverse-boot-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const caseDir = 'evals/reverse-requirements/bootcase'
  fs.mkdirSync(path.join(root, caseDir), { recursive: true })
  const targetPackage = fs.readFileSync(path.join(realTarget.projectRoot, 'package.json'))
  fs.writeFileSync(path.join(root, caseDir, 'requirements.md'), '# Synthetic boot requirement\n\n## R01 Fixture screen\nShow a synthetic title and two devices.\n')
  fs.writeFileSync(path.join(root, caseDir, 'contracts.json'), JSON.stringify({
    schemaVersion: 1,
    caseId: 'boot-case',
    runtime: {
      projectRoot: realTarget.projectRoot,
      packages: { vue: realTarget.expectedVersions.vue, 'vue-template-compiler': realTarget.expectedVersions['vue-template-compiler'] },
      buildTooling: { webpack: realTarget.expectedVersions.webpack, 'vue-loader': realTarget.expectedVersions['vue-loader'] },
      policy: 'Isolated regression scope pinned to the public runtime contract; no package installation.'
    },
    rules: [{ id: 'C01', requirementIds: ['R01'], description: 'Synthetic page renders two devices with inline styles' }],
    decisions: []
  }))
  fs.writeFileSync(path.join(root, caseDir, 'acceptance.json'), JSON.stringify({
    schemaVersion: 1,
    caseId: 'boot-case',
    checks: [{ id: 'A01', requirementIds: ['R01'], contractIds: ['C01'], evidenceSourceIds: ['source-package'], description: 'Synthetic app bundle builds and serves', layer: 'mock-browser', critical: true }]
  }))
  fs.writeFileSync(path.join(root, caseDir, 'evidence.json'), JSON.stringify({
    schemaVersion: 1,
    caseId: 'boot-case',
    sources: [{ id: 'source-package', root: realTarget.projectRoot, path: 'package.json', sha256: crypto.createHash('sha256').update(targetPackage).digest('hex'), bytes: targetPackage.length }],
    unknowns: ['Real business pages are never built in this fixture']
  }))
  const toolDir = path.join(root, 'tests', 'fixtures', 'reverse-requirements')
  fs.mkdirSync(toolDir, { recursive: true })
  for (const name of TOOL_FILES) fs.copyFileSync(path.join(FIXTURE_DIR, name), path.join(toolDir, name))
  if (htmlOverride) fs.writeFileSync(path.join(toolDir, 'index.html'), htmlOverride)

  const prepared = E.prepareEvaluation({
    projectRoot: root,
    caseDir,
    id: BOOT_ID,
    generation: {
      schemaVersion: 1,
      caseId: 'boot-case',
      dependencyRoot: realTarget.projectRoot,
      sources: ['src/main.js', 'src/App.vue', 'src/mock.js'],
      evidenceFiles: ['evidence/read-scope.json'],
      host: '127.0.0.1',
      port
    }
  })
  // 隔离回归合成批准（既有测试同一形态）；绝不写当前用户身份
  W.recordApproval({
    projectRoot: root,
    id: BOOT_ID,
    planHash: prepared.planHash,
    operator: { schema: 'fb-feature-identity/v1', status: 'confirmed', name: '隔离回归员', confirmation: { method: 'user-message', sourceRef: 'temporary-regression-identity', text: '确认', confirmedAt: '2026-01-01T00:00:00.000Z' } },
    evidence: { kind: 'user-message', reference: 'temporary-regression-approval', text: '同意按此方案执行' }
  })
  return { root, prepared }
}

function roundBasePath(root, round) {
  return path.join(root, '.validation-output', 'reverse-requirements', BOOT_ID, round)
}

test('synthetic approval boot produces an approved workspace holding public inputs only', { skip: TARGET_SKIP }, t => {
  if (typeof E.startGeneration !== 'function') {
    t.skip('E.startGeneration 未实现（eval 脚本并行实现中）：引导用例显式跳过')
  }
  const { root } = bootApprovedGeneration(t, 18733)
  const checked = E.checkGeneration({ projectRoot: root, id: BOOT_ID, round: 'first', stage: 'start' })
  assert.equal(checked.ready, true, '批准后 start 阶段就绪：' + JSON.stringify(checked.blockers))

  // scope 已绑定 4 个 fixture 工具文件的 content hash
  assert.deepEqual(checked.context.toolHashes.map(tool => path.posix.basename(tool.path)).sort(), [...TOOL_FILES].sort())
  assert.equal(checked.context.host, '127.0.0.1')
  assert.equal(checked.context.port, 18733)

  const started = E.startGeneration({ projectRoot: root, id: BOOT_ID, round: 'first' })
  assert.equal(started.ok, true)
  const workspace = started.workspace
  assert.deepEqual(fs.readdirSync(path.join(workspace, 'inputs')).sort(), ['contracts.json', 'requirements.md'], '只写公开输入副本')
  assert.equal(fs.existsSync(path.join(workspace, 'src')), false, 'startGeneration 不得写业务源码')
  assert.equal(fs.existsSync(checked.context.output), false, 'startGeneration 不得创建 dist')
})

const FREEZE_READY = typeof E.freezeGeneration === 'function'
const INTEGRATION_SKIP = TARGET_SKIP || (FREEZE_READY ? false : 'E.freezeGeneration 未实现（eval 脚本并行实现中）：build/serve 集成用例显式跳过')

async function bootFrozenBuild(t) {
  const port = await findFreeLoopbackPort()
  const { root } = bootApprovedGeneration(t, port)
  const workspace = E.startGeneration({ projectRoot: root, id: BOOT_ID, round: 'first' }).workspace
  for (const [relative, content] of Object.entries(SYNTHETIC_SRC)) {
    const file = path.join(workspace, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  fs.mkdirSync(path.join(roundBasePath(root, 'first'), 'evidence'), { recursive: true })
  fs.writeFileSync(path.join(roundBasePath(root, 'first'), 'evidence', 'read-scope.json'), JSON.stringify({ schemaVersion: 1, nature: 'synthetic-read-scope', allowed: ['package.json'] }))
  E.freezeGeneration({ projectRoot: root, id: BOOT_ID, round: 'first' })
  const checked = E.checkGeneration({ projectRoot: root, id: BOOT_ID, round: 'first', stage: 'build' })
  assert.equal(checked.ready, true, '冻结后 build 阶段就绪：' + JSON.stringify(checked.blockers))
  return { root, checked, port }
}

test('approved synthetic generation builds exactly index.html + app.js and the report is verifiable', { skip: INTEGRATION_SKIP }, async t => {
  const { root, checked } = await bootFrozenBuild(t)
  const { runBuild } = require(path.join(FIXTURE_DIR, 'build.cjs'))

  const result = await runBuild({ projectRoot: root, id: BOOT_ID, round: 'first' })
  const failureDetail = fs.existsSync(result.report) ? JSON.parse(fs.readFileSync(result.report, 'utf8')).errors : ['build-report.json 未写']
  assert.equal(result.ok, true, '构建应成功，真实错误：' + JSON.stringify(failureDetail))
  assert.deepEqual(fs.readdirSync(result.dist).sort(), ['app.js', 'index.html'], 'dist 只允许固定两产物')

  const report = JSON.parse(fs.readFileSync(result.report, 'utf8'))
  assert.equal(report.status, 'success')
  assert.equal(report.exitCode, 0)
  // bundle 是合成 SFC 的真实编译产物：组件/mock/less 变量编译后内联（无 CSS 抽取文件）
  const appJsText = fs.readFileSync(path.join(result.dist, 'app.js'), 'utf8')
  assert.match(appJsText, /ReverseFixtureApp/, 'bundle 含合成组件')
  assert.match(appJsText, /Synthetic Device One/, 'bundle 含合成 mock')
  assert.match(appJsText, /10566a/, 'less 变量编译进内联样式')
  const servedHtml = fs.readFileSync(path.join(result.dist, 'index.html'), 'utf8')
  assert.ok(!/src="https?:\/\//.test(servedHtml) && !/href="https?:\/\//.test(servedHtml), '自有 HTML 不加载 CDN/真实 HTTP')
  assert.equal(report.hash, F.hashObject(F.withoutHash(report)), '报告 hash 自洽')
  assert.equal(report.inputHash, checked.inputHash)
  assert.equal(report.planHash, checked.planHash)
  assert.equal(report.scopeHash, checked.scopeHash)
  const manifest = JSON.parse(fs.readFileSync(checked.context.sourceManifest, 'utf8'))
  assert.equal(report.sourceManifestHash, manifest.hash)
  assert.deepEqual(report.assets.map(asset => asset.path).sort(), ['app.js', 'index.html'])
  for (const asset of report.assets) {
    const content = fs.readFileSync(path.join(result.dist, asset.path))
    assert.equal(content.length, asset.bytes)
    assert.equal(crypto.createHash('sha256').update(content).digest('hex'), asset.sha256)
  }

  // 同 round 不可覆盖：第二次构建被拒绝且已写报告不变
  const before = report.hash
  await assert.rejects(() => runBuild({ projectRoot: root, id: BOOT_ID, round: 'first' }), error => error.code === 'BUILD_OUTPUT_EXISTS')
  assert.equal(JSON.parse(fs.readFileSync(result.report, 'utf8')).hash, before, '已写报告未被改动')
})

test('a second build cannot run while the first round is compiling', { skip: INTEGRATION_SKIP }, async t => {
  const { root } = await bootFrozenBuild(t)
  const { runBuild } = require(path.join(FIXTURE_DIR, 'build.cjs'))
  const first = runBuild({ projectRoot: root, id: BOOT_ID, round: 'first' })
  await assert.rejects(() => runBuild({ projectRoot: root, id: BOOT_ID, round: 'first' }), error => error.code === 'BUILD_OUTPUT_EXISTS')
  assert.equal((await first).ok, true)
})

test('source drift while webpack is compiling cannot produce a passing report', { skip: INTEGRATION_SKIP }, async t => {
  const { root, checked } = await bootFrozenBuild(t)
  const { runBuild } = require(path.join(FIXTURE_DIR, 'build.cjs'))
  const pending = runBuild({ projectRoot: root, id: BOOT_ID, round: 'first' })
  fs.appendFileSync(path.join(checked.context.workspace, 'src/main.js'), '\n// changed during asynchronous build\n')
  const result = await pending
  assert.equal(result.ok, false)
  const report = JSON.parse(fs.readFileSync(result.report, 'utf8'))
  assert.equal(report.exitCode, 1)
  assert.ok(report.errors.some(error => /SOURCE_CHANGED/.test(error)))
  assert.equal(W.readWorkflow({ projectRoot: root, id: BOOT_ID }).status, 'blocked')
})

test('serving refuses a hardlinked log instead of appending outside its scope', { skip: INTEGRATION_SKIP }, async t => {
  const { root, checked } = await bootFrozenBuild(t)
  const { runBuild } = require(path.join(FIXTURE_DIR, 'build.cjs'))
  const { startServer } = require(path.join(FIXTURE_DIR, 'serve.cjs'))
  await runBuild({ projectRoot: root, id: BOOT_ID, round: 'first' })
  const outside = path.join(root, 'unmanaged-log.txt')
  fs.writeFileSync(outside, 'Keep this text unchanged\n')
  fs.linkSync(outside, checked.context.serveLog)
  await assert.rejects(async () => {
    const handle = await startServer({ projectRoot: root, id: BOOT_ID, round: 'first' })
    handle.close()
  }, error => error.code === 'HARDLINK_REFUSED')
  assert.equal(fs.readFileSync(outside, 'utf8'), 'Keep this text unchanged\n')
})

test('a short build-report write is a failure rather than a completed build', { skip: INTEGRATION_SKIP }, async t => {
  const { root } = await bootFrozenBuild(t)
  const { runBuild } = require(path.join(FIXTURE_DIR, 'build.cjs'))
  const original = fs.writeSync
  t.mock.method(fs, 'writeSync', function(fd, content, ...args) {
    if (String(content).includes('isolated-fixture-build-not-production-acceptance')) return original.call(fs, fd, String(content).slice(0, 16))
    return original.call(fs, fd, content, ...args)
  })
  await assert.rejects(() => runBuild({ projectRoot: root, id: BOOT_ID, round: 'first' }), error => error.code === 'BUILD_WRITE_FAILED')
  assert.equal(W.readWorkflow({ projectRoot: root, id: BOOT_ID }).status, 'blocked')
})

test('a frozen entry cannot import source files outside its workspace and public packages', { skip: INTEGRATION_SKIP }, async t => {
  const port = await findFreeLoopbackPort()
  const { root } = bootApprovedGeneration(t, port)
  const workspace = E.startGeneration({ projectRoot: root, id: BOOT_ID, round: 'first' }).workspace
  const outside = path.join(root, 'unmanaged.js')
  fs.writeFileSync(outside, 'export default "must not be bundled"\n')
  for (const [relative, content] of Object.entries(SYNTHETIC_SRC)) {
    const file = path.join(workspace, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, relative === 'src/main.js' ? `import outside from ${JSON.stringify(outside.split(path.sep).join('/'))}\nconsole.log(outside)\n` + content : content)
  }
  E.freezeGeneration({ projectRoot: root, id: BOOT_ID, round: 'first' })
  const { runBuild } = require(path.join(FIXTURE_DIR, 'build.cjs'))
  const result = await runBuild({ projectRoot: root, id: BOOT_ID, round: 'first' })
  assert.equal(result.ok, false)
  const report = JSON.parse(fs.readFileSync(result.report, 'utf8'))
  assert.ok(report.errors.some(error => /MODULE_OUTSIDE_SCOPE/.test(error)))
})

test('a syntax failure stays a failed build report and cannot be served', { skip: INTEGRATION_SKIP }, async t => {
  const port = await findFreeLoopbackPort()
  const { root } = bootApprovedGeneration(t, port)
  const workspace = E.startGeneration({ projectRoot: root, id: BOOT_ID, round: 'first' }).workspace
  for (const [relative, content] of Object.entries(SYNTHETIC_SRC)) {
    const file = path.join(workspace, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, relative === 'src/main.js' ? 'export const broken = ;\n' : content)
  }
  E.freezeGeneration({ projectRoot: root, id: BOOT_ID, round: 'first' })
  const { runBuild } = require(path.join(FIXTURE_DIR, 'build.cjs'))
  const { startServer } = require(path.join(FIXTURE_DIR, 'serve.cjs'))
  const result = await runBuild({ projectRoot: root, id: BOOT_ID, round: 'first' })
  assert.equal(result.ok, false)
  const report = JSON.parse(fs.readFileSync(result.report, 'utf8'))
  assert.equal(report.exitCode, 1)
  assert.ok(report.errors.length > 0)
  await assert.rejects(() => startServer({ projectRoot: root, id: BOOT_ID, round: 'first' }), error => error.code === 'BUILD_REPORT_NOT_SUCCESS')
  assert.throws(() => E.recordResult({ projectRoot: root, id: BOOT_ID, round: 'first', result: { checks: [{ id: 'A01', status: 'pass', evidence: 'A failed build cannot be passed' }] } }), error => error.code === 'BUILD_NOT_VERIFIED')
})

test('a repaired round builds separately without changing the original snapshot', { skip: INTEGRATION_SKIP }, async t => {
  const { root, checked } = await bootFrozenBuild(t)
  const { runBuild } = require(path.join(FIXTURE_DIR, 'build.cjs'))
  const first = await runBuild({ projectRoot: root, id: BOOT_ID, round: 'first' })
  const originalReport = fs.readFileSync(first.report)
  E.recordResult({ projectRoot: root, id: BOOT_ID, round: 'first', result: { checks: [{ id: 'A01', status: 'fail', detail: 'Synthetic user-visible mismatch, not a real notice page' }] } })
  const workspace = E.startGeneration({ projectRoot: root, id: BOOT_ID, round: 'repaired' }).workspace
  for (const [relative, content] of Object.entries(SYNTHETIC_SRC)) {
    const file = path.join(workspace, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  E.freezeGeneration({ projectRoot: root, id: BOOT_ID, round: 'repaired' })
  const repaired = await runBuild({ projectRoot: root, id: BOOT_ID, round: 'repaired' })
  assert.equal(repaired.ok, true)
  const recorded = E.recordResult({ projectRoot: root, id: BOOT_ID, round: 'repaired', result: { checks: [{ id: 'A01', status: 'pass', evidence: 'Synthetic repair build evidence' }] } })
  assert.equal(recorded.status, 'pass')
  assert.deepEqual(fs.readFileSync(first.report), originalReport)
  assert.equal(JSON.parse(fs.readFileSync(repaired.report, 'utf8')).inputHash, checked.inputHash)
})

test('changed first-build log prevents reusing that recorded round as a repair baseline', { skip: INTEGRATION_SKIP }, async t => {
  const { root, checked } = await bootFrozenBuild(t)
  const { runBuild } = require(path.join(FIXTURE_DIR, 'build.cjs'))
  await runBuild({ projectRoot: root, id: BOOT_ID, round: 'first' })
  E.recordResult({ projectRoot: root, id: BOOT_ID, round: 'first', result: { checks: [{ id: 'A01', status: 'fail', detail: 'Synthetic first observation' }] } })
  fs.appendFileSync(checked.context.buildLog, 'changed first-build narrative\n')
  assert.throws(() => E.startGeneration({ projectRoot: root, id: BOOT_ID, round: 'repaired' }), error => error.code === 'GENERATION_NOT_READY')
})

test('a build refuses to execute a different harness copy from the approved tool bytes', { skip: INTEGRATION_SKIP }, async t => {
  const port = await findFreeLoopbackPort()
  const { root } = bootApprovedGeneration(t, port, '<div>Approved alternate shell</div>')
  const workspace = E.startGeneration({ projectRoot: root, id: BOOT_ID, round: 'first' }).workspace
  for (const [relative, content] of Object.entries(SYNTHETIC_SRC)) {
    const file = path.join(workspace, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  E.freezeGeneration({ projectRoot: root, id: BOOT_ID, round: 'first' })
  const { runBuild } = require(path.join(FIXTURE_DIR, 'build.cjs'))
  await assert.rejects(() => runBuild({ projectRoot: root, id: BOOT_ID, round: 'first' }), error => error.code === 'TOOL_COPY_MISMATCH')
})

test('recording while a build is in progress does not seal an incomplete first round', { skip: INTEGRATION_SKIP }, async t => {
  const { root } = await bootFrozenBuild(t)
  const { runBuild } = require(path.join(FIXTURE_DIR, 'build.cjs'))
  const pending = runBuild({ projectRoot: root, id: BOOT_ID, round: 'first' })
  try {
    assert.throws(() => E.recordResult({ projectRoot: root, id: BOOT_ID, round: 'first', result: { checks: [{ id: 'A01', status: 'fail', detail: 'Cannot seal before compilation finishes' }] } }), error => error.code === 'BUILD_IN_PROGRESS')
  } finally {
    assert.equal((await pending).ok, true)
  }
})

test('the static server serves exactly the reported assets and rejects everything else', { skip: INTEGRATION_SKIP }, async t => {
  const { root, port } = await bootFrozenBuild(t)
  const { runBuild } = require(path.join(FIXTURE_DIR, 'build.cjs'))
  const { startServer } = require(path.join(FIXTURE_DIR, 'serve.cjs'))
  await runBuild({ projectRoot: root, id: BOOT_ID, round: 'first' })
  const report = JSON.parse(fs.readFileSync(path.join(roundBasePath(root, 'first'), 'build-report.json'), 'utf8'))
  const dist = report.dist
  const appJsOriginal = fs.readFileSync(path.join(dist, 'app.js'))

  const handle = await startServer({ projectRoot: root, id: BOOT_ID, round: 'first' })
  t.after(() => handle.close())
  assert.equal(handle.port, port, '绑定批准 scope 端口')

  const request = (method, requestPath) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: requestPath, agent: false }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.once('error', reject)
    req.end()
  })

  const index = await request('GET', '/')
  assert.equal(index.status, 200)
  assert.match(index.headers['content-type'], /text\/html/)
  assert.ok(index.body.equals(fs.readFileSync(path.join(dist, 'index.html'))), 'GET / 返回 dist/index.html 原字节')
  assert.equal((await request('GET', '/index.html')).status, 200)

  const appJs = await request('GET', '/app.js')
  assert.equal(appJs.status, 200)
  const reported = report.assets.find(asset => asset.path === 'app.js')
  assert.equal(crypto.createHash('sha256').update(appJs.body).digest('hex'), reported.sha256)
  const head = await request('HEAD', '/app.js')
  assert.equal(head.status, 200)
  assert.equal(head.body.length, 0)
  assert.ok(Number(head.headers['content-length']) > 0, 'HEAD 带 Content-Length')

  // 精确清单之外一律拒绝：未列路径、目录穿越（原文与编码变体）、API 形态
  for (const [method, requestPath, expected] of [
    ['GET', '/missing.js', 403],
    ['GET', '/deep/nested', 403],
    ['GET', '/../app.js', 403],
    ['GET', '/%2e%2e/app.js', 403],
    ['GET', '/app.js%3f', 403],
    ['GET', '/api/status', 403],
    ['POST', '/', 405],
    ['PUT', '/app.js', 405]
  ]) {
    const response = await request(method, requestPath)
    assert.equal(response.status, expected, `${method} ${requestPath} → ${expected}`)
  }

  // 端口占用即报错，不扫描
  await assert.rejects(() => startServer({ projectRoot: root, id: BOOT_ID, round: 'first' }), error => error.code === 'SERVE_PORT_IN_USE')

  // 响应前重核资产 hash：磁盘被改动 → 500；恢复 → 200
  fs.writeFileSync(path.join(dist, 'app.js'), Buffer.concat([appJsOriginal, Buffer.from('\n// tampered\n')]))
  assert.equal((await request('GET', '/app.js')).status, 500)
  fs.writeFileSync(path.join(dist, 'app.js'), appJsOriginal)
  assert.equal((await request('GET', '/app.js')).status, 200)
})

test('build and serve CLIs run end-to-end against the frozen synthetic round', { skip: INTEGRATION_SKIP }, async t => {
  const { spawn } = require('child_process')
  const port = await findFreeLoopbackPort()
  const { root } = bootApprovedGeneration(t, port)
  const workspace = E.startGeneration({ projectRoot: root, id: BOOT_ID, round: 'first' }).workspace
  for (const [relative, content] of Object.entries(SYNTHETIC_SRC)) {
    const file = path.join(workspace, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  fs.mkdirSync(path.join(roundBasePath(root, 'first'), 'evidence'), { recursive: true })
  fs.writeFileSync(path.join(roundBasePath(root, 'first'), 'evidence', 'read-scope.json'), JSON.stringify({ schemaVersion: 1, nature: 'synthetic-read-scope' }))
  E.freezeGeneration({ projectRoot: root, id: BOOT_ID, round: 'first' })

  const built = spawnSync(process.execPath, [path.join(FIXTURE_DIR, 'build.cjs'), '--project-root', root, '--id', BOOT_ID, '--round', 'first'], { encoding: 'utf8' })
  assert.equal(built.status, 0, (built.stderr || '') + (built.stdout || ''))
  assert.equal(JSON.parse(built.stdout).ok, true)

  const child = spawn(process.execPath, [path.join(FIXTURE_DIR, 'serve.cjs'), '--project-root', root, '--id', BOOT_ID, '--round', 'first'], { stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(() => { try { child.kill() } catch (error) { /* 已退出则忽略 */ } })
  const served = await new Promise((resolve, reject) => {
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.once('error', reject)
    const attempt = () => {
      if (!out.includes('available at')) {
        setTimeout(attempt, 100)
        return
      }
      const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: '/app.js', agent: false }, res => {
        const chunks = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }))
      })
      req.once('error', reject)
      req.end()
    }
    attempt()
  })
  assert.equal(served.status, 200)
  assert.ok(served.body.length > 0, 'CLI 启动的服务返回 app.js 真实字节')
  child.kill()
})
