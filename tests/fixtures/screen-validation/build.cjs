/**
 * screen-validation fixture 构建入口（fixture 专用）。
 *
 * 用法：FB_SCREEN_DEPS_ROOT=<已验证应用依赖根> node tests/fixtures/screen-validation/build.cjs
 * - 输出到 <repoRoot>/.validation-output/release-validation/screen/（不污染源码树/fixtures）；
 * - webpack/vue-loader/babel/less 一律从 FB_SCREEN_DEPS_ROOT 的 node_modules 解析
 *   （只读使用，不安装依赖），缺 env 时明确报错退出；
 * - 构建日志（含 warnings）由调用方重定向保存到输出目录同级的 logs 文件。
 */
const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const SCREEN_OUTPUT = path.join(REPO_ROOT, '.validation-output', 'release-validation', 'screen')

const root = process.env.FB_SCREEN_DEPS_ROOT
if (!root) {
  process.stderr.write(
    'ERROR: FB_SCREEN_DEPS_ROOT 未设置。用法：FB_SCREEN_DEPS_ROOT=<已验证应用依赖根> ' +
      'node tests/fixtures/screen-validation/build.cjs（无 fallback 路径）\n'
  )
  process.exit(1)
}
const depsPackageJson = path.join(root, 'package.json')
if (!fs.existsSync(depsPackageJson)) {
  process.stderr.write(`ERROR: FB_SCREEN_DEPS_ROOT 指向的目录不存在 package.json：${root}\n`)
  process.exit(1)
}

const targetRequire = createRequire(depsPackageJson)
const webpack = targetRequire('webpack')
const config = require('./webpack.config.cjs')

webpack(config, (error, stats) => {
  if (error) {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
    return
  }
  process.stdout.write(
    `${stats.toString({ colors: false, all: false, errors: true, warnings: true, timings: true })}\n`
  )
  if (stats.hasErrors()) {
    process.exitCode = 1
    return
  }
  fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(config.output.path, 'index.html'))
  process.stdout.write(
    `PASS: isolated screen validation build with actual installed FB screen-base@1.0.81 / fb-third@1.1.810 / fb-ui@1.1.840\n` +
      `output: ${config.output.path}\n`
  )
})
