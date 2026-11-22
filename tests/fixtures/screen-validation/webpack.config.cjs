/**
 * screen-validation fixture 的 webpack 配置（fixture 专用独立配置，非产品构建配置）。
 *
 * 与 tests/fixtures/runtime-smoke/webpack.config.cjs 的关系：
 * - 模式一致：模块与 loader 一律从显式 FB_SCREEN_DEPS_ROOT 的 node_modules 解析
 *   （只读使用，不安装依赖），无 junction、无硬编码盘符 fallback；
 * - 独立差异：输出固定到 <repoRoot>/.validation-output/release-validation/screen/
 *   （gitignore 生成物目录），并启用 less（框架主题 theme/*.less 需要）与
 *   图片/字体资源 loader（screen-shell 背景、面板切图、iconfont）。
 * - 本文件不修改、不调用仓库既有 eval/approval/case 工具。
 */
const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const SCREEN_OUTPUT = path.join(REPO_ROOT, '.validation-output', 'release-validation', 'screen')

const root = process.env.FB_SCREEN_DEPS_ROOT ? path.resolve(process.env.FB_SCREEN_DEPS_ROOT) : process.env.FB_SCREEN_DEPS_ROOT
if (!root) {
  throw new Error(
    'FB_SCREEN_DEPS_ROOT 未设置：请显式指定已验证应用依赖根（如目标工程根目录），例如 ' +
      'FB_SCREEN_DEPS_ROOT=<verified-app-root> node tests/fixtures/screen-validation/build.cjs' +
      '（本 harness 不依赖 node_modules junction，也不内置任何 fallback 路径）'
  )
}
const depsPackageJson = path.join(root, 'package.json')
if (!fs.existsSync(depsPackageJson)) {
  throw new Error(`FB_SCREEN_DEPS_ROOT 指向的目录不存在 package.json：${root}`)
}
const targetRequire = createRequire(depsPackageJson)
const VueLoaderPlugin = targetRequire('vue-loader/lib/plugin')
// FB_SCREEN_DEPS_ROOT 为 @vue/cli-service 4.5 工程（webpack 4.47）：
// 无 asset modules（webpack 5 特性），字体/图片用其自带的 file-loader。
const fileLoader = targetRequire.resolve('file-loader')

module.exports = {
  mode: 'development',
  // context 必须指向 FB_SCREEN_DEPS_ROOT：vue-loader 以 config.context 为根 require.resolve
  // vue / vue-template-compiler（与 runtime-smoke harness 相同的约束）
  context: root,
  entry: path.join(__dirname, 'src/main.js'),
  output: { path: SCREEN_OUTPUT, filename: 'app.js', publicPath: '/' },
  resolve: {
    extensions: ['.js', '.vue', '.json'],
    symlinks: false,
    alias: {
      'vue$': path.join(root, 'node_modules/vue/dist/vue.esm.js'),
      // fb-ui FbDialog.vue:476 含动态 import(`@/views${url}`) 上下文（vue-cli 默认
      // '@'→src 别名在真实应用生效）。本 fixture 不挂 FbDialog 路由弹窗，指向
      // fixture 内空 views 桩目录，仅为让该动态 import 上下文可解析（永不执行）。
      '@': path.join(__dirname, 'src', 'alias-stub'),
    },
    modules: [path.join(root, 'node_modules')],
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
      { test: /\.(woff2?|ttf|eot|svg|png|jpe?g|gif)$/i, use: { loader: fileLoader, options: { esModule: false, name: 'assets/[name].[hash:8].[ext]' } } }
    ]
  },
  plugins: [new VueLoaderPlugin()],
  devtool: false,
  performance: { hints: false },
  stats: 'errors-warnings'
}
