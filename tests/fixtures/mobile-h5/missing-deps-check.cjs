/**
 * mobile-h5 missing-check fixture（最小可复现，依赖缺失检查器）。
 *
 * 用途：mew-manage-app-ui（uni-app 移动端）的五个锁定包在依赖恢复失败时，
 * 用本脚本以真实 exit code 复现「依赖缺失」这一事实，不伪造任何构建/运行结果。
 *
 * 用法：FB_MOBILE_DEPS_ROOT=<已恢复依赖根（含 node_modules）> node tests/fixtures/mobile-h5/missing-deps-check.cjs
 * - 无 fallback 路径：env 未设置 → exit 2（用法错误）；
 * - 逐包核对 name+version 与锁定版本一致；任一缺失/不符 → exit 1 并精确列出；
 * - 全部符合 → exit 0（此时上层 H5 构建链才允许继续）。
 *
 * 边界声明：
 * - 只读检查：不联网、不安装、不写任何文件、不启动构建/服务；
 * - 锁定版本来自移动端 package-lock.json resolved（内部仓库 http://10.10.0.37:4873），
 *   与 tests/mobile-runtime.test.cjs 的静态断言一致；版本不匹配按缺失处理（禁止替代版本）；
 * - 本 fixture 是合成验证件，不代表任何真实业务批准或 H5/native 验收结论。
 */
'use strict'

const fs = require('fs')
const path = require('path')

// 五个锁定包 + vue-template-compiler（vue 2.7.16 必须与编译器同版本）
const PINS = [
  { name: 'vue', version: '2.7.16' },
  { name: 'vue-template-compiler', version: '2.7.16' },
  { name: '@topinfoapp/ta-ui', version: '0.1.170' },
  { name: '@topinfoapp/ta-js', version: '0.0.18' },
  { name: '@topinfoapp/ta-theme', version: '0.1.18' },
  { name: '@dcloudio/uni-h5', version: '2.0.1-alpha-36920221121001' },
]

const root = process.env.FB_MOBILE_DEPS_ROOT
if (!root) {
  process.stderr.write(
    'ERROR: FB_MOBILE_DEPS_ROOT 未设置。用法：FB_MOBILE_DEPS_ROOT=<已恢复依赖根> ' +
      'node tests/fixtures/mobile-h5/missing-deps-check.cjs（无 fallback 路径，缺失即 exit 2）\n'
  )
  process.exit(2)
}

const missing = []
for (const pin of PINS) {
  const pkgPath = path.join(root, 'node_modules', ...pin.name.split('/'), 'package.json')
  let installed = null
  try {
    installed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  } catch {
    missing.push(`${pin.name}@${pin.version}（未安装：${pkgPath}）`)
    continue
  }
  if (installed.name !== pin.name || installed.version !== pin.version) {
    missing.push(
      `${pin.name}@${pin.version}（版本不符：实际 ${installed.name}@${installed.version}，禁止以其他版本替代）`
    )
  }
}

if (missing.length) {
  process.stderr.write(
    `MISSING: FB_MOBILE_DEPS_ROOT=${root} 缺少 ${missing.length}/${PINS.length} 个锁定依赖：\n` +
      missing.map((item) => `  - ${item}`).join('\n') + '\n' +
      '依赖未恢复：TA 真实 API / 合成 TA 页面 / uni H5 隔离构建全部 NOT-RUN，不得当作 H5 通过。\n'
  )
  process.exit(1)
}

process.stdout.write(
  `OK: FB_MOBILE_DEPS_ROOT=${root} 下 ${PINS.length}/${PINS.length} 个锁定依赖版本全部一致` +
    '（vue 2.7.16 / vue-template-compiler 2.7.16 / ta-ui 0.1.170 / ta-js 0.0.18 / ta-theme 0.1.18 / uni-h5 2.0.1-alpha-36920221121001）\n'
)
process.exit(0)
