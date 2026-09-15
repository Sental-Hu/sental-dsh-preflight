# DSH Launcher

**先看清插件是否能加载，再启动 DeepSeek Harness。**

面向 Windows 的 DeepSeek Harness 两段式启动器。更新 DSH 或插件后，如果某个扩展加载失败，可以在独立窗口查看检查结果、取消勾选，再启动其余插件组成的 DSH。

**结果集中展示 · 插件自由勾选 · 最多 3 项并行检查 · 变化才重查 · 记住上次选择**

[快速开始](#快速开始) · [如何使用](#如何使用) · [缓存规则](#缓存规则) · [常见问题](#常见问题) · [配置与恢复](docs/guide.md)

## 界面预览

### 看清问题，再决定加载哪些插件

检查结果集中显示在一个列表中。红色行展示加载失败的原因，勾选框决定本次加载哪些插件；取消勾选会保留插件安装和数据。

![插件检查结果：加载状态、错误原因与插件选择](docs/images/plugin-selection.png)

### 没有变化，直接沿用上次结论

再次打开时恢复已有结果，并显示原检查时间。插件、DSH 或相关配置发生变化后，再检查受影响的项目。

![缓存结果：沿用上次结论与检查范围](docs/images/cached-results.png)

## 如何使用

| 步骤 | 你会看到什么 | 需要做什么 |
| --- | --- | --- |
| **1 · 检查** | 基础环境和各插件的加载结果；变化项并行检查 | 等待本轮检查全部完成 |
| **2 · 选择** | 绿色通过、红色失败、黄色无法确定 | 选择要加载的插件，暂时停用有问题的扩展 |
| **3 · 启动** | 所选插件组合的验证结果 | 点击“启动 DeepSeek Harness”，通过后进入 DSH |

单项检查会把多个问题一起列出来。所选插件还会进行组合验证，确认它们一起加载时能否启动。选择在点击启动后保存，下次打开会恢复。

## 快速开始

### 1. 准备运行环境

| 项目 | 要求 |
| --- | --- |
| 系统 | Windows 10/11，Windows PowerShell 5.1 |
| Node.js | 22 或更高版本，同时满足所用 DSH 版本的要求；终端可运行 `node.exe` 和 `npm.cmd` |
| DSH | 已完成构建的 [DeepSeek Harness 源码仓库](https://github.com/deepseek-ai/deepseek-harness)，存在 `apps/cli/lib/bin.js` |
| 数据目录 | 已初始化的 `web` profile，通常位于 `%USERPROFILE%\.dsh\profiles\web` |
| 浏览器 | Edge 用于独立应用窗口；没有 Edge 时使用默认浏览器 |

当前版本适配 **DSH 源码 Web 模式**，正式服务使用 `127.0.0.1:3080`。本项目是社区启动工具，与官方 Electron 客户端分别安装和运行。

### 2. 下载并安装启动器

通过本仓库的 **Code → Download ZIP** 下载并解压，或使用 Git 克隆。将启动器放在可写、准备长期保留的目录，在该目录打开 PowerShell，运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-Launcher.ps1 -RepositoryPath "C:\Projects\deepseek-harness"
```

将示例路径替换为自己的 DSH 源码目录。安装脚本验证环境、使用锁定版本安装依赖，并创建桌面上的 **DSH Launcher** 快捷方式。安装过程不启动 DSH，也不修改 DSH profile。

<details>
<summary>自定义数据目录或使用其他启动方式</summary>

指定自己的 DSH 数据目录：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install-Launcher.ps1 -RepositoryPath "C:\Projects\deepseek-harness" -DshHome "D:\DSHData"
```

添加 `-NoShortcut` 可以只保存配置，之后双击 `Launch-DSH.vbs`。环境禁用 VBScript 时，运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Launch-DSH.ps1
```

</details>

### 3. 打开桌面快捷方式

双击 **DSH Launcher**，等检查完成后调整勾选，点击 **启动 DeepSeek Harness**。

首次检查需要实际试加载，耗时会随插件数量和加载速度变化。后续启动复用未变化项目的结果。

## 缓存规则

| 发生了什么 | 启动器如何处理 |
| --- | --- |
| DSH、插件及相关配置没有变化 | 恢复上次结论和检查时间 |
| 单个外部插件或其依赖文件变化 | 重新检查受影响的项目 |
| DSH 运行文件或检查逻辑变化 | 重新检查全部项目 |
| 只调整勾选 | 保留单项结果，启动前验证所选组合 |
| 相同组合已通过，相关文件未变化 | 复用组合结论，再检查正式服务是否健康 |
| 点击“强制重新检查” | 忽略已有检查结论，重新执行检查 |

成功、失败和无法确定的结果都会缓存。网络、凭据、外部服务状态等变化无法通过文件变化自动识别，此时请使用 **强制重新检查**。手动插入扩展的任意外部脚本或服务变化，也应主动重查。

## 检查范围

- **可选项目**：Web profile 中的外部插件 bundle，以及用户补丁中带有 `id` 和 `name` 的直接插入项。基础组件固定加载，嵌套插件组不提供逐个开关。
- **实际试加载**：使用临时 DSH 数据目录、工作目录和端口，检查独立加载、页面与启动资源，可发现资源 404、接口缺失和依赖声明错误等问题。
- **组合验证**：单个插件可能依赖其他插件、正式凭据或特定工作目录；独立检查的失败需要结合所选组合和实际运行判断。
- **启动恢复**：复用健康实例，故障时最多恢复一次；端口被其他程序占用时保留该程序并显示错误。

检查通过表示对应加载与资源检查通过，不代表插件全部业务功能都已测试。检查会实际执行插件代码，请只检查可信来源的插件，详见 [安全说明](SECURITY.md)。

## 常见问题

### 取消勾选会卸载插件吗？

不会。它调整本次加载列表，保留插件安装和数据，之后可以重新勾选。

### 红色插件还能勾选吗？

可以。有些插件独立加载时缺少依赖，组合加载时可能正常；所选组合必须通过验证才能正式启动。

### 可以在 DSH 运行时即时开关插件吗？

本项目提供启动前的选择流程。改变选择后可能重启 DSH，请在当前任务结束后切换插件。

### 基础环境检查失败怎么办？

查看界面错误与检查日志，先确认 DSH 已构建、数据目录正确。启动器可以帮助定位加载问题，但不会自动修复 DSH 本体或回退版本。日志位置见 [配置与恢复](docs/guide.md#文件位置)。

### 如何恢复原来的配置或停止使用？

见 [恢复原来的加载列表](docs/guide.md#恢复原来的加载列表) 和 [停止使用启动器](docs/guide.md#停止使用启动器)。

## 开发与验证

```powershell
npm.cmd ci --ignore-scripts
npm.cmd test
npm.cmd run test:runtime
npm.cmd run test:install
npm.cmd run test:process
```

基础测试使用临时测试数据，不依赖维护者的 DSH 安装。Windows 服务测试验证全部结果汇总、缓存复用和单插件变化重查；安装测试验证路径、快捷方式和配置保持；进程测试验证子进程清理。GitHub Actions 在 Windows 上使用 Node.js 22 和 24 运行测试。

适配基线为 DSH `0.1.5-rc.1` 的源码 Web 启动接口。反馈问题时，请提供 DSH 与 Node.js 版本、复现步骤，以及已移除敏感信息的错误片段。

## 许可证

本项目采用 [MIT License](LICENSE)。DeepSeek Harness 和通过 npm 安装的依赖分别适用各自许可证，见 [依赖说明](THIRD_PARTY_NOTICES.md)。
