import Vue from 'vue'
import FbUI from 'fb-ui/src/index.js'
import TpDialog from '@topinfo/tp-components/src/components/tp-dialog/tp-dialog.vue'
import ScreenPanel from '@topinfo/screen-base/src/components/ScreenPanel.vue'
import ScreenPanelLeft from '@topinfo/screen-base/src/components/ScreenPanelLeft.vue'
import List from './List.vue'
import Screen from './Screen.vue'

Vue.use(FbUI)
Vue.component('TpDialog', TpDialog)
Vue.component('ScreenPanel', ScreenPanel)
Vue.component('ScreenPanelLeft', ScreenPanelLeft)
Vue.config.productionTip = false

window.__fixtureErrors = []
Vue.config.errorHandler = (error, component, info) => {
  window.__fixtureErrors.push({ message: error.message, info })
  console.error(error)
}
window.addEventListener('error', event => window.__fixtureErrors.push({ message: event.message }))
window.app = {
  $datax: { get() { return null }, set() {} },
  $store: { state: { menu: { flatMenus: [] } } },
  $message: Vue.prototype.$message
}

new Vue({
  data: () => ({ showScreen: false }),
  render(h) {
    return h('div', { attrs: { id: 'fb-skill-fixture' }, style: { height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' } }, [
      h('div', { style: { padding: '12px', background: '#eaf4ff', display: 'flex', gap: '12px', flexShrink: 0 } }, [
        h('strong', 'MOCK 运行演练，非真实接口 / 非真实业务批准'),
        h('button', { on: { click: () => { this.showScreen = !this.showScreen } } }, this.showScreen ? '切换到列表' : '切换到大屏')
      ]),
      h('main', { style: { flex: '1', minHeight: 0, overflow: 'auto' } }, [h(this.showScreen ? Screen : List)])
    ])
  }
}).$mount('#root')
