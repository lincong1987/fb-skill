<template>
  <div class="screen-fixture-viewport" ref="viewport">
    <div class="screen-fixture-canvas" :style="canvasStyle">
      <!-- 静态 MOCK 横幅 -->
      <div class="mock-banner">{{ MOCK_BANNER }}</div>

      <div class="screen-toolbar">
        <fb-button size="s" @on-click="handleToggleTheme">切换主题</fb-button>
        <fb-button size="s" @on-click="handleRefresh">刷新数据</fb-button>
        <div class="screen-toolbar__meta">
          <div>
            主题机制：html.theme-{{ theme }}（ScreenUtil themeList 全局主题值，
            视觉为 fixture 自定义 CSS，非 screen-base theme/*.less 验证）
          </div>
          <div>
            MOCK 请求统计：list={{ mockInfo.requestStats.list }},
            save={{ mockInfo.requestStats.save }}, screenRefresh={{ mockInfo.requestStats.screenRefresh }}
          </div>
          <div>
            生命周期计数：轮询={{ lifecycle.pollTick }} 次（间隔 {{ pollIntervalMs / 1000 }}s，
            started={{ lifecycle.pollStarted }}/cleared={{ lifecycle.pollCleared }}），
            resize={{ lifecycle.resizeApply }} 次（bound={{ lifecycle.resizeBound }}/unbound={{ lifecycle.resizeUnbound }}），
            theme={{ lifecycle.themeApplied }} 次（restored={{ lifecycle.themeRestored }}），
            scale={{ scale.toFixed(4) }}，最近轮询 {{ lastPollAt || '—' }}
          </div>
        </div>
      </div>

      <!-- 实际 screen-panel（@topinfo/screen-base@1.0.81，main 按包注册）。
           注意：不传 Panel 局部 theme prop —— 已取证 screen-panel.less 中不存在任何
           screen-panel--theme-* 选择器（grep 0 命中），该 prop 只产出类名无配套 CSS；
           组件默认 theme='skyblue' 仍会产出 screen-panel--theme-skyblue 空类名，无副作用。 -->
      <screen-panel
        title="设备统计（MOCK）"
        :left="24"
        :top="120"
        :width="600"
        :height="480"
      >
        <div class="stat-cells">
          <div class="stat-cell">
            <div class="stat-cell__num">{{ stats.total }}</div>
            <div class="stat-cell__label">设备总数（合成）</div>
          </div>
          <div class="stat-cell">
            <div class="stat-cell__num">{{ stats.online }}</div>
            <div class="stat-cell__label">在线设备数（合成）</div>
          </div>
        </div>
      </screen-panel>

      <screen-panel
        title="在线占比（MOCK）"
        :left="672"
        :top="120"
        :width="600"
        :height="480"
      >
        <div class="bar-rows">
          <div class="bar-row">
            <span class="bar-row__label">在线</span>
            <div class="bar-row__track">
              <div class="bar-row__bar bar-row__bar--online" :style="{ width: barOnline + '%' }"></div>
            </div>
            <span class="bar-row__value">{{ stats.online }}</span>
          </div>
          <div class="bar-row">
            <span class="bar-row__label">离线</span>
            <div class="bar-row__track">
              <div class="bar-row__bar bar-row__bar--offline" :style="{ width: barOffline + '%' }"></div>
            </div>
            <span class="bar-row__value">{{ stats.offline }}</span>
          </div>
        </div>
      </screen-panel>
    </div>
  </div>
</template>

<script>
import { MOCK_BANNER, mockState, screenMock } from './mock.js'

/**
 * Screen.vue —— fixture 大屏页（synthetic，非真实业务）。
 *
 * 主题（D1 整改）：
 * - 主题值取自安装源码 @topinfo/screen-base/src/util/ScreenUtil.js:2-47 的
 *   themeList 真实全局主题：'sky-blue'、'midnight-blue'（不再是把全局值塞进
 *   Panel 局部 prop 的旧错误，也不使用无 CSS 依托的 Panel 局部 theme prop）。
 * - 应用机制复刻 ScreenUtil.setTheme（ScreenUtil.js:528-536）的 html.theme-* 类，
 *   不实例化 ScreenUtil：其构造函数依赖全局 app.$（jQuery，ScreenUtil.js:293-335），
 *   fixture main.js 未提供。与 setTheme 的差异：本实现只移除 theme-* 类、保留
 *   html 上其他类（setTheme 是整串 className 覆写）。
 * - 主题视觉 CSS 为 fixture 自定义（见下方非 scoped style 块），因为框架主题
 *   theme/index.less（html.theme-* 选择器所在）未被 fixture main.js 引入，
 *   本次修改范围不含 main.js —— 明示：这不是 screen-base 主题视觉的框架级验证。
 *
 * 缩放（明确声明）：
 * - 采用 fixture 自定义 contain 缩放：scale = min(视口宽/1920, 视口高/1080)，
 *   transform: scale + transformOrigin: top left。
 * - 这**不是** screen-base ScreenUtil 框架缩放：ScreenUtil.calcScale
 *   （ScreenUtil.js:412-461）的 original/autoHeight/adapt 模式基于全局 jQuery
 *   与窗口尺寸直改容器 CSS，本 fixture 未启用、不宣称。
 *
 * 生命周期（D2 整改）：
 * - 本组件是 30s 轮询定时器与 window resize 监听的唯一拥有者：
 *   单实例单定时器（_screenPollTimer）、单监听（Vue2 methods 同一绑定引用）。
 * - beforeDestroy 清理：clearInterval、removeEventListener、还原 html 主题类、
 *   删除 window.__fbScreenFixture 调试句柄；幂等（重复触发不二次清理）。
 * - 计数可观察：lifecycle 计数对象渲染在工具栏 DOM；window.__fbScreenFixture
 *   供浏览器自动化读取（isAlive / counters / debugPollTick / POLL_INTERVAL_MS），
 *   销毁后该句柄被删除 —— 可用于 mount/unmount 资源释放验证。
 */
const DESIGN_WIDTH = 1920
const DESIGN_HEIGHT = 1080

/** 需求要求的大屏 mock 轮询间隔：30 秒（真实 setInterval，非模拟值） */
const POLL_INTERVAL_MS = 30000

/** ScreenUtil.js:2-47 themeList 中的真实全局主题值（本轮取证） */
const THEME_A = 'sky-blue'
const THEME_B = 'midnight-blue'
const THEME_CLASS_PREFIX = 'theme-'

export default {
  name: 'ScreenFixture',

  data() {
    return {
      MOCK_BANNER,
      mockInfo: mockState,
      // 大屏 mock 统计（screenMock.refresh() 实时重算，screenRefresh 计数可测）
      stats: { total: 0, online: 0, offline: 0, screenRefresh: 0 },
      // 当前全局主题值（ScreenUtil themeList 之一），随「切换主题」轮换
      theme: THEME_A,
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
      scale: 1,
    }
  },

  computed: {
    canvasStyle() {
      return {
        width: DESIGN_WIDTH + 'px',
        height: DESIGN_HEIGHT + 'px',
        transform: 'scale(' + this.scale + ')',
        transformOrigin: 'top left',
      }
    },
    barOnline() {
      return this.stats.total ? Math.round((this.stats.online / this.stats.total) * 100) : 0
    },
    barOffline() {
      return this.stats.total ? Math.round((this.stats.offline / this.stats.total) * 100) : 0
    },
  },

  mounted() {
    // 唯一拥有者守卫：同一实例不重复启动轮询/监听/主题
    if (this._screenOwnerStarted) {
      return
    }
    this._screenOwnerStarted = true

    // 记录挂载时的 html className，销毁时精确还原（不污染其他页面）
    this._screenHtmlClassName = document.documentElement
      ? document.documentElement.className
      : ''

    this.applyGlobalTheme(this.theme)
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

    if (window.__fbScreenFixture) {
      delete window.__fbScreenFixture
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
     * fixture 自定义 contain 缩放（非 ScreenUtil 框架缩放，见文件头声明）。
     */
    handleResize() {
      this.lifecycle.resizeApply += 1
      const el = this.$refs.viewport
      if (!el) {
        return
      }
      const w = el.clientWidth || window.innerWidth
      const h = el.clientHeight || window.innerHeight
      this.scale = Math.min(w / DESIGN_WIDTH, h / DESIGN_HEIGHT) || 1
    },

    /**
     * 切换主题：在 ScreenUtil themeList 两个真实全局主题值间轮换，
     * 并复刻 setTheme 的 html.theme-* 应用机制。
     */
    handleToggleTheme() {
      this.theme = this.theme === THEME_A ? THEME_B : THEME_A
      this.applyGlobalTheme(this.theme)
    },

    /**
     * 复刻 ScreenUtil.setTheme（ScreenUtil.js:528-536）的 html.theme-* 机制。
     * 与源码差异：setTheme 整串覆写 html.className，本实现保留非 theme-* 类
     * （避免破坏 main/构建注入的其他根类）。
     */
    applyGlobalTheme(theme) {
      const html = document.documentElement
      if (!html) {
        return
      }
      html.className = html.className
        .split(/\s+/)
        .filter((cls) => cls && cls.indexOf(THEME_CLASS_PREFIX) !== 0)
        .concat(THEME_CLASS_PREFIX + theme)
        .join(' ')
      this.lifecycle.themeApplied += 1
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

    /** 刷新数据：调用 mock 重算并让 requestStats.screenRefresh 可见 */
    handleRefresh() {
      this.stats = screenMock.refresh()
    },

    /**
     * 浏览器自动化调试句柄（synthetic fixture 专用，非业务代码模式）：
     * - window.__fbScreenFixture = { isAlive, startedAt, POLL_INTERVAL_MS,
     *   counters, debugPollTick }
     * - debugPollTick 复用 handlePollTick 同一处理函数（不伪造 interval），
     *   供主助手在不等待 30s 的情况下验证 tick 链路与计数联动。
     * - beforeDestroy 删除句柄：句柄消失即清理证据之一。
     */
    exposeDebugHandle() {
      const self = this
      window.__fbScreenFixture = {
        isAlive: true,
        startedAt: new Date().toISOString(),
        POLL_INTERVAL_MS,
        counters: this.lifecycle,
        debugPollTick() {
          return self.handlePollTick('debug')
        },
      }
    },
  },
}
</script>

<style scoped>
.screen-fixture-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #0b1c33;
}

.screen-fixture-canvas {
  position: relative;
  width: 1920px;
  height: 1080px;
}

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
  left: 420px;
  top: 24px;
  width: 1470px;
  z-index: 10;
}

.screen-toolbar__meta {
  color: #9fc3e8;
  font-size: 14px;
  line-height: 1.7;
}

.stat-cells {
  display: flex;
  gap: 24px;
}

.stat-cell {
  flex: 1;
  text-align: center;
  padding: 24px 0;
}

.stat-cell__num {
  font-size: 56px;
  font-weight: 700;
  color: #35d0ca;
}

.stat-cell__label {
  margin-top: 8px;
  color: #9fc3e8;
  font-size: 16px;
}

.bar-rows {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 16px 8px;
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.bar-row__label {
  width: 48px;
  color: #9fc3e8;
  font-size: 16px;
}

.bar-row__track {
  flex: 1;
  height: 24px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  overflow: hidden;
}

.bar-row__bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.bar-row__bar--online {
  background: #35d0ca;
}

.bar-row__bar--offline {
  background: #e8935a;
}

.bar-row__value {
  width: 40px;
  color: #9fc3e8;
  font-size: 16px;
}
</style>

<!-- 非 scoped：主题视觉为 fixture 自定义 CSS（见文件头声明）。
     1) 框架主题 theme/index.less 的 html.theme-* 选择器未被 fixture main.js 打包引入，
        该视觉块只做「html.theme-* 机制在 DOM 上生效」的 fixture 级验证；
     2) 选择器均收敛在 .screen-fixture-viewport 之下，且 !important 覆盖
        screen-panel.less（scoped）默认面板外观，不影响 List 页。 -->
<style>
.screen-fixture-viewport {
  transition: background 0.3s ease;
}

html.theme-sky-blue .screen-fixture-viewport {
  background: #0b2a4a;
}

html.theme-sky-blue .screen-fixture-viewport .screen-panel__wrapper__top {
  background: linear-gradient(180deg, #2f7fd0 0%, rgba(47, 127, 208, 0.35) 100%) !important;
}

html.theme-sky-blue .screen-fixture-viewport .screen-panel__title {
  color: #cfe8ff !important;
}

html.theme-midnight-blue .screen-fixture-viewport {
  background: #101736;
}

html.theme-midnight-blue .screen-fixture-viewport .screen-panel__wrapper__top {
  background: linear-gradient(180deg, #3c5aa6 0%, rgba(60, 90, 166, 0.3) 100%) !important;
}

html.theme-midnight-blue .screen-fixture-viewport .screen-panel__title {
  color: #d9def5 !important;
}
</style>
