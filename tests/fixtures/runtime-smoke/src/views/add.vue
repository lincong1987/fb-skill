<template>
  <div class="add-fixture">
    <div class="mock-banner">{{ MOCK_BANNER }}</div>

    <fb-form ref="form" :model="form">
      <fb-form-item
        label="设备名称"
        prop="name"
        :rule="{ required: true, message: '请输入设备名称', trigger: 'blur' }"
      >
        <fb-input v-model="form.name" placeholder="请输入设备名称（合成数据）"></fb-input>
      </fb-form-item>

      <fb-form-item
        label="状态"
        prop="status"
        :rule="{ required: true, message: '请选择状态', trigger: 'change' }"
      >
        <fb-select v-model="form.status" :data="STATUS_OPTIONS"></fb-select>
      </fb-form-item>
    </fb-form>

    <div class="add-fixture__buttons">
      <fb-button type="primary" :disabled="saving" @on-click="handleSave">
        {{ saving ? '保存中…' : '保存' }}
      </fb-button>
      <fb-button :disabled="saving" @on-click="handleCancel">取消</fb-button>
    </div>
  </div>
</template>

<script>
import { MOCK_BANNER, STATUS_OPTIONS, saveDevice } from '../mock.js'

/**
 * add.vue —— fixture 新增子页（synthetic）。
 * 由 tp-dialog 2.2.15 动态挂载：接收 param/parentPage 两个 prop（源码
 * tp-dialog.vue 第 18 行 :param / :parentPage），无 meta。
 * 关闭由子页自行调用 parentPage.closeTpDialog(...)，不依赖全局 Page mixin。
 */
export default {
  name: 'AddDeviceFixture',

  props: {
    param: {
      type: Object,
      default() {
        return {}
      },
    },
    parentPage: {
      type: Object,
      default() {
        return null
      },
    },
  },

  data() {
    return {
      MOCK_BANNER,
      STATUS_OPTIONS,
      // 仅需求字段：name 必填 + status 下拉，不虚构无关字段
      form: {
        name: '',
        status: '1',
      },
      // 保存请求中锁住重复提交，finally 恢复
      saving: false,
    }
  },

  methods: {
    /** 安全关闭：parentPage 即 tp-dialog 实例（closeTpDialog 为源码方法） */
    closeDialog(result) {
      if (this.parentPage && typeof this.parentPage.closeTpDialog === 'function') {
        this.parentPage.closeTpDialog(result)
      }
    },

    handleSave() {
      if (this.saving) {
        return // 防重复提交
      }
      this.$refs.form.validate((valid) => {
        if (!valid) {
          return
        }
        this.saving = true
        saveDevice({ name: this.form.name, status: this.form.status })
          .then((res) => {
            if (res && res.code === 1) {
              if (this.$message && this.$message.success) {
                this.$message.success('MOCK 保存成功（父列表将刷新一次）')
              }
              // 仅成功时携带 success 标识关闭 → 父列表刷新一次
              this.closeDialog({ success: true, action: 'add' })
            } else {
              // 模拟失败：清晰提示，弹窗保持打开以便修改
              const message =
                (res && res.message) || 'MOCK 保存失败（未收到成功码）'
              if (this.$message && this.$message.error) {
                this.$message.error(message)
              }
            }
          })
          .catch(() => {
            if (this.$message && this.$message.error) {
              this.$message.error('MOCK 保存异常：服务调用抛错（非真实接口）')
            }
          })
          .finally(() => {
            this.saving = false
          })
      })
    },

    /** 取消：不携带 success 标识 → 父列表不刷新 */
    handleCancel() {
      this.closeDialog()
    },
  },
}
</script>

<style scoped>
.mock-banner {
  padding: 8px 12px;
  margin-bottom: 12px;
  background: #fff7e6;
  border: 1px solid #ffd591;
  color: #ad4e00;
  font-weight: 600;
}

.add-fixture__buttons {
  text-align: right;
}
</style>
