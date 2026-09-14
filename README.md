# DSH Launcher

Windows 上的 DeepSeek Harness 两段式启动器：先检查插件并选择加载项，再启动 DSH。

插件加载失败时，可以在独立的选择窗口查看错误、取消勾选，再启动其余功能。窗口记住上次选择；未变化的检查结果直接复用，变化项最多同时检查 3 项。

## 功能

- 一次汇总所有可选插件的加载结果：绿色通过，红色失败，黄色表示无法确定。
- 取消勾选保留插件安装和数据；支持重新启用。
- 检查 DSH 页面和启动脚本，识别资源 404、接口缺失和依赖声明错误。
- 缓存成功、失败和无法确定的结果。单个插件变化时重查受影响项，DSH 运行文件变化时重新检查全部项目。
- 正式启动前验证所选组合；相同组合且文件未变化时复用结论。
- 复用健康实例，故障时最多恢复一次；端口被其他程序占用时保留该程序并显示错误。

## 环境

- Windows 10/11，Windows PowerShell 5.1。
- Node.js 22 或更高版本，`node.exe` 和 `npm.cmd` 可在终端运行。
- 已完成构建的 [DeepSeek Harness 源码仓库](https://github.com/deepseek-ai/deepseek-harness)，存在 `apps/cli/lib/bin.js`。
- 已初始化的 DSH `web` profile，通常位于 `%USERPROFILE%\.dsh\profiles\web`。
- Edge 用于独立应用窗口；没有 Edge 时使用默认浏览器。

当前适配 DSH 源码 Web 模式，正式服务使用 `127.0.0.1:3080`。本项目是社区启动工具，与官方 Electron 客户端分别安装和运行。

## 安装

下载或克隆本仓库，放在可写、准备长期保留的目录。在该目录打开 PowerShell，运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-Launcher.ps1 -RepositoryPath "C:\Projects\deepseek-harness"
```

将示例路径替换为自己的 DSH 源码目录。安装脚本验证环境，使用锁定版本安装依赖，并创建桌面上的 **DSH Launcher** 快捷方式。安装过程不启动 DSH，也不修改 DSH profile。

自定义 DSH 数据目录：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-Launcher.ps1 -RepositoryPath "C:\Projects\deepseek-harness" -DshHome "D:\DSHData"
```

添加 `-NoShortcut` 可以只保存配置；之后双击 `Launch-DSH.vbs`。环境禁用 VBScript 时，可运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Launch-DSH.ps1`。

## 使用

1. 打开 **DSH Launcher**，等待全部检查完成。
2. 查看每一项结果，勾选本次要加载的插件。
3. 点击 **启动 DeepSeek Harness**。所选组合通过后进入 DSH。
4. 如果网络、凭据或外部服务已恢复，点击 **强制重新检查** 刷新缓存。

选择窗口管理 Web profile 中的外部插件 bundle，以及用户补丁中带有 `id` 和 `name` 的直接插入项。基础组件固定加载；嵌套插件组不提供逐个开关。红色项仍可勾选，但所选组合必须通过验证才能正式启动。

检查会实际执行已安装的插件，使用临时 DSH 数据目录、工作目录和端口。它验证加载与页面资源；需要正式凭据、特定工作目录或其他插件配合的扩展，仍需结合组合检查和实际运行判断。独立检查可能报告缺少这些条件。

**这是启动前的插件选择工具。** 修改选择后可能重启 DSH，请在当前任务结束后切换插件。

## 配置、缓存与恢复

`launcher-config.json` 保存安装时选择的仓库与数据目录。`DSH_LAUNCHER_REPO`、`DSH_HOME` 环境变量可分别覆盖它们。移动目录后重新运行安装命令。

启动器目录中的 `selection.json` 保存选择；`check-cache.json`、`fingerprints.json` 保存检查缓存；`check-logs/` 保存逐项日志。关闭选择窗口后，可删除这两个缓存文件以完整重查。

正式启动时会更新 profile 的 bundle 加载列表，并通过 `selected-plugins.yml` 覆盖手动扩展的启用状态。原有 YAML 补丁保留；profile 修改前保存在 `backups/`。正式启动失败时尝试恢复启动前配置；发现其他程序已修改配置时保留该修改并报告错误。

停用本启动器只需删除它的桌面快捷方式。若需恢复原来的加载列表，先停止 DSH，将需要的 `backups/profile-*.json` 复制回 DSH 数据目录的 `profiles/web/package.json`，再通过 DSH 原有命令启动。

## 开发与验证

```powershell
npm.cmd ci --ignore-scripts
npm.cmd test
npm.cmd run test:runtime
npm.cmd run test:install
npm.cmd run test:process
```

基础测试使用临时测试数据，不依赖维护者的 DSH 安装。Windows 服务测试验证全部结果汇总、缓存复用和单插件变化重查；安装测试验证路径、快捷方式和配置保持；进程测试验证子进程清理。

适配基线为 DSH `0.1.5-rc.1` 的源码 Web 启动接口。升级 DSH 后，启动器会重新检查加载结果。

## 许可证

本项目采用 [MIT License](LICENSE)。DeepSeek Harness 和通过 npm 安装的依赖分别适用各自许可证，见 [依赖说明](THIRD_PARTY_NOTICES.md)。
