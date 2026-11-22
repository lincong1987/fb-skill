/**
 * reverse-requirements fixture 的 webpack 配置工厂（只读、可独立测试，不依赖 E 接口）。
 *
 * createConfig({ workspace, output, dependencyRoot, expectedVersions }) → { config, toolchain }
 * - 全部构建工具通过 createRequire(目标 package.json) 从目标依赖根解析；解析结果必须
 *   realpath 落在该 root 的 node_modules 内（不安装、不替代、不允许目标 root 之外的依赖）；
 * - expectedVersions（来自已批准 contracts.runtime.packages + buildTooling）中列出的工具
 *   版本逐一比对，不匹配即 TOOL_VERSION_MISMATCH；
 * - 不执行目标 vue.config/project/babel/postcss 配置（babelrc/configFile 关闭），不落磁盘缓存；
 * - 单 bundle：LimitChunkCountPlugin(maxChunks:1) + splitChunks:false；publicPath /；
 *   devtool false；不用 webpack5 asset modules——资源经目标 url-loader 全量内联
 *   （limit:true，file-loader fallback 永不触发）；FBUI/TP CSS 与页面样式统一
 *   走 vue-style-loader 内联，无任何 CSS 抽取插件。
 */
const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const NEEDED_TOOLS = [
  'webpack', 'vue-loader', 'vue-template-compiler', 'vue',
  'babel-loader', '@babel/core', '@babel/preset-env',
  'css-loader', 'vue-style-loader', 'less-loader', 'less', 'url-loader'
]

function toolError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function isDirectory(dir) {
  return typeof dir === 'string' && path.isAbsolute(dir) && fs.existsSync(dir) && fs.statSync(dir).isDirectory()
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 从模块文件向上定位其所属 package.json（name 必须与请求名一致，跨多级目录也成立）
function packageInfoFor(moduleFile, name) {
  let dir = path.dirname(moduleFile)
  for (;;) {
    const pkgPath = path.join(dir, 'package.json')
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
      if (pkg.name === name) return { version: pkg.version }
    }
    const parent = path.dirname(dir)
    if (parent === dir) throw toolError('TOOL_MISSING', '无法定位 package.json：' + moduleFile)
    dir = parent
  }
}

function createConfig(options) {
  const o = options || {}
  if (!isDirectory(o.workspace)) throw toolError('WORKSPACE_INVALID', 'workspace 必须是已存在的绝对路径目录：' + o.workspace)
  if (typeof o.output !== 'string' || !path.isAbsolute(o.output)) throw toolError('OUTPUT_INVALID', 'output 必须是绝对路径：' + o.output)
  if (typeof o.dependencyRoot !== 'string' || !fs.existsSync(path.join(o.dependencyRoot, 'package.json'))) {
    throw toolError('DEPENDENCY_ROOT_INVALID', 'dependencyRoot 必须是含 package.json 的目标依赖根：' + o.dependencyRoot)
  }
  const expectedVersions = o.expectedVersions && typeof o.expectedVersions === 'object' ? o.expectedVersions : {}

  const dependencyRootReal = fs.realpathSync(o.dependencyRoot)
  const nodeModules = path.join(dependencyRootReal, 'node_modules')
  const targetRequire = createRequire(path.join(o.dependencyRoot, 'package.json'))

  const resolved = {}
  const versions = {}
  const checkedVersions = {}
  for (const name of new Set([...NEEDED_TOOLS, ...Object.keys(expectedVersions)])) {
    let moduleFile
    try {
      moduleFile = targetRequire.resolve(name)
    } catch (error) {
      throw toolError('TOOL_MISSING', '目标依赖根缺少 ' + name + '（只允许目标 root 内实际依赖，不安装不替代）：' + error.message)
    }
    const real = fs.realpathSync(moduleFile)
    if (!real.startsWith(nodeModules + path.sep)) {
      throw toolError('TOOL_OUTSIDE_TARGET', name + ' 解析到目标 root 之外，拒绝使用：' + real)
    }
    const info = packageInfoFor(real, name)
    resolved[name] = real
    versions[name] = info.version
    const expected = Object.prototype.hasOwnProperty.call(expectedVersions, name) ? expectedVersions[name] : null
    checkedVersions[name] = { actual: info.version, expected }
    if (expected !== null && expected !== info.version) {
      throw toolError('TOOL_VERSION_MISMATCH', name + ' 版本与批准契约不符：批准 ' + expected + '，目标实际 ' + info.version)
    }
  }
  if (!/^4\./.test(versions.webpack)) throw toolError('TOOL_VERSION_MISMATCH', '本配置只支持目标 webpack 4.x，实际 ' + versions.webpack)
  if (!/^15\./.test(versions['vue-loader'])) throw toolError('TOOL_VERSION_MISMATCH', '本配置只支持 vue-loader 15.x，实际 ' + versions['vue-loader'])
  if (!/^2\./.test(versions.vue) || versions.vue !== versions['vue-template-compiler']) throw toolError('TOOL_VERSION_MISMATCH', 'Vue 2 与模板编译器必须使用相同版本')

  const entry = path.join(o.workspace, 'src', 'main.js')
  if (!fs.existsSync(entry)) throw toolError('ENTRY_MISSING', '工作区入口缺失：' + entry)

  const webpackModule = targetRequire('webpack')
  const VueLoaderPlugin = targetRequire('vue-loader/lib/plugin')
  const compiler = targetRequire('vue-template-compiler')
  const vueEsm = fs.realpathSync(targetRequire.resolve('vue/dist/vue.esm.js'))
  if (!vueEsm.startsWith(nodeModules + path.sep)) throw toolError('TOOL_OUTSIDE_TARGET', 'Vue 完整构建解析到目标根之外')
  const nodeModulesRule = new RegExp(escapeRegExp(nodeModules + path.sep))

  const config = {
    mode: 'production',
    // context 必须指向目标依赖根：vue-loader 15 的 VueLoaderPlugin（plugin-webpack4.js →
    // lib/compiler.js loadFromContext）以 config.context 为根 require.resolve
    // vue-template-compiler；指向 tmp 工作区时向上无 node_modules 必失败。
    // entry/alias/output 均为绝对路径，不受 context 影响；裸模块解析由 resolve.modules 钉死。
    context: dependencyRootReal,
    entry,
    output: { path: o.output, filename: 'app.js', publicPath: '/', hashFunction: 'sha256' },
    resolve: {
      extensions: ['.js', '.vue', '.json'],
      symlinks: false,
      alias: { 'vue$': vueEsm, '@': path.join(o.workspace, 'src') },
      modules: [nodeModules]
    },
    resolveLoader: { symlinks: false, modules: [nodeModules] },
    module: {
      rules: [
        { test: /\.vue$/, loader: resolved['vue-loader'], options: { compiler } },
        {
          test: /\.m?js$/,
          exclude: nodeModulesRule,
          use: {
            loader: resolved['babel-loader'],
            options: {
              babelrc: false,
              configFile: false,
              cacheDirectory: false,
              presets: [[resolved['@babel/preset-env'], { targets: { chrome: '80' } }]]
            }
          }
        },
        { test: /\.css$/, use: [resolved['vue-style-loader'], resolved['css-loader']] },
        {
          test: /\.less$/,
          use: [
            resolved['vue-style-loader'],
            resolved['css-loader'],
            { loader: resolved['less-loader'], options: { lessOptions: { javascriptEnabled: true, math: 'always' } } }
          ]
        },
        { test: /\.(png|jpe?g|gif|svg|woff2?|eot|ttf|otf)$/, loader: resolved['url-loader'], options: { limit: true, esModule: false } }
      ]
    },
    plugins: [
      new VueLoaderPlugin(),
      new webpackModule.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
      {
        apply(compilerInstance) {
          compilerInstance.hooks.normalModuleFactory.tap('ReverseScope', factory => {
            factory.hooks.afterResolve.tap('ReverseScope', data => {
              if (!data || !data.resource) return data
              const resource = fs.realpathSync(data.resource.split('?')[0])
              const workspaceReal = fs.realpathSync(o.workspace)
              if (!resource.startsWith(workspaceReal + path.sep) && !resource.startsWith(nodeModules + path.sep)) throw toolError('MODULE_OUTSIDE_SCOPE', 'MODULE_OUTSIDE_SCOPE: 编译依赖越过工作区和公共安装包范围：' + resource)
              return data
            })
          })
        }
      }
    ],
    optimization: { splitChunks: false, runtimeChunk: false, minimize: false },
    cache: false,
    devtool: false,
    performance: { hints: false },
    stats: 'errors-warnings'
  }

  return {
    config,
    toolchain: { dependencyRoot: dependencyRootReal, nodeModules, resolved, versions, checkedVersions }
  }
}

module.exports = { createConfig }
