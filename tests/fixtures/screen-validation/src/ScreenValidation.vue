<template>
  <div id="app" class="screen-shell" :style="shellStyle">
    <!-- 静态 MOCK 横幅 -->
    <div class="mock-banner">{{ MOCK_BANNER }}</div>

    <div class="screen-toolbar">
      <fb-button size="s" @on-click="handleToggleTheme">切换主题（真实 ScreenUtil.setTheme）</fb-button>
      <fb-button size="s" @on-click="handleRefresh">刷新数据</fb-button>
      <fb-button size="s" @on-click="handleApplyScale">重算缩放（真实 calcScale）</fb-button>
      <div class="screen-toolbar__meta">
        <div data-testid="theme-line">
          主题机制：html.theme-{{ theme }}（ScreenUtil.setTheme 真实覆写，视觉为框架
          screen-base theme/*.less，非 fixture 自定义 CSS）
        </div>
        <div data-testid="scale-line">
          缩放：mode={{ mode }}，datax.zoom={{ dataxZoom || '—' }}，canvas={{ canvasWidth }}x{{ canvasHeight }}
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
      </div>
    </div>

    <!-- 真实 screen-panel（@topinfo/screen-base@1.0.81 全量 install 注册）。
         剩余高度：ScreenPanel.getBodyStyle 计算 body top = top + headerHeight(35)、
         height = height - headerHeight —— 本面板用 DOM 实测该契约。 -->
    <screen-panel
      title="资源趋势（MOCK 真实 echarts）"
      :left="24"
      :top="120"
      :width="900"
      :height="480"
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
 * ScreenValidation.vue —— screen-validation fixture 大屏页（synthetic，非真实业务）。
 *
 * 与 runtime-smoke Screen.vue 的差异（本 fixture 的增量目标）：
 * - 主题视觉：真正 import 框架主题样式（见 main.js 的
 *   '@topinfo/screen-base/src/assets/styles/index.less'），html.theme-* 的视觉
 *   来自框架 theme/*.less（.blue-theme() 混入 jpx-* 组件规则），本文件不再
 *   自定义任何 html.theme-* 视觉 CSS；
 * - 主题机制：调用真实 ScreenUtil.setTheme（ScreenUtil.js:528-536，整串覆写
 *   html.className + app.$datax），不在本组件复刻该逻辑；
 * - 缩放：调用真实 ScreenUtil.calcScale（ScreenUtil.js:412-461，adapt 模式），
 *   由 window resize 监听与手动按钮触发；
 * - 图表：真实 fb-third FbEcharts（echarts 5.6.0）+ fbecDark 注册主题；
 * - 地图：真实 fb-third FbecMapBase，mapJson prop 注入合成 geoJSON（不连真实地图）。
 *
 * 生命周期（唯一拥有者）：
 * - 本组件是 30s 轮询定时器与 window resize 监听的唯一拥有者：
 *   单实例单定时器（_screenPollTimer）、单监听（Vue2 methods 同一绑定引用）。
 * - beforeDestroy 清理：clearInterval、removeEventListener、还原 html 主题类、
 *   删除 window.__fbScreenValidation 调试句柄；幂等（重复触发不二次清理）。
 * - 已知边界（安装源码取证）：真实 ScreenPanel.vue 的 mounted 里向
 *   $screenUtil 注册 'screen.theme' 监听且 beforeDestroy 不注销
 *   （ScreenPanel.vue:460-484），本 fixture 不修改安装源码、不伪造其清理行为。
 */
const DESIGN_WIDTH = 1920
const DESIGN_HEIGHT = 1080

/** ScreenUtil.js:2-47 themeList 中的真实全局主题值（本轮取证） */
const THEME_A = 'midnight-blue'
const THEME_B = 'sky-blue'

export default {
  name: 'ScreenValidation',

  data() {
    return {
      MOCK_BANNER,
      mockInfo: mockState,
      syntheticMapJson,
      stats: { total: 0, online: 0, offline: 0, screenRefresh: 0 },
      // 当前全局主题值（ScreenUtil themeList 之一），经真实 setTheme 轮换
      theme: window.app && window.app.$screenUtil ? window.app.$screenUtil.getTheme() : THEME_A,
      mode: window.app && window.app.$screenUtil ? window.app.$screenUtil.getMode() : 'adapt',
      canvasWidth: DESIGN_WIDTH,
      canvasHeight: DESIGN_HEIGHT,
      dataxZoom: '',
      // 30s 轮询间隔（渲染到 DOM，供浏览器验证）
      pollIntervalMs: POLL_INTERVAL_MS,
      // 最近一次轮询触发时间（本地时间字符串，可观察）
      lastPollAt: '',
      // 生命周期计数（唯一拥有者/清理证据，渲染在工具栏可观察）
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
      // screen-shell 类提供框架尺寸/背景（screen-shell.less），此处只补透明度过渡
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

    // 合成 geoJSON 的注册由真实 FbecMapBase 自身完成（mounted/watch 内
    // $echarts.registerMap(mapName='zj', this.mapJson)），不经本组件手工注册。

    // Vue2 methods 经 initMethods 绑定到实例：add/remove 用同一引用
    window.addEventListener('resize', this.handleResize)
    this.lifecycle.resizeBound += 1
    this.handleResize()

    this.startPolling()

    // 初始统计（计入 requestStats.screenRefresh，保持可测）
    this.stats = screenMock.refresh()

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

    if (window.__fbScreenValidation) {
      delete window.__fbScreenValidation
    }
  },

  methods: {
    /**
     * 启动 30s 轮询（唯一拥有者：单实例至多一个定时器）。
     * 定时器句柄存实例属性（非响应式），只由本组件 start/clear。
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
     * source 仅用于计数语义区分（'interval' | 'debug'）。
     */
    handlePollTick(source) {
      this.lifecycle.pollTick += 1
      this.lastPollAt = new Date().toLocaleTimeString()
      this.stats = screenMock.refresh()
      return source || 'interval'
    },

    /**
     * 触发真实 ScreenUtil.calcScale（adapt 模式）并回读 datax 缩放值。
     * 不在本组件复刻任何缩放计算。
     */
    handleResize() {
      this.lifecycle.resizeApply += 1
      if (window.app && window.app.$screenUtil) {
        window.app.$screenUtil.calcScale()
        this.dataxZoom = window.app.$datax.get('screen.aZoom') || window.app.$datax.get('screen.zoom') || ''
      }
    },

    /** 手动重算缩放（与 resize 同一真实 calcScale 路径） */
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
     * - window.__fbScreenValidation = { isAlive, startedAt, POLL_INTERVAL_MS,
     *   selectors, counters, debugPollTick, getPanelGeometry, getThemeClass }
     * - debugPollTick 复用 handlePollTick 同一处理函数（不伪造 interval），
     *   供主会话在不等待 30s 的情况下验证 tick 链路与计数联动。
     * - getPanelGeometry：实测第一个 screen-panel 的 header/body DOM 几何，
     *   验证 ScreenPanel.getBodyStyle 的「剩余高度」契约（body.top = top+35、
     *   body.height = height-35）。
     * - beforeDestroy 删除句柄：句柄消失即清理证据之一。
     */
    exposeDebugHandle() {
      const self = this
      window.__fbScreenValidation = {
        isAlive: true,
        startedAt: new Date().toISOString(),
        POLL_INTERVAL_MS,
        selectors: {
          shell: '#app.screen-shell',
          banner: '.mock-banner',
          themeLine: '[data-testid="theme-line"]',
          scaleLine: '[data-testid="scale-line"]',
          lifecycleLine: '[data-testid="lifecycle-line"]',
          mockLine: '[data-testid="mock-line"]',
          themeAnchor: '[data-testid="theme-anchor"] .jpx-input__el',
          panelWrapper: '#app .screen-panel__wrapper',
          panelHeader: '#app .screen-panel__header',
          panelBody: '#app .screen-panel__body',
          echartsCanvas: '#app .screen-panel .echarts canvas',
          mapCanvas: '#app .screen-panel:nth-of-type(2) .echarts canvas',
        },
        counters: this.lifecycle,
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
            header: pick(self.selectorsHeader()),
            body: pick(self.selectorsBody()),
            zoom: window.app && window.app.$datax ? window.app.$datax.get('screen.aZoom') : null,
          }
        },
      }
    },

    /** 第一块 panel 的 header/body 选择器（均带稳定 id） */
    selectorsHeader() {
      return '.screen-panel__header'
    },
    selectorsBody() {
      return '.screen-panel__body'
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
