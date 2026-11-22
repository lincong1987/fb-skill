<template>
  <div id="app" class="screen-shell" :style="shellStyle">
    <!-- 静态 MOCK 横幅 -->
    <div class="mock-banner">{{ MOCK_BANNER }}</div>

    <div class="screen-toolbar">
      <fb-button size="s" @on-click="handleToggleTheme">切换主题（真实 ScreenUtil.setTheme）</fb-button>
      <fb-button size="s" @on-click="handleRefresh">刷新数据</fb-button>
      <fb-button size="s" @on-click="handleApplyScale">重算缩放（真实 calcScale，视口守卫）</fb-button>
      <div class="screen-toolbar__meta">
        <div data-testid="theme-line">
          主题机制：html.theme-{{ theme }}（ScreenUtil.setTheme 真实覆写，视觉为框架
          screen-base theme/*.less，非 fixture 自定义 CSS）
        </div>
        <div data-testid="scale-line">
          缩放：mode={{ mode }}，datax.zoom={{ dataxZoom || '—' }}，canvas={{ canvasWidth }}x{{ canvasHeight }}，
          修复说明：panel 已显式传真实公开 prop transition-name 绕过默认 enter 动画
        </div>
        <div data-testid="lifecycle-line">
          生命周期计数：轮询={{ lifecycle.pollTick }} 次（间隔 {{ pollIntervalMs / 1000 }}s，
          started={{ lifecycle.pollStarted }}/cleared={{ lifecycle.pollCleared }}），
          resize={{ lifecycle.resizeApply }} 次（bound={{ lifecycle.resizeBound }}/unbound={{ lifecycle.resizeUnbound }}），
          theme={{ lifecycle.themeApplied }} 次（restored={{ lifecycle.themeRestored }}），
          最近轮询 {{ lastPollAt || '—' }}
        </div>
        <div data-testid="mock-line">
          MOCK 统计：total={{ stats.total }}，online={{ stats.online }}，offline={{ stats.offline }}，
          refresh={{ stats.screenRefresh }}
        </div>
        <div data-testid="chart-status-line">
          图表实测：canvas={{ chartStatus.canvasCount }}，可见={{ chartStatus.visibleCount }}，
          panelBody.opacity={{ chartStatus.panelBodyOpacity }}
        </div>
      </div>
    </div>

    <!-- 真实 screen-panel（@topinfo/screen-base@1.0.81 全量 install 注册）。
         修复点：显式传组件自有公开 prop transition-name（ScreenPanel.vue:97-101），值为
         无 CSS 依托的固定名 —— Vue2 检测零时长过渡立即完成，panel 内容不再被框架默认
         zoom-center-to-corner enter 动画（fb-ui pc3 transition.less:272-282，
         enter=opacity:0+scale(0)）冻在自动化环境的中间态。声明：这是 fixture 级显式
         选择（首轮取证根因），不修改安装源码、不伪造组件。 -->
    <screen-panel
      title="资源趋势（MOCK 真实 echarts）"
      :left="24"
      :top="120"
      :width="900"
      :height="480"
      transition-name="fb-screen-repaired-none"
    >
      <fb-echarts
        class="chart-box"
        :options="chartOptions"
        theme="fbecDark"
        :autoresize="true"
      ></fb-echarts>
    </screen-panel>

    <!-- 真实地图模型（fb-third FbecMapBase）：mapJson 为 owner 可 mock 边界，
         注入合成 geoJSON，不连接真实地图服务。 -->
    <screen-panel
      title="区域分布（MOCK 合成 geoJSON）"
      :left="948"
      :top="120"
      :width="900"
      :height="480"
      transition-name="fb-screen-repaired-none"
    >
      <fbec-map-base
        class="chart-box"
        :map-json="syntheticMapJson"
        theme="fbecDark"
        :autoresize="true"
      ></fbec-map-base>
    </screen-panel>

    <!-- 框架主题视觉锚点：真实 fb-ui 输入框（jpx-input 类名），
         框架主题 less（html.theme-* .jpx-input 规则）会真实着色。 -->
    <div class="theme-anchor" data-testid="theme-anchor">
      <fb-input placeholder="框架主题视觉锚点（jpx-input）" :width="320"></fb-input>
    </div>
  </div>
</template>

<script>
import { MOCK_BANNER, POLL_INTERVAL_MS, mockState, screenMock, syntheticMapJson } from './mock.js'

/**
 * ScreenRepaired.vue —— screen-repaired fixture 大屏页（synthetic，非真实业务）。
 *
 * 与 screen-validation（首轮证据，保持不动）的差异（取证根因对应）：
 * - 根因：真实 ScreenPanel 默认过渡 zoom-center-to-corner（fb-ui pc3
 *   transition.less:272-282，enter=opacity:0+transform:scale(0)，时长 0.3s）在
 *   自动化环境（挂载时视口 0 → 真实 calcScale 产出 scale(0) 的 #app，随后窗口
 *   激活/resize 的时序竞争）被冻结在中间态 —— 首轮截图两处 ~10% 缩放/透明度
 *   幽灵（rect 非零但不可见）。
 * - 修复 1：显式传 ScreenPanel 自有公开 prop transition-name（组件默认 '' 时走
 *   transitions.zoomCenterToCorner），本页传无 CSS 依托的固定名 → Vue2 零时长
 *   检测立即完成 → panel 内容直接可见；
 * - 修复 2：真实 calcScale 仅在 window.innerWidth/innerHeight > 0 时触发（视口
 *   守卫，防止 scale(0) 毒化首帧；calcScale 本身仍是真实 ScreenUtil 方法）；
 * - 修复 3：图表渲染实测——getChartStatus() 返回 echarts/FbecMapBase canvas
 *   数量、尺寸与父链 computed opacity（不仅 bundle 含名，要求真实渲染）。
 *
 * 生命周期（唯一拥有者，与首轮一致）：
 * - 本组件是 30s 轮询定时器与 window resize 监听的唯一拥有者；
 * - beforeDestroy 清理：clearInterval、removeEventListener、还原 html 主题类、
 *   将 window.__fbScreenRepaired 替换为销毁报告快照（isAlive=false，供主会话
 *   读取清理证据）；重新挂载时由新实例重建完整句柄；
 * - 卸载入口：wrapper（main.js）「卸载验证」按钮走真实 $destroy。
 * - 已知边界（安装源码取证）：真实 ScreenPanel.vue mounted 向 $screenUtil 注册
 *   'screen.theme' 监听且 beforeDestroy 不注销（ScreenPanel.vue:460-484），
 *   本 fixture 不修改安装源码、不伪造其清理行为。
 */
const DESIGN_WIDTH = 1920
const DESIGN_HEIGHT = 1080

/** ScreenPanel 公开 prop transition-name 的 fixture 固定值（无 CSS 依托 → 立即完成） */
const PANEL_TRANSITION_NAME = 'fb-screen-repaired-none'

/** ScreenUtil.js:2-47 themeList 中的真实全局主题值（本轮取证） */
const THEME_A = 'midnight-blue'
const THEME_B = 'sky-blue'

export default {
  name: 'ScreenRepaired',

  data() {
    return {
      MOCK_BANNER,
      mockInfo: mockState,
      syntheticMapJson,
      stats: { total: 0, online: 0, offline: 0, screenRefresh: 0 },
      theme: window.app && window.app.$screenUtil ? window.app.$screenUtil.getTheme() : THEME_A,
      mode: window.app && window.app.$screenUtil ? window.app.$screenUtil.getMode() : 'adapt',
      canvasWidth: DESIGN_WIDTH,
      canvasHeight: DESIGN_HEIGHT,
      dataxZoom: '',
      pollIntervalMs: POLL_INTERVAL_MS,
      lastPollAt: '',
      // 图表渲染实测（mounted 后填充；渲染在工具栏可观察）
      chartStatus: { canvasCount: 0, visibleCount: 0, panelBodyOpacity: '' },
      lifecycle: {
        pollStarted: 0,
        pollTick: 0,
        pollCleared: 0,
        resizeBound: 0,
        resizeUnbound: 0,
        resizeApply: 0,
        themeApplied: 0,
        themeRestored: 0,
      },
    }
  },

  computed: {
    shellStyle() {
      // screen-shell 类提供框架尺寸/背景（screen-shell.less），此处只补透明度
      return { opacity: 1 }
    },
    chartOptions() {
      return {
        tooltip: { trigger: 'axis' },
        grid: { left: 48, right: 24, top: 32, bottom: 32 },
        xAxis: { type: 'category', data: ['MOCK-1', 'MOCK-2', 'MOCK-3', 'MOCK-4', 'MOCK-5'] },
        yAxis: { type: 'value' },
        series: [
          {
            name: 'MOCK 趋势（合成）',
            type: 'line',
            data: this.stats ? [12, 20, 15, 8 + (this.stats.screenRefresh % 7), 18] : [12, 20, 15, 8, 18],
            smooth: true,
          },
        ],
      }
    },
    // 说明：FbecMapBase 内部默认 opt 以 mapName='zj' 注册/渲染（FbecMapBase.vue:18-19、
    // data().opt.geo.map），mapJson prop 即 owner mock 边界 —— 本页只注入合成 geoJSON，
    // 不覆写其内部 series（覆写自定义 map 名会指向未注册地图）。
  },

  mounted() {
    // 唯一拥有者守卫：同一实例不重复启动轮询/监听
    if (this._screenOwnerStarted) {
      return
    }
    this._screenOwnerStarted = true

    // 记录挂载时的 html className，销毁时精确还原（不污染其他页面）
    this._screenHtmlClassName = document.documentElement
      ? document.documentElement.className
      : ''

    // Vue2 methods 经 initMethods 绑定到实例：add/remove 用同一引用
    window.addEventListener('resize', this.handleResize)
    this.lifecycle.resizeBound += 1
    this.handleResize()

    this.startPolling()

    // 初始统计（计入 requestStats.screenRefresh，保持可测）
    this.stats = screenMock.refresh()

    this.refreshChartStatus()
    this.exposeDebugHandle()
  },

  beforeDestroy() {
    // 唯一拥有者守卫：未启动过的实例不做清理；已清理过的实例不重复清理
    if (!this._screenOwnerStarted) {
      return
    }
    this._screenOwnerStarted = false

    if (this._screenPollTimer != null) {
      clearInterval(this._screenPollTimer)
      this._screenPollTimer = null
      this.lifecycle.pollCleared += 1
    }

    window.removeEventListener('resize', this.handleResize)
    this.lifecycle.resizeUnbound += 1

    this.restoreGlobalTheme()

    // 销毁报告：向 wrapper 上报最终清理计数（渲染留证），并把调试句柄替换为
    // isAlive=false 的快照（主会话可在卸载后读取清理证据；重新挂载时新实例重建句柄）
    const report = {
      pollCleared: this.lifecycle.pollCleared,
      resizeUnbound: this.lifecycle.resizeUnbound,
      themeRestored: this.lifecycle.themeRestored,
      handleDeleted: true,
      destroyedAt: new Date().toISOString(),
    }
    this.$emit('destroyed', report)
    window.__fbScreenRepaired = {
      isAlive: false,
      destroyedAt: report.destroyedAt,
      countersFinal: { ...this.lifecycle },
    }
  },

  methods: {
    /**
     * 启动 30s 轮询（唯一拥有者：单实例至多一个定时器）。
     */
    startPolling() {
      if (this._screenPollTimer != null) {
        return
      }
      this._screenPollTimer = setInterval(this.handlePollTick, POLL_INTERVAL_MS)
      this.lifecycle.pollStarted += 1
    },

    /**
     * 轮询 tick：30s interval 到点或调试触发都会走到这里。
     */
    handlePollTick(source) {
      this.lifecycle.pollTick += 1
      this.lastPollAt = new Date().toLocaleTimeString()
      this.stats = screenMock.refresh()
      return source || 'interval'
    },

    /**
     * 触发真实 ScreenUtil.calcScale（adapt 模式）并回读 datax 缩放值。
     * 视口守卫（修复 2）：window.innerWidth/innerHeight 为 0 时不调用 —— 防止
     * 真实 calcScale 在 0 视口产出 scale(0) 毒化首帧（首轮幽灵态诱因之一）。
     * calcScale 本身仍是真实 ScreenUtil 方法，本组件不改其内部计算。
     */
    handleResize() {
      if (!(window.innerWidth > 0 && window.innerHeight > 0)) {
        return
      }
      this.lifecycle.resizeApply += 1
      if (window.app && window.app.$screenUtil) {
        window.app.$screenUtil.calcScale()
        this.dataxZoom = window.app.$datax.get('screen.aZoom') || window.app.$datax.get('screen.zoom') || ''
      }
    },

    /** 手动重算缩放（与 resize 同一真实 calcScale 路径，同样受视口守卫） */
    handleApplyScale() {
      this.handleResize()
    },

    /** 切换主题：经真实 ScreenUtil.setTheme（整串覆写 html.className + datax） */
    handleToggleTheme() {
      const next = this.theme === THEME_A ? THEME_B : THEME_A
      if (window.app && window.app.$screenUtil) {
        window.app.$screenUtil.setTheme(next)
        this.lifecycle.themeApplied += 1
        this.theme = window.app.$screenUtil.getTheme()
      }
    },

    /** 刷新数据：调用 mock 重算并让 requestStats.screenRefresh 可见 */
    handleRefresh() {
      this.stats = screenMock.refresh()
    },

    /**
     * 图表渲染实测（修复 3）：遍历 #app 下全部 canvas，统计数量、尺寸非零、
     * 以及 panel body 的 computed opacity —— 主会话可用它验证「真实渲染」，
     * 而不只是 bundle 含名。
     */
    refreshChartStatus() {
      const canvases = document.querySelectorAll('#app canvas')
      let visible = 0
      canvases.forEach((c) => {
        if (c.offsetWidth > 0 && c.offsetHeight > 0) {
          visible += 1
        }
      })
      const body = document.querySelector('.screen-panel__body')
      const bodyOpacity = body ? window.getComputedStyle(body).opacity : ''
      this.chartStatus = {
        canvasCount: canvases.length,
        visibleCount: visible,
        panelBodyOpacity: bodyOpacity,
      }
    },

    /** 销毁还原挂载时的 html className（清理主题痕迹） */
    restoreGlobalTheme() {
      if (typeof this._screenHtmlClassName !== 'string') {
        return
      }
      const html = document.documentElement
      if (html) {
        html.className = this._screenHtmlClassName
      }
      this.lifecycle.themeRestored += 1
    },

    /**
     * 浏览器自动化调试句柄（synthetic fixture 专用公开契约，非业务代码模式）：
     * - window.__fbScreenRepaired = { isAlive, startedAt, PANEL_TRANSITION_NAME,
     *   POLL_INTERVAL_MS, selectors, counters, chartStatus, debugPollTick,
     *   getPanelGeometry, getThemeClass, getChartStatus }
     * - 卸载后句柄被替换为 { isAlive:false, destroyedAt, countersFinal }；
     *   重新挂载后由新实例重建完整句柄。
     */
    exposeDebugHandle() {
      const self = this
      window.__fbScreenRepaired = {
        isAlive: true,
        startedAt: new Date().toISOString(),
        PANEL_TRANSITION_NAME,
        POLL_INTERVAL_MS,
        selectors: {
          shell: '#app.screen-shell',
          banner: '.mock-banner',
          themeLine: '[data-testid="theme-line"]',
          scaleLine: '[data-testid="scale-line"]',
          lifecycleLine: '[data-testid="lifecycle-line"]',
          mockLine: '[data-testid="mock-line"]',
          chartStatusLine: '[data-testid="chart-status-line"]',
          controls: '[data-testid="repaired-controls"]',
          btnUnmount: '[data-testid="btn-unmount"]',
          btnRemount: '[data-testid="btn-remount"]',
          aliveState: '[data-testid="alive-state"]',
          destroyedReport: '[data-testid="destroyed-report"]',
          themeAnchor: '[data-testid="theme-anchor"] .jpx-input__el',
          panelWrapper: '#app .screen-panel__wrapper',
          panelHeader: '#app .screen-panel__header',
          panelBody: '#app .screen-panel__body',
          panelTitle: '#app .screen-panel__header .screen-panel__title',
          echartsCanvas: '#app .screen-panel .echarts canvas',
        },
        counters: this.lifecycle,
        chartStatus: this.chartStatus,
        debugPollTick() {
          return self.handlePollTick('debug')
        },
        getThemeClass() {
          return document.documentElement.className
        },
        getPanelGeometry() {
          const pick = (selector) => {
            const el = document.querySelector(selector)
            if (!el) return null
            const rect = el.getBoundingClientRect()
            return {
              top: rect.top + window.scrollY,
              left: rect.left + window.scrollX,
              width: rect.width,
              height: rect.height,
            }
          }
          return {
            header: pick('.screen-panel__header'),
            body: pick('.screen-panel__body'),
            title: pick('.screen-panel__header .screen-panel__title'),
            zoom: window.app && window.app.$datax ? window.app.$datax.get('screen.aZoom') : null,
          }
        },
        /** 图表渲染实测快照（canvas 数量/尺寸 + panel body computed opacity + 类名） */
        getChartStatus() {
          const canvases = []
          document.querySelectorAll('#app canvas').forEach((c, i) => {
            canvases.push({
              index: i,
              width: c.offsetWidth,
              height: c.offsetHeight,
              parentOpacity: c.parentElement ? window.getComputedStyle(c.parentElement).opacity : '',
            })
          })
          const body = document.querySelector('.screen-panel__body')
          const title = document.querySelector('.screen-panel__header .screen-panel__title')
          return {
            canvasCount: canvases.length,
            canvases,
            panelBody: body ? {
              className: body.className,
              opacity: window.getComputedStyle(body).opacity,
              display: window.getComputedStyle(body).display,
            } : null,
            panelTitle: title ? {
              className: title.className,
              text: (title.textContent || '').trim().slice(0, 40),
              opacity: window.getComputedStyle(title).opacity,
            } : null,
          }
        },
      }
    },
  },
}
</script>

<style scoped>
/* 本组件不定义任何 html.theme-* 视觉（框架主题来自 screen-base theme/*.less）。
   仅布局辅助类收敛在本页之内。 */
.mock-banner {
  position: absolute;
  left: 24px;
  top: 24px;
  padding: 8px 16px;
  background: rgba(255, 247, 230, 0.92);
  border: 1px solid #ffd591;
  color: #ad4e00;
  font-weight: 600;
  font-size: 16px;
  z-index: 10;
}

.screen-toolbar {
  position: absolute;
  left: 470px;
  top: 24px;
  width: 1420px;
  z-index: 10;
}

.screen-toolbar__meta {
  color: #9fc3e8;
  font-size: 14px;
  line-height: 1.7;
}

.chart-box {
  width: 100%;
  height: 100%;
}

.theme-anchor {
  position: absolute;
  left: 24px;
  top: 640px;
  z-index: 10;
}
</style>
