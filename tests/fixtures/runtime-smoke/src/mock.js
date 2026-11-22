/**
 * mock.js —— FB Skill runtime-smoke fixture 专用合成数据（synthetic）。
 * 全部为假数据/假服务，非真实接口、非真实设备；仅用于 skill 产品测试演练。
 * 由本文件独立导出，main.js 不 import 本文件（fixture 页面自行引用）。
 */

/** 静态横幅文案：所有 fixture 页面必须显式展示 */
export const MOCK_BANNER = 'MOCK 运行演练，非真实接口'

/** 状态字典（合成枚举，非真实业务字典） */
export const STATUS_MAP = {
  '1': '在线',
  '0': '离线',
}

export const STATUS_OPTIONS = [
  { value: '1', label: '在线' },
  { value: '0', label: '离线' },
]

/** 合成示例设备（固定 2 条，满足「初始 2 行」验收） */
const devices = [
  { id: 'DEV-0001', name: '示例设备-甲', status: '1' },
  { id: 'DEV-0002', name: '示例设备-乙', status: '0' },
]

let idSeq = 2 // 已用 2 个编号，新增从 DEV-0003 起

/**
 * mock 全局状态：失败开关 + 请求统计（页面引用后可直接渲染，可测）。
 * - saveFailureMode=true 时 saveDevice 返回 code 0（模拟保存失败）
 */
export const mockState = {
  saveFailureMode: false,
  requestStats: {
    list: 0,
    save: 0,
    screenRefresh: 0,
  },
}

/** IPage 分页切片（fb-simple-table 默认 dataParse 契约：data.records/total/current/size/pages） */
function pageOf(list, current, size) {
  const total = list.length
  const pages = Math.ceil(total / size)
  const cur = Math.min(Math.max(current, 1), Math.max(pages, 1))
  return {
    records: list.slice((cur - 1) * size, cur * size),
    total,
    size,
    current: cur,
    pages,
  }
}

/**
 * 列表 mock 服务（fb-simple-table service 契约之一：Object{ list } 分支）。
 * 调用参数由表格混入：{ ...param(query), current, size, pages, ...pager }
 * 返回 Promise<{ code:1, message, data: IPage }>
 */
export const deviceService = {
  list(param) {
    mockState.requestStats.list += 1
    const p = param || {}
    const name = p.name || ''
    const filtered = devices.filter(
      (d) => !name || d.name.indexOf(name) !== -1
    )
    return Promise.resolve({
      code: 1,
      message: 'MOCK 查询成功（非真实接口）',
      data: pageOf(filtered, p.current || 1, p.size || 10),
    })
  },
}

/**
 * 保存 mock 服务。受 mockState.saveFailureMode 控制：
 * - 失败模式：resolve { code:0, message:... }（页面据此提示且不关闭弹窗）
 * - 成功：追加合成记录并 resolve { code:1 }
 */
export function saveDevice(form) {
  mockState.requestStats.save += 1
  if (mockState.saveFailureMode) {
    return Promise.resolve({
      code: 0,
      message: 'MOCK 模拟保存失败：saveFailureMode 已开启（非真实接口）',
    })
  }
  idSeq += 1
  const id = 'DEV-' + String(idSeq).padStart(4, '0')
  devices.push({ id, name: form.name, status: form.status })
  return Promise.resolve({
    code: 1,
    message: 'MOCK 保存成功（非真实接口）',
    data: { id },
  })
}

/** 导出 CSV 用：读取全部合成数据（列表导出走 Blob 下载，不依赖 app.download） */
export function getAllDevices() {
  return devices.slice()
}

/**
 * CSV 公式注入防护（fixture 按 OWASP「CSV Injection」常见导出处理实现）：
 * - 单元格在忽略前导空白（空格/制表符/回车/换行）后以 = + - @ 开头，
 *   或本身以制表符/回车/换行开头时，给原始值前缀半角单引号 `'`，
 *   使 Excel / WPS 打开时按文本处理，不当作公式执行。
 * - 前缀 `'` 后在 CSV 中会原样可见（Excel 不吞 CSV 里的引号转义符），
 *   这是该防护的已知取舍：宁可显示一个多余引号，也不执行公式。
 * - 普通文本（危险字符不在开头）不加前缀，避免过度损坏；
 *   引号转义仍由调用方统一包裹处理。
 * - 已知取舍：以 `-` 开头的负数（如 "-5"）也会被加前缀，与 OWASP 建议一致；
 *   本 fixture 的字段（id/name/status 文本）不受影响。
 */
const CSV_FORMULA_PREFIX_RE = /^[\t\r\n ]*[=+\-@]/
const CSV_CONTROL_PREFIX_RE = /^[\t\r\n]/

export function sanitizeCsvCell(value) {
  const s = String(value == null ? '' : value)
  if (CSV_FORMULA_PREFIX_RE.test(s) || CSV_CONTROL_PREFIX_RE.test(s)) {
    return "'" + s
  }
  return s
}

export function buildDevicesCsv() {
  const lines = ['id,name,status']
  devices.forEach((d) => {
    lines.push(
      [d.id, d.name, STATUS_MAP[d.status] || d.status]
        .map((v) => '"' + sanitizeCsvCell(v).replace(/"/g, '""') + '"')
        .join(',')
    )
  })
  return lines.join('\r\n')
}

/** 大屏 mock：统计值实时从合成设备集合重算，刷新次数可测 */
export const screenMock = {
  refresh() {
    mockState.requestStats.screenRefresh += 1
    return {
      total: devices.length,
      online: devices.filter((d) => d.status === '1').length,
      offline: devices.filter((d) => d.status === '0').length,
      screenRefresh: mockState.requestStats.screenRefresh,
    }
  },
}

/** 测试辅助（仅 fixture 测试用）：重置统计与失败开关，不重置设备数据 */
export function resetMockRuntime() {
  mockState.saveFailureMode = false
  mockState.requestStats.list = 0
  mockState.requestStats.save = 0
  mockState.requestStats.screenRefresh = 0
}
