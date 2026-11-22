/**
 * main.js —— screen-validation fixture 引导页（synthetic，非真实业务）。
 *
 * 边界声明（fixture 级 mock 边界，全部显式）：
 * - window.app 为最小宿主桩：真实 jquery（app.$）+ 最小 $datax 存取器。
 *   真实应用中由 fb-core Application 提供；本 fixture 不引入 fb-core Application
 *   （其依赖路由/服务/项目配置），只保留 ScreenUtil 依赖的最小表面。
 * - 其余全部为已安装框架真实代码：fb-ui 1.1.840、fb-third 1.1.810（真实 echarts
 *   5.6.0 与 initThemes）、@topinfo/screen-base 1.0.81（全量 install + 真实
 *   ScreenUtil 类）、框架主题样式 theme/*.less。
 * - 不连接任何真实接口 / 真实地图瓦片 / 真实视频服务；数据全部来自 mock.js。
 */
import Vue from 'vue'
import $ from 'jquery'
import FbUI from 'fb-ui/src/index.js'
import FbThird from 'fb-third/src/index.js'
import ScreenBase, { ScreenUtil } from '@topinfo/screen-base'
import { FbecMapBase } from 'fb-third'
import ScreenValidation from './ScreenValidation.vue'

// 框架主题样式：真实 screen-base theme/*.less（html.theme-* 选择器 + jpx-* 组件规则）
import '@topinfo/screen-base/src/assets/styles/index.less'

Vue.config.productionTip = false

window.__fixtureErrors = []
Vue.config.errorHandler = (error, component, info) => {
  window.__fixtureErrors.push({ message: error.message, info })
  console.error(error)
}
window.addEventListener('error', (event) => window.__fixtureErrors.push({ message: event.message }))

// 最小宿主桩（ScreenUtil 依赖的最小表面：jQuery + $datax）
window.app = {
  $,
  $datax: {
    store: {},
    get(key) { return this.store[key] },
    set(key, value) { this.store[key] = value },
  },
}

Vue.use(FbUI)
Vue.use(FbThird, {
  echarts: {
    theme: {
      defaultUse: 'fbecDark',
    },
  },
})
Vue.use(ScreenBase)
// 真实大屏地图模型（fb-third 导出，真实页面按需局部注册；本页用合成 geoJSON）
Vue.component('FbecMapBase', FbecMapBase)

// 真实 ScreenUtil（安装源码 @topinfo/screen-base/src/util/ScreenUtil.js）
const screenUtil = new ScreenUtil({
  container: '#app',
  width: 1920,
  height: 1080,
  mode: 'adapt',
  theme: 'midnight-blue',
  dev: false,
})
window.app.$screenUtil = screenUtil
Vue.prototype.$screenUtil = screenUtil

new Vue({
  render: (h) => h(ScreenValidation),
}).$mount('#fb-screen-root')
