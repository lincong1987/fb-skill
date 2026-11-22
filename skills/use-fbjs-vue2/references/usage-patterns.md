# Application Usage Patterns

These patterns were verified against audited Vue 2 FBJS releases. They are intentionally narrow and must be rechecked against the target project's installed source.

## Query forms

Use `rule` and FB events:

```vue
<fb-form ref="form" :model="formData" :rule="formRules" mode="query">
  <fb-form-item label="状态" prop="status">
    <fb-select v-model="formData.status"
               :data="[{ value: '1', label: '启用' }]"
               @on-change="handleStatusChange" />
  </fb-form-item>
  <fb-button type="primary" size="l" @on-click="handleQuery">查询</fb-button>
</fb-form>
```

Use the Page/table search helper already present in the neighboring page. Do not invent Element Form methods.

## Simple tables

`fb-simple-table` is configured with a `columns` array, `service`, request `param`, pager settings, and named/scoped slots. Common public methods include `doSearch`, `doReload`, and `getSelectedRows`; inspect the exact installed component before invoking other methods.

Prefer the nearest current list page with the same Page mixin. Do not introduce `el-table-column` children, Element selection events, or a separate Element pagination component.

## Component dialogs

For an inline FbUI dialog:

```vue
<fb-dialog ref="detailDialog" title="详情" @on-close="handleClose">
  <!-- content -->
</fb-dialog>
```

Open it with `this.$refs.detailDialog.show()` and close through the implemented ref method.

In audited TP component releases, dynamic business pages mount a `tp-dialog` and pass the Promise returned by `import()` directly:

```js
this.$refs.TpDialog.show(
  import('@/views/example/detail.vue'),
  { id: row.id },
  '详情',
  { width: 960, height: 656 }
)
```

Do not pass `() => import(...)`: `TpDialog.show` wraps its argument as the async component's `component` Promise. String paths remain as legacy compatibility but emit a deprecation warning; use `import(...)` for new work.

## Dates

Use raw `fb-datepicker` only when its native value is acceptable. The audited version does not implement a `valueFormat` prop; inspect the installed version.

Use `tp-datepicker` when submitted values need formatting:

```vue
<tp-datepicker v-model="formData.startTime"
               format="YYYY-MM-DD"
               value-format="YYYYMMDD"
               @on-change="handleDateChange" />
```

For ranges, set the supported `mode="range"` and inspect output shape in source or a matching page.

## Uploads

Use `tp-upload` or `tp-upload-path` when the target project adopts those business attachment wrappers. Audited `tp-upload` versions use arrays of file records and may persist `attachId`.

```vue
<tp-upload v-model="formData.attachments" />
```

Check the exact component props for readonly, limits, accept types, business URLs, and preview behavior. Use the wrapper adopted by the target application; a deliberately implemented raw `fb-upload` integration is not automatically invalid.

## Feedback services

```js
this.$message.warn('请先选择记录')

this.$confirm(
  '确定删除吗？',
  () => this.service.delete({ id: row.id }).then(result => {
    if (result && result.code === 1) this.$refs.table.doReload()
  }),
  () => {},
  { title: '提示' }
)
```

The Promise above belongs to the service call inside the success callback. Never chain it from `$confirm` itself.
