/**
 * runtime-smoke 回放 harness 的 webpack 配置（fixture 专用，非产品构建配置）。
 *
 * 与 .validation-output/runtime-smoke/webpack.config.cjs 的差异：
 * - 输出固定到 <repoRoot>/.validation-output/runtime-smoke-replay（gitignore 内，
 *   生成物不进源码树 / 不进 fixtures）；
 * - 模块与 loader 一律从显式 FBJS_DEPS_ROOT 的 node_modules 解析，
 *   不依赖本目录 node_modules（无 junction），无任何硬编码盘符 fallback；
 * - 缺 env / 依赖根不完整时明确报错。
 */
const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const REPLAY_OUTPUT = path.join(REPO_ROOT, '.validation-output', 'runtime-smoke-replay')

const root = process.env.FBJS_DEPS_ROOT
if (!root) {
  throw new Error(
    'FBJS_DEPS_ROOT 未设置：请显式指定已验证应用依赖根（如目标工程根目录），例如 ' +
      'FBJS_DEPS_ROOT=<verified-app-root> node tests/fixtures/runtime-smoke/build.cjs' +
      '（本 harness 不依赖 node_modules junction，也不内置任何 fallback 路径）'
  )
}
const depsPackageJson = path.join(root, 'package.json')
if (!fs.existsSync(depsPackageJson)) {
  throw new Error(`FBJS_DEPS_ROOT 指向的目录不存在 package.json：${root}`)
}
const targetRequire = createRequire(depsPackageJson)
const VueLoaderPlugin = targetRequire('vue-loader/lib/plugin')

module.exports = {
  mode: 'development',
  // context 必须指向 FBJS_DEPS_ROOT：vue-loader 插件（plugin-webpack5.js:146 →
  // lib/compiler.js loadFromContext）以 config.context 为根 require.resolve
  // vue / vue-template-compiler；指向本 fixture 目录时向上无 node_modules 必失败
  //（原 .validation-output harness 是靠 node_modules junction 命中的，本 harness
  // 不使用 junction）。entry/alias 均为绝对路径，不受 context 变化影响。
  context: root,
  entry: path.join(__dirname, 'src/main.js'),
  output: { path: REPLAY_OUTPUT, filename: 'app.js', publicPath: '/' },
  resolve: {
    extensions: ['.js', '.vue', '.json'],
    symlinks: false,
    alias: { '@': path.join(__dirname, 'src'), 'vue$': path.join(root, 'node_modules/vue/dist/vue.esm.js') },
    modules: [path.join(root, 'node_modules')]
  },
  resolveLoader: { modules: [path.join(root, 'node_modules')] },
  module: {
    rules: [
      { test: /\.vue$/, loader: targetRequire.resolve('vue-loader'), options: { compiler: targetRequire('vue-template-compiler') } },
      {
        test: /\.m?js$/,
        use: { loader: targetRequire.resolve('babel-loader'), options: { babelrc: false, configFile: false, presets: [[targetRequire.resolve('@babel/preset-env'), { targets: { chrome: '80' } }]] } }
      },
      { test: /\.css$/, use: [targetRequire.resolve('vue-style-loader'), targetRequire.resolve('css-loader')] },
      { test: /\.less$/, use: [targetRequire.resolve('vue-style-loader'), targetRequire.resolve('css-loader'), { loader: targetRequire.resolve('less-loader'), options: { lessOptions: { javascriptEnabled: true, math: 'always' } } }] },
      { test: /\.(woff2?|ttf|eot|svg|png|jpe?g|gif)$/, type: 'asset/resource' }
    ]
  },
  plugins: [new VueLoaderPlugin()],
  devtool: false,
  performance: { hints: false },
  stats: 'errors-warnings'
}
