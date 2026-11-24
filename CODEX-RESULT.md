# 白纸 v26 · Rust 核心交付

`npm run apk:debug` 已构建 debug APK。`aapt dump badging` 读出的包名为 `com.sykin.baizhi`，versionCode 为 `26`，versionName 为 `2.6`。`apksigner verify` 验证通过，签名证书 SHA-256 与 v25 相同。

## 核心与 WebView 接口

- `core/src/todos.rs` 中的 `Todos` 持有唯一的条目集合，负责新建、编辑、删除、完成与取消完成、创建时间排序、计数、草稿判定和保存。JS 通过 wasm-bindgen 获取渲染快照，操作时传回 ID。
- Rust 直接调用 WebView 的 `localStorage` 和 JSON 接口。沿用 `baizhi.todos.v1` 以及 `id`、`text`、`createdAt`、`completed`、`completedAt` 五字段数组。加载只读，沿用 v25 的字段转换和空白过滤。新草稿只在内存中存在，输入时保存原文，结束编辑时修剪两端空白，取消完成将完成时间写回 `null`。文本保留 JS UTF-16 及 `trim` 语义。
- `core/src/lib.rs` 接收滚动位置、可滚动距离、触摸状态和时间。采样窗口为 `0 < dt < 120ms`，窗口外保留上一速度；触发要求距边界至多 0.5px、方向向外、速度严格超过 180px/s。弹簧初始位移为带方向的 `clamp(abs(speed) × 0.07, 24, 35)`，初速度为位移 × 10。先按刚度 145、阻尼 20 更新速度，再积分位移；时间步上限 32ms，位移和速度绝对值都小于 0.12 时归零。
- Rust 计算按住外拖的 `dy × 0.18`、±22px 限幅，以及卷轴每行的位移、深度、倾角、缩放、模糊和透明度。JS 读取布局、写入原有样式并调度动画，松手仍走原来的 260ms 回收。`core/src/time.rs` 使用 WebView 的香港时区数据，生成今天、昨天和月日时间标签。
- `src/main.js` 初始化 Wasm 后挂载原有界面，继续处理手势事件、键盘视口、编辑焦点与选区。`src/style.css` 与迁移前逐字节相同，两版 APK 内的 CSS 也逐字节相同。Android 窗口、WebView 刷新设置和系统刷新率均保持 v25 配置。

## 文件和构建入口

Rust 工程为 `core/Cargo.toml`、`core/Cargo.lock` 和上述三个 Rust 源文件。`scripts/build-core.sh` 使用 Rust 1.85.1、`wasm32-unknown-unknown` 和 wasm-bindgen CLI 0.2.100。`package.json` 将该脚本接入开发和构建入口，`.gitignore` 排除 `core/target/` 和生成的 `src/generated/`。Vite 打包 JS 胶水和 Wasm，Capacitor 同步到 Android assets。已核对 APK 中的 67,692 字节 Wasm 与 `dist` 产物相同。

Android 版本号修改位于 `android/app/build.gradle`。测试涉及 `core/core.test.mjs`、`fab-v22-selftest.mjs` 和生成的 `fab-v22-selftest.json`。

## 验证结果

| 验证 | 实测结果 |
| --- | --- |
| `node fab-v22-selftest.mjs` | 72/72。保留原交互断言，四项原本搜索 JS 常量的卷轴断言改为检查固定几何位置上的实际 DOM 样式。 |
| `node --test core/core.test.mjs` | 33/33，直接实例化编译后的 Wasm。30 项对照 v25 峰值和归零帧，另外三项覆盖滚动和外拖边界、旧数据加载保存与重载、香港跨年午夜。 |
| 逐帧对照 v25 原函数 | 上下两端，30/60/120Hz，181/350/500/1500/10000px/s。共 30 组、1,486 个积分帧，最大位移差 0px，每组归零帧相同。 |
| `:app:testDebugUnitTest` | Gradle BUILD SUCCESSFUL。 |
| `npm run apk:debug` | 使用 `/workspace/jdk/jdk-21.0.13+9` 和 `/workspace/android-sdk`，Gradle BUILD SUCCESSFUL。 |

交互测试运行于 Chrome 移动触摸环境。ADB 设备列表为空，本次未做真机安装或手感实测。

## APK

- `/workspace/codex-workspaces/baizhi/白纸-核心Rust-v26.apk`
- `/workspace/白纸-核心Rust-v26.apk`

两份副本与 Gradle 原产物的 SHA-256 均为 `f34c1ca603588ab35805bd016003f95a88d8d8e9fdca3d10cfee253c283d8771`。
