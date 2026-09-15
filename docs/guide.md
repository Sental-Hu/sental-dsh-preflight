# 配置、备份与恢复

[返回 README](../README.md) · [English](guide.en.md)

## 安装配置

启动器目录中的 `launcher-config.json` 保存安装时选择的 DSH 源码目录和数据目录。以下环境变量可覆盖对应配置：

| 环境变量 | 用途 |
| --- | --- |
| `DSH_LAUNCHER_REPO` | DSH 源码仓库路径 |
| `DSH_HOME` | DSH 数据目录路径 |

使用绝对路径。移动启动器、DSH 仓库或数据目录后，关闭选择窗口并重新运行安装命令，更新配置和快捷方式。

## 文件位置

以下文件在运行时生成，位于启动器目录中：

| 文件或目录 | 内容 |
| --- | --- |
| `launcher-config.json` | 安装路径配置 |
| `selection.json` | 上次点击启动时保存的插件选择 |
| `check-cache.json`、`fingerprints.json` | 检查结论与文件变化缓存 |
| `last-check.json` | 最近一次检查结果 |
| `selected-plugins.yml` | 手动扩展启用状态的启动覆盖配置 |
| `check-logs/` | 逐项检查日志 |
| `launcher.log`、`dsh.stdout.log`、`dsh.stderr.log` | 启动器和正式服务日志 |
| `backups/` | 修改前的 profile 配置备份 |

需要完整重查时，优先点击 **强制重新检查**；也可以关闭选择窗口后删除 `check-cache.json` 和 `fingerprints.json`，再重新打开。

日志可能包含本机路径、插件配置或错误上下文。反馈问题时只提交必要片段，并移除凭据和个人信息。

## 启动时如何保存配置

所选组合通过验证后，启动器更新 Web profile 的 bundle 加载列表，并通过 `selected-plugins.yml` 覆盖手动扩展的启用状态。原有 YAML 补丁保留。

profile 修改前会备份到 `backups/`。正式启动失败时，启动器尝试恢复启动前的配置；如果发现其他程序已修改该配置，则保留该修改并报告错误，避免覆盖别人的更新。

## 恢复原来的加载列表

1. 等待当前任务结束，停止 DSH 并关闭启动器选择窗口。
2. 在启动器的 `backups/` 中找到需要恢复的 `profile-*.json`，检查其中的插件列表。
3. 备份当前 DSH 数据目录中的 `profiles/web/package.json`，再用选定的备份文件替换它。
4. 通过 DSH 原有命令启动，不附加启动器生成的覆盖配置。

这些备份保存加载配置，不包含插件安装包或 DSH 代码。恢复加载列表不会回退已更新的软件版本。

## 停止使用启动器

删除桌面的 **Sental DSH Preflight** 快捷方式即可停止从它启动 DSH。如需删除启动器目录，先停止相关服务，并保留需要的配置备份与日志。

删除快捷方式或启动器目录不会自动恢复之前的插件列表。需要恢复时，请先按上面的步骤处理。
