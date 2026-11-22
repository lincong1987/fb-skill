<template>
  <div class="list-fixture">
    <!-- 静态 MOCK 横幅（需求要求显式声明非真实接口） -->
    <div class="mock-banner">{{ MOCK_BANNER }}</div>

    <fb-page-search>
      <template slot="query">
        <fb-form :model="queryForm" mode="query">
          <fb-form-item label="设备名称" prop="name">
            <fb-input
              v-model="queryForm.name"
              placeholder="按名称查询（MOCK）"
              @on-enter="handleQuery"
            ></fb-input>
          </fb-form-item>
          <fb-button type="primary" @on-click="handleQuery">查询</fb-button>
          <fb-button class="query-reset" @on-click="handleReset">重置</fb-button>
        </fb-form>
      </template>

      <template slot="buttons">
        <fb-button type="primary" @on-click="handleAdd">新增设备</fb-button>
        <fb-button @on-click="handleExportCsv">导出CSV（MOCK）</fb-button>
      </template>

      <template slot="actions">
        <fb-button :type="failMode ? 'danger' : 'default'" @on-click="handleToggleFail">
          模拟保存失败：{{ failMode ? '开' : '关' }}
        </fb-button>
      </template>

      <template slot="table">
        <fb-simple-table
          ref="table"
          pk="id"
          :columns="columns"
          :service="deviceService"
          :param="searchParam"
          :auto-load="true"
        >
          <template slot="status" slot-scope="{ row }">
            {{ STATUS_MAP[row.status] || row.status }}
          </template>
        </fb-simple-table>
      </template>
    </fb-page-search>

    <!-- 动态弹窗容器：tp-dialog 2.2.15，show(import(...), param, title, options) -->
    <tp-dialog ref="TpDialog" @closeTpDialog="handleDialogClose"></tp-dialog>

    <div class="mock-stats">
      {{ MOCK_BANNER }} —— 请求统计（合成数据）：list={{ mockInfo.requestStats.list }},
      save={{ mockInfo.requestStats.save }}, screenRefresh={{ mockInfo.requestStats.screenRefresh }}
    </div>
  </div>
</template>

<script>
import {
  MOCK_BANNER,
  STATUS_MAP,
  deviceService,
  mockState,
  buildDevicesCsv,
} from './mock.js'

/**
 * List.vue —— fixture 列表页（synthetic，非真实设备业务）。
 * 组件契约均按安装源码取证：fb-ui@1.1.826、@topinfo/tp-components@2.2.15。
 */
export default {
  name: 'ListFixture',

  data() {
    return {
      MOCK_BANNER,
      STATUS_MAP,
      deviceService,
      // mock 全局状态引用（失败开关 / 请求统计，直接渲染可测）
      mockInfo: mockState,
      failMode: mockState.saveFailureMode,
      // 查询模型：查询参数全部在 data 声明
      queryForm: {
        name: '',
      },
      // 表格初始查询参数（fb-simple-table myQueryParam 初始来源）
      searchParam: {
        name: '',
      },
      // 列定义（fb-simple-table 列项：name/label/slot/width）
      columns: [
        { name: 'id', label: '设备编号', width: 160 },
        { name: 'name', label: '设备名称', width: 220 },
        { name: 'status', label: '状态', slot: 'status', width: 120 },
      ],
    }
  },

  methods: {
    /** 查询：doSearch(param) 合并查询参数并回第一页（源码 FbSimpleTable.doSearch） */
    handleQuery() {
      this.$refs.table.doSearch({ name: this.queryForm.name })
    },

    /** 重置：清空模型并按空条件回到第一页 */
    handleReset() {
      this.queryForm.name = ''
      this.$refs.table.doSearch({ name: '' })
    },

    /** 新增：tp-dialog.show 第一个参数传 import() 返回的 Promise（2.2.15 契约） */
    handleAdd() {
      this.$refs.TpDialog.show(
        import('./views/add.vue'),
        {},
        '新增设备（MOCK）',
        { width: 640, height: 420 }
      )
    },

    /**
     * 弹窗关闭回调：仅子页成功关闭（result.success）时刷新一次列表；
     * 取消 / 右上角 X（param 为空）不刷新。
     */
    handleDialogClose(result) {
      if (result && result.success) {
        this.$refs.table.doSearch()
      }
    },

    /** 失败开关：切换 mockState.saveFailureMode，驱动「模拟保存失败」分支 */
    handleToggleFail() {
      mockState.saveFailureMode = !mockState.saveFailureMode
      this.failMode = mockState.saveFailureMode
    },

    /**
     * 导出（MOCK）：fb-simple-table@1.1.826 无 export 类方法，
     * 故导出按钮由页面自行实现 CSV Blob 下载，不调用未定义的 app.download。
     */
    handleExportCsv() {
      const csv = buildDevicesCsv()
      const blob = new Blob(['\uFEFF' + csv], {
        type: 'text/csv;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'devices-mock.csv'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      if (this.$message && this.$message.success) {
        this.$message.success('MOCK CSV 已生成并下载（非真实接口）')
      }
    },
  },
}
</script>

<style scoped>
.query-reset {
  margin-left: 8px;
}

.mock-banner {
  padding: 8px 16px;
  margin-bottom: 8px;
  background: #fff7e6;
  border: 1px solid #ffd591;
  color: #ad4e00;
  font-weight: 600;
}

.mock-stats {
  padding: 8px 16px;
  margin-top: 8px;
  color: #666;
  font-size: 12px;
}
</style>
