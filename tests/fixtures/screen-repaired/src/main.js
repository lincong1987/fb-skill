/**
 * main.js —— screen-repaired fixture 引导页（synthetic，非真实业务）。
 *
 * 与 screen-validation fixture（首轮证据，保持不动）的差异：
 * 1. wrapper 组件持有页面组件的 alive 生命周期，提供明确的「卸载验证 / 重新挂载」
 *    按钮（真实 $destroy 路径 + beforeDestroy 清理计数经事件上报到 wrapper 渲染）；
 * 2. 页面组件对真实 calcScale 的调用加了视口守卫（视口为 0 时不调用，防止
 *    scale(0) 毒化首帧 —— 首轮 zoom=0.0000 幽灵态的诱因之一），calcScale 本身
 *    仍是真实 ScreenUtil 方法，不改其内部计算；
 * 3. 真实 ScreenPanel 显式传组件自有公开 prop transition-name（绕过框架默认
 *    zoom-center-to-corner enter 动画 —— 首轮该 0.3s 过渡在自动化环境被冻结在
 *    ~10% 进度，panel 内容呈幽灵态）。这是 fixture 级显式选择，非框架修改。
 *
 * 边界声明（与 screen-validation 相同）：
 * - window.app 为最小宿主桩（真实 jquery app.$ + 最小 $datax）；
 * - 其余全部为已安装框架真实代码：fb-ui 1.1.840、fb-third 1.1.810（echarts 5.6.0）、
 *   @topinfo/screen-base 1.0.81 全量 install + 真实 ScreenUtil；
 * - 框架主题样式 index.less（theme/*.less）真实引入，html.theme-* 视觉来自框架；
 * - 不连接任何真实接口 / 地图 / 视频服务；数据全部来自 mock.js。
 */
import Vue from 'vue'
import $ from 'jquery'
import FbUI from 'fb-ui/src/index.js'
import FbThird from 'fb-third/src/index.js'
import ScreenBase, { ScreenUtil } from '@topinfo/screen-base'
import { FbecMapBase } from 'fb-third'
import ScreenRepaired from './ScreenRepaired.vue'

// 框架主题样式：真实 screen-base theme/*.less（html.theme-* 选择器 + jpx-* 组件规则）
import '@topinfo/screen-base/src/assets/styles/index.less'

Vue.config.productionTip = false

window.__fixtureErrors = []
window.__fixtureWarnings = []
Vue.config.errorHandler = (error, component, info) => {
  window.__fixtureErrors.push({ message: error.message, info })
  console.error(error)
}
// Vue unknown tag / 提示类警告不走 errorHandler（attempt-01 装配 bug 的观察点），
// warnHandler 统一收集到 __fixtureWarnings，供主会话实测「无未注册组件警告」
Vue.config.warnHandler = (msg, vm, trace) => {
  window.__fixtureWarnings.push({ message: msg, trace })
  console.warn(msg, trace)
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

/**
 * Wrapper 组件：持有页面组件的挂载/卸载生命周期。
 * - 「卸载验证」走真实 $destroy（触发页面组件 beforeDestroy 清理链）；
 * - 页面组件销毁前经 destroyed 事件上报最终清理计数，wrapper 渲染留证；
 * - 「重新挂载」重建页面组件（isAlive 翻转），可重复验证。
 */
const Wrapper = {
  name: 'ScreenRepairedWrapper',
  // attempt-02 装配修复：ScreenRepaired 必须真实注册（attempt-01 缺本行导致
  // <screen-repaired> 为 unknown tag，页面只剩控制条、__fbScreenRepaired 不存在）
  components: { ScreenRepaired },
  data() {
    return {
      isAlive: true,
      destroyedReport: null,
    }
  },
  methods: {
    handleDestroyed(report) {
      this.destroyedReport = report
    },
    unmountPage() {
      this.isAlive = false
    },
    remountPage() {
      this.destroyedReport = null
      this.isAlive = true
    },
  },
  template: `
    <div class="repaired-wrapper">
      <div class="repaired-controls" data-testid="repaired-controls">
        <fb-button size="s" @on-click="unmountPage" data-testid="btn-unmount">卸载验证（真实 $destroy）</fb-button>
        <fb-button size="s" @on-click="remountPage" data-testid="btn-remount">重新挂载</fb-button>
        <span class="repaired-controls__state" data-testid="alive-state">{{ isAlive ? '已挂载（alive=true）' : '已卸载（alive=false）' }}</span>
        <span v-if="destroyedReport" class="repaired-controls__report" data-testid="destroyed-report">
          卸载清理计数：轮询 cleared={{ destroyedReport.pollCleared }}，resize unbound={{ destroyedReport.resizeUnbound }}，
          theme restored={{ destroyedReport.themeRestored }}，句柄已删除={{ destroyedReport.handleDeleted ? '是' : '否' }}
        </span>
      </div>
      <screen-repaired v-if="isAlive" @destroyed="handleDestroyed"></screen-repaired>
    </div>
  `,
}

new Vue({
  render: (h) => h(Wrapper),
}).$mount('#fb-screen-root')
