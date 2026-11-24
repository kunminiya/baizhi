# 白纸 · 安装说明（小米 / 红米 / HyperOS）

## 文件
- APK：`/workspace/baizhi-v1-debug.apk`（同内容：`/workspace/baizhi/白纸-v1-debug.apk`）
- 包名：`com.sykin.baizhi`
- 应用名：白纸
- 版本：1.0（debug 签名，可直接侧载）

## 方式 A：文件传输安装（最简单）
1. 把 `baizhi-v1-debug.apk` 拷到手机（微信/电脑/数据线/云盘均可）。
2. 用「文件管理」打开该 APK。
3. 若提示「禁止安装未知应用」：
   - 设置 → 应用设置 → 应用管理 → 右上角三件套/授权管理 → **安装未知应用**
   - 或：设置 → 隐私保护 → 特殊权限 → 安装未知应用
   - 给「文件管理 / 浏览器 / 微信」等来源打开允许。
4. 点安装 → 打开。首次可能提示「纯净模式 / 安全扫描」，选继续安装即可。

### HyperOS / MIUI 额外提示
- 若一直被拦截：设置里搜索「纯净模式」→ 关闭或允许此次安装。
- 部分机型：设置 → 更多设置 → 开发者选项 → 关闭「MIUI 优化」后再装（装完可开回）。
- 不必开 USB 调试也能用文件方式安装。

## 方式 B：adb（电脑）
```bash
# 手机打开：设置 → 我的设备 → 全部参数 → 连续点「OS 版本」开开发者选项
# 再打开：USB 调试
adb install -r /workspace/baizhi-v1-debug.apk
# 或
adb install -r ./baizhi-v1-debug.apk
```

卸载：
```bash
adb uninstall com.sykin.baizhi
```

## 权限说明
- 无账号、无云同步，数据仅存在本机 WebView / localStorage。
- 仅含震动权限（勾选完成时的轻触感）；未申请网络权限。

## 使用
- 点右下角 **+** 或点纸面空白处 → 新建
- 点圆形勾选框 → 完成（删除线 + 变淡，仍留在纸上；可再点取消）
- 时间戳按时区 **Asia/Hong_Kong** 显示：今天 HH:mm / 昨天 HH:mm / MM-DD HH:mm
