# 白纸（Baizhi）

> 像一张无限长的白纸，轻写、轻划、轻滑。

**白纸** 是一款极简、离线优先的 Android 无限流待办应用（包名 `com.sykin.baizhi`）。去掉了文件夹、标签、优先级、提醒弹窗等繁重概念，只保留时间、文字与完成状态，让记录待办像在随手可及的一张白纸上落笔一样轻盈。

## 设计与特性

* **无限卷轴视效（Soft-Float Reel）**：条目居中悬浮排列，向上滚动时逐渐缩小、倾角后仰并渐隐至屏幕顶部，自带轻盈的空间纵深感。
* **惯性果冻回弹**：遵循原生滚动手感，仅在触及顶/底边界时介入弹性阻尼回弹，兼顾跟手与流畅度。
* **极简手势交互**：
  * **点右下角 `+`**：新建条目并自动聚焦输入；留空退出自动丢弃，不产生空白垃圾条目。
  * **双击条目**：划线标记完成（文字与时间转为绿色，条目不消失，再次双击可取消完成）。
  * **长按条目**：弹出 Android 风格横向胶囊菜单（编辑 / 完成 / 删除），长按期间禁止误选文字、不误弹键盘。
  * **删除撤销**：误删后底部弹出 3.5 秒轻量「已删除 · 撤销」提示，一键恢复原条目及时间。
  * **一键复制备份**：长按或双击右上角「未完成 · 已完成」统计区，可将全部待办 JSON 复制到剪贴板。
* **原生细节适配**：支持系统深浅色模式自动切换（状态栏联动）、Android 返回键层级退出（菜单 → 编辑 → 后台）、轻触觉反馈（Haptics），全部数据本地存储在设备中，零账号、零联网、零追踪。

## 技术架构

* **核心引擎（Rust → WebAssembly）**：位于 `core/`
  * `core/src/lib.rs`：惯性边界弹簧物理（`Edge`）、外拖阻尼（`drag`）以及批量卷轴变换计算（`reel_batch`，每帧单次跨界零堆分配）。
  * `core/src/todos.rs`：唯一待办数据源，兼容 `baizhi.todos.v1` 本地存储格式，支持防抖刷盘、删除恢复与 JSON 导出。
  * `core/src/time.rs`：纯 Rust UTC+8 整数日历格式化（`今天` / `昨天` / `MM-DD`），零 JS 跨界开销。
* **界面与原生外壳**：Vite（原生 JS / CSS）+ Capacitor 7 Android（`@capacitor/app` / `haptics` / `keyboard` / `status-bar`）。

## 下载与安装

前往本仓库 [Releases](https://github.com/kunminiya/baizhi/releases) 页面下载最新 APK（如 `baizhi-v2.7.apk`）直接安装即可。

## 本地开发与构建

### 环境要求

* Node.js 20+
* Rust + `wasm32-unknown-unknown` + `wasm-bindgen-cli`（仅修改 `core/` 时需要）
* JDK 21 + Android SDK 35（仅构建 APK 时需要）

### 常用命令

```bash
# 安装前端依赖
npm ci

# 浏览器本地开发
npm run dev

# 编译 Rust/Wasm 核心 + 打包 Web 产物
npm run build

# 运行 Wasm 单元测试（35 项）
node --test core/core.test.mjs

# 运行移动触摸端到端自测（72 项，需本机 Chrome/Chromium）
CHROME_PATH=/path/to/chrome node fab-v22-selftest.mjs

# 同步到 Android 工程并构建 Debug APK
npx cap sync android
cd android && ./gradlew assembleDebug
```
