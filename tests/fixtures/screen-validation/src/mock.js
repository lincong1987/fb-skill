/**
 * mock.js —— screen-validation fixture 专用合成数据（synthetic）。
 *
 * 全部为假数据 / 假服务，非真实接口、非真实地图 / 视频服务；
 * 仅用于大屏框架机制（真实 theme / 真实 echarts / 真实 ScreenUtil）的隔离验证。
 */

/** 静态横幅文案：fixture 页面必须显式展示 */
export const MOCK_BANNER = 'MOCK 大屏验证，非真实接口 / 非真实地图 / 非真实视频'

/** 30s 自然轮询间隔（真实 setInterval 的毫秒值，非模拟值） */
export const POLL_INTERVAL_MS = 30000

/** 合成统计（screenMock.refresh() 重算，轮询 / 刷新次数可测） */
export const mockState = {
  requestStats: {
    screenRefresh: 0,
  },
}

/**
 * 合成 geoJSON（2 个矩形 FeatureCollection）：
 * - 仅通过真实 FbecMapBase 的 mapJson prop 边界注入（owner 可 mock 的边界）；
 * - 不连接任何真实地图瓦片 / 地图数据服务。
 */
export const syntheticMapJson = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'MOCK-A', adcode: 100001 },
      geometry: {
        type: 'Polygon',
        coordinates: [[[100, 30], [104, 30], [104, 34], [100, 34], [100, 30]]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'MOCK-B', adcode: 100002 },
      geometry: {
        type: 'Polygon',
        coordinates: [[[106, 30], [110, 30], [110, 34], [106, 34], [106, 30]]],
      },
    },
  ],
}

/** 合成地图数值（series data，与 syntheticMapJson 的 name 对应） */
export const syntheticMapValue = [
  { name: 'MOCK-A', value: 66 },
  { name: 'MOCK-B', value: 33 },
]

/** 大屏 mock：统计值实时重算，刷新次数可测（供 30s 轮询与手动刷新复用） */
export const screenMock = {
  refresh() {
    mockState.requestStats.screenRefresh += 1
    const tick = mockState.requestStats.screenRefresh
    return {
      total: 120 + (tick % 5),
      online: 96 + (tick % 3),
      offline: (120 + (tick % 5)) - (96 + (tick % 3)),
      screenRefresh: tick,
    }
  },
}

/** 测试辅助（仅 fixture 测试用）：重置统计 */
export function resetMockRuntime() {
  mockState.requestStats.screenRefresh = 0
}
