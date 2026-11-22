# 大屏入口、布局、缩放与主题

**何时读**：需求涉及大屏页面或面板。识别当前 screen 入口/版本，PC 同仓库依赖不能证明它是后台页面。

## 入口和拥有者

查构建配置 → entry → Application/use → generator → views/router/service → HTML/CSS。mine-gov 有 screen-v3/v4/v5，ent-deepwell 有 screensj/maintv；历史空/死入口不作为新页面模板。

screen-base、fb-third、地图/视频各有拥有者。先用 inspect 查实际注册，项目同名覆盖要列出。未注册的 ScreenAux 不发明；旧 `screen-aux.md` 是辅助组件主题，不证明库应有一个 ScreenAux。

## 布局与缩放

1920×1080 与左右 464px 只是既有样本设计，不能要求所有原型按同坐标。方案先确定设计基准、布局尺寸、超宽/小屏行为，再选缩放：

| 已观察 ScreenUtil 模式 | 行为 | 取舍 |
|---|---|---|
| original | 按宽等比缩放 | 高度可能留白/溢出，需验 |
| autoHeight | 宽高分别缩放 | 铺满但会变形，需需求接受 |
| adapt | 取较小比例居中 contain | 保持比例，可能留边 |

具体目标版本仍查源码。`ScreenPanelLeft/Right/Top/Bottom` 是入场动画包装，不会自动完成左右分栏；面板位置来自实际 layout/props。

缩放工具不保证自己监听 resize。已有 toolbar、宿主或自定义监听能正确调用 calcScale 都可；不强制显示工具条。挂载、容器大小变化、路由切换后何时重算有明确触发器，初始 scale(0) 必须有恢复路径，不能靠不明延时碰运气。

## 主题

区分全局 `html.theme-*`/ScreenUtil、PC TX_THEME、Panel 局部主题与 FlopBoard 布局枚举。不要用一类值代替另一类。

新页面沿用目标已加载的主题与设计稿；初始 HTML/config 与持久主题关系明确，不在每次 mounted 覆盖用户选择。主题修改保留 html 上其他 class。

## 组件使用与验收

`screen-panel` 的 title/尺寸/插槽、fb-container 的定位、fbec-* 图表更新接口均查实际版本；不复制包含未定义插件/import 的完整 main 模板。

验证设计尺寸和至少另一种实际视口，检查缩放、文字溢出、层级遮挡、空/错/加载、主题切换、路由卸载。地图视频高耗资源另按数据参考查生命周期。
