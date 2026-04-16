# Windows Coding Agent 架构与开发规划

## 1. 文档目的

本文档合并并统一以下两份方案：

- `docs/windows-coding-agent-architecture-plan1.txt`
- `docs/windows-coding-agent-architecture-plan2.md`

目标是给 Open Cowork 的 Windows coding agent 能力提供一份可执行的主方案，既用于架构决策，也用于实际开发推进。

---

## 2. 核心结论

### 2.1 不再以“bash 能否运行”作为 Windows 产品核心

Windows 上不应继续把 `bash` 当作默认执行标准。

正确方向是：

- 把 **执行能力产品化**
- 把 **shell 降级为执行后端**
- 把 **常见能力结构化**
- 把 **runtime 选择独立出来**

一句话总结：

> Windows 上不应该“设计 bash 能力”，而应该“设计跨平台执行引擎”；shell 只是兼容层。

### 2.2 推荐默认路线

Windows 默认能力应明确收敛到：

- **Native Windows + PowerShell 7 + Structured Tools**

补充执行面：

- **WSL**：Unix-first 项目的增强模式
- **Git Bash**：短期兼容 fallback，仅保留，不再作为主路径
- **Sandbox**：安全隔离与高风险动作承载面

### 2.3 必须明确拆分两套运行时

当前很多不稳定问题，本质是这两套运行时混在一起：

#### Agent Runtime
- 产品自带
- 给 agent 内部工具链使用
- 不依赖用户系统 PATH 是否正确
- 应尽量可预测、可诊断

#### Workspace Runtime
- 项目自己的 Python / Node / Git / 包管理器
- 用于 build / test / run
- 由 resolver 明确选择，不靠命令名碰运气

---

## 3. 目标架构

建议采用三层执行模型：

```text
[ Agent Core / Planner ]
            ↓
[ Execution Engine / Dispatcher ]
            ↓
┌──────────────────────┬──────────────────────┬──────────────────────┐
│ Structured Tools     │ Runtime Runners      │ Shell Adapters       │
└──────────────────────┴──────────────────────┴──────────────────────┘
```

### 3.1 Agent Core

职责：

- 规划任务
- 选择工具
- 管理上下文
- 决定执行平面
- 管理降级策略

### 3.2 Structured Tools（优先路径）

这些能力必须逐步一级化，避免默认依赖 shell：

- 文件读取 / 写入
- patch 编辑
- 全文搜索
- 目录遍历
- 文件复制 / 移动 / 删除
- 下载 / 解压
- git 基础读取
- 受控进程执行

目标：

> 80% 常见操作不再经过 shell。

### 3.3 Runtime Runners

建议逐步建设：

- `NodeRunner`
- `PythonRunner`
- `ProcessRunner`
- `PackageManagerRunner`

职责：

- 选择解释器或可执行文件
- 注入稳定 PATH
- 输出运行时诊断信息
- 区分 agent runtime 与 workspace runtime

### 3.4 Shell Adapters（兜底能力）

建议保留但降级：

- `PowerShellAdapter`（Windows 主）
- `BashAdapter`（WSL / Git Bash）
- `CmdAdapter`（极限兜底）

shell 只负责：

- 运行无法结构化的 legacy 命令
- 承接项目自己的 build/test/install 脚本
- 兼容 Unix-first 工作流

---

## 4. Windows 明确选型

### 4.1 默认执行面

Windows 默认执行面应选择：

- **PowerShell 7 first-class**

而不是：

- Git Bash first-class
- WSL first-class
- cmd first-class

原因：

- 更符合 Windows 原生生态
- 对非开发者更友好
- 子进程、编码、路径兼容性整体优于 Git Bash
- 比 cmd 有更强的结构化能力

### 4.2 Git Bash 定位

Git Bash 的定位应调整为：

- 短期兼容 fallback
- 非默认路径
- 不再作为 Windows 主方案

原因：

- 不是 Windows 原生执行面
- 无法真正等价 Linux 用户态
- 路径/编码/环境问题较多
- 不是小白用户默认具备的能力

### 4.3 WSL 定位

WSL 的定位应明确为：

- 开发者增强执行面
- Unix-first repo 的兼容模式
- 不是默认依赖
- 不是安全隔离边界

适用场景：

- 需要 `bash` / `apt` / `make` / `docker` / Linux toolchain
- 仓库明显是 Unix-first
- 用户已安装并愿意使用 WSL

### 4.4 是否内置 bash runtime

结论：

- **不把内置 bash runtime 作为 Windows 主方案**

原因：

- 不能真正解决 Linux 语义问题
- 会延续 shell 分裂
- 会增加维护成本

bash 的正确使用方式应是：

- 默认走 PowerShell
- Unix-first 项目切到 WSL
- Git Bash 仅短期兼容 fallback

---

## 5. Runtime Resolver 方案

必须引入独立的 `Runtime Resolver Service`。

### 5.1 设计目标

- 不依赖 Electron 进程继承 PATH
- 不裸用 `python` / `py` / `node` / `npm`
- 输出统一的 runtime 诊断结果
- 为 workspace 形成稳定的 `RuntimeContext`

### 5.2 统一输出建议

建议每个 workspace 输出：

- shell plane
- shell executable
- node executable
- python executable
- git executable
- package manager
- source（bundled/system/workspace/configured/wsl）
- warnings
- diagnostics

### 5.3 Python 解析顺序

建议顺序：

1. 用户显式配置
2. 项目 `.venv`
3. `uv` / Poetry / Conda / Pixi
4. `py` launcher
5. `python` in PATH

同时明确：

- 过滤 WindowsApps alias
- 明确记录解释器来源
- 尽量避免 agent 内部直接依赖系统 Python

### 5.4 Node 解析顺序

建议顺序：

1. 用户显式配置
2. 项目内已知 manager（Volta / NVM / FNM / Corepack）
3. lockfile / `packageManager` 信息
4. `node` in PATH
5. 内置 Node（Agent Runtime）

### 5.5 PATH 策略

每次执行前生成受控 PATH：

```text
PATH = [bundled_tools, workspace_bin, resolved_runtime_bin, system_paths]
```

而不是直接相信当前进程 PATH。

---

## 6. Structured Tools 迁移原则

以下能力应彻底脱离 shell：

- read file
- write file
- edit/patch
- list files
- find files
- search text
- glob
- download
- unzip/tar extract
- 文件复制/移动/删除

以下能力应逐步脱离 shell：

- git `status/diff/log/show/blame`
- 项目画像扫描
- runtime 发现
- package manager 探测

以下能力可保留 shell/CLI：

- `npm install`
- `pip install`
- 项目 build/test/run
- Linux 工具链脚本

---

## 7. Execution Planes 与职责边界

### 7.1 Native Windows Plane

默认平面，面向零配置用户。

职责：

- 文件编辑
- 搜索
- patch
- PowerShell 执行
- 基础受控进程执行
- 非 Linux 特定任务

### 7.2 WSL Plane

开发者增强平面。

职责：

- Unix-first repo
- Linux 工具链
- POSIX 假设很强的脚本

注意：

- WSL 不是默认入口
- WSL 不是 sandbox

### 7.3 Sandbox Plane

安全隔离平面。

职责：

- 不可信命令
- 自动修复动作
- 第三方安装器
- 高风险脚本

---

## 8. 面向小白用户的产品方案

目标不是“所有仓库都零配置可运行”，而是：

> 基础使用绝不能被环境卡死。

### 8.1 首次启动模式

建议只给两个入口：

1. **快速开始**
   - Native Windows mode
   - 不要求 Git Bash / WSL
   - 支持搜索、编辑、补丁、基础命令

2. **开发者增强**
   - 引导配置 WSL / Git / Python / Node / 项目运行时

### 8.2 Environment Doctor

必须做，并提供一键修复。

检测应该用“能力术语”而不是“技术术语”：

- 基础可用
  - 可搜索
  - 可编辑
  - 可执行基础命令
- 开发可用
  - 可运行 Git / Node / Python / test
- Linux 项目可用
  - WSL 已安装且可用

### 8.3 前台状态展示

建议展示：

- 当前执行平面
  - Native Windows
  - WSL Ubuntu
  - Sandbox
- 当前能力来源
  - 产品内置
  - 项目提供
  - 系统环境
  - 可选增强

### 8.4 错误提示产品化

不要直接暴露：

- `.pi/agent/settings.json`
- PATH
- WindowsApps alias
- `node-gyp`
- `bufferutil rebuild`

改成：

- 这个项目需要 Python 3.11
- 未检测到 PowerShell 7，是否使用兼容模式继续？
- 当前项目更适合在 WSL 中运行
- 可继续完成不依赖运行环境的修改

---

## 9. 与当前代码的关系

### 9.1 当前已完成的“止血措施”

这些改动应保留，属于 Phase 1 成果：

- Windows bash 接管
- WSL / Git Bash fallback
- bundled `rg`
- tools PATH 注入
- 更友好的 bash 错误提示

### 9.2 这些能力后续应逐步降级/替换

- Git Bash 从主路径降级为 fallback
- shell 搜索逐步迁到 Structured Search Tool
- 裸用 `python` / `py` / `node` 的地方迁到 Runtime Resolver
- 环境问题从“用户自己修”迁到“产品自诊断/自修复”

---

## 10. 开发规划

## Phase 1：快速止血（2–6 周）

目标：

- 新装 Windows 机器不装 Git Bash，也能完成基础 coding agent 使用。

### Phase 1.1 已完成 / 基本完成

- [x] Windows bash 执行链接管
- [x] WSL 优先 + Git Bash fallback
- [x] 自带 `rg.exe`
- [x] PATH 注入 bundled tools
- [x] Windows 包可成功打出

### Phase 1.2 立即推进（当前开始）

#### A. Shell/执行层
- [ ] Windows 默认 shell resolver 改为 **PowerShell 7 优先**
- [ ] 增加 `run_process` / `run_pwsh` / `run_bash` 基础分离接口
- [ ] Git Bash 改为 fallback-only 路径

#### B. Runtime Resolver
- [ ] 新增 `Runtime Resolver Service` 最小版本
- [ ] 先支持：shell / python / node 解析与诊断
- [ ] 过滤 WindowsApps `python.exe` alias
- [ ] 输出 runtime source / warnings / diagnostics

#### C. Structured Tools 去 shell 化
- [ ] 搜索能力统一走 bundled `rg` wrapper
- [ ] 文件搜索 / 文本搜索 不再鼓励 agent 拼 shell 命令
- [ ] patch / 文件编辑继续走内建 tool

#### D. 产品可见能力
- [ ] 加最小版 `Environment Doctor` 数据模型
- [ ] 能导出当前 runtime 诊断结果
- [ ] 错误提示去 `.pi` / PATH / alias 细节暴露

### Phase 1 成功标准

- 不装 Git Bash 也能做基础 agent 工作
- Windows 默认执行面不再依赖 cmd
- shell/runtime 选择有统一诊断输出
- 搜索能力稳定可用

---

## Phase 2：中期改造（1–2 个季度）

目标：

- 让 shell 从主通路退化为兼容层。

### 实施项

- [ ] 建立 `Execution Plane Manager`
- [ ] 建立正式 `Runtime Resolver Service`
- [ ] 引入 repo 画像
  - Windows-first
  - cross-platform
  - Unix-first
  - unknown
- [ ] 对 Unix-first repo 自动建议 WSL
- [ ] 提供 WSL 一键引导
- [ ] 建立结构化 git service
- [ ] 下载/解压/权限/移动等迁到 native tool service
- [ ] Environment Doctor 做成真实产品功能

### 成功标准

- build/test 之外的大部分 agent 工具调用不再经过 shell
- Windows 项目多数基础任务无需 shell
- 用户能明确看到当前执行平面与能力来源

---

## Phase 3：长期架构（2–4 个季度）

目标：

- 形成兼容零配置与开发者场景的 coding agent 平台。

### 实施项

- [ ] 建立 `Workspace Environment Service`
- [ ] 维护 workspace 环境档案与能力快照
- [ ] 引入受管运行时
  - Node
  - 可选 Python
  - 可选 Git
- [ ] 建立本地沙箱与远程沙箱双栈
- [ ] 推进 capability-first agent 调度模型

### 最终状态

- 用户不需要理解 shell 差异
- agent 不默认生成 shell hack
- shell 只出现在少量复杂场景中

---

## 11. 当前建议的首批开发任务（按优先级）

### P0
1. PowerShell 7 resolver 与默认 shell 切换
2. Runtime Resolver 最小骨架（shell/python/node）
3. 搜索能力 wrapper 化
4. 环境诊断数据结构

### P1
5. `run_process` / `run_pwsh` / `run_bash` 抽象
6. Python alias/launcher 问题统一修复
7. Git Bash 降级为 fallback-only
8. 错误提示产品化改造

### P2
9. repo 画像
10. WSL 一键引导
11. Structured git service
12. Workspace Environment Service 初版

---

## 12. 风险与取舍

### 12.1 选 PowerShell 7 的代价
- 一部分 POSIX 脚本不兼容
- 需要明确 shell 语义边界

收益：
- 更符合 Windows 原生场景
- 对非开发者更稳定

### 12.2 内置受管运行时的代价
- 安装包更大
- 升级维护成本上升

收益：
- 更可预测
- 小白用户体验更稳定

### 12.3 WSL 的代价
- 需要系统能力/管理员权限/可能重启

收益：
- 对 Unix-first repo 兼容性显著更强

### 12.4 结构化工具替代 shell 的代价
- 前期工程量上升

收益：
- 显著减少 quoting / 编码 / PATH / shell 语义分裂问题

---

## 14. 当前落地进度（2026-04-16）

### 14.1 已完成

#### Windows 执行面止血
- [x] Windows 下接管 `bash` tool，优先走 WSL，fallback 到 Git Bash
- [x] 修复 Windows 下 `sudo` 误走 `cmd.exe /c sudo ...` 的问题
- [x] 保留对 `~/.pi/agent/settings.json` 中 `shellPath` 的兼容读取
- [x] 自带 `rg.exe`，并已打入 Windows 安装包
- [x] 在 agent 运行时注入 bundled tools PATH

#### Runtime Resolver 基础层
- [x] 新增 `src/main/runtime/runtime-resolver.ts`
- [x] 支持 `resolvePreferredWindowsShell()`
- [x] 支持 `resolvePythonFromPath()`
- [x] 支持 `resolveNodeFromPath()`
- [x] 支持 `collectRuntimeDiagnostics()`
- [x] 支持识别 WindowsApps Python alias warning
- [x] Windows 默认 shell 选择已切到 `pwsh -> powershell -> cmd`

#### Windows PowerShell 执行器
- [x] 新增 `src/main/tools/windows-powershell-executor.ts`
- [x] `tool-executor` / `native-executor` 已接入 PowerShell resolver

#### Environment Doctor 最小版
- [x] 新增 `src/main/runtime/environment-doctor.ts`
- [x] 已提供 IPC：`diagnostics.environmentDoctor`
- [x] 已接入日志导出 `diagnostics-summary.json`
- [x] preload 已暴露 `window.electronAPI.diagnostics.getEnvironmentDoctor()`
- [x] 设置页已可查看 Environment Doctor 报告
- [x] 已展示 capability / source / warning / preflight issues
- [x] 已为缺失项提供 `fixCommand` 并支持前端一键复制

#### 用户可见错误提示产品化
- [x] `agent-runner-message-end.ts` 已识别并转义常见环境错误：
  - bash 不可用
  - Python 不可用 / WindowsApps alias / py launcher 异常
  - WSL 不可用
  - Git / CLI 缺失
- [x] 错误提示已引导用户使用“设置 → 日志/诊断 → 环境体检”完成修复

#### 多入口收敛到 Runtime Resolver
- [x] `agent-runner` 的 Windows PATH 恢复已改为复用共享 resolver helper
- [x] `mcp-manager` 不再硬编码 `powershell.exe`，改为复用 resolver
- [x] `plugin-runtime-service` 不再硬编码 `powershell.exe`，改为复用 resolver
- [x] 新增 `getWindowsRegistryPathEntries()` 共享 helper

### 14.2 当前阶段判断

当前 Phase 1 已经从“止血”进入“产品化可用”阶段：

- Windows 上不再必须依赖用户自己装好 Git Bash 才能基础可用
- 搜索能力已有 bundled `rg`
- shell/runtime 诊断已具备最小产品形态
- 用户能看到缺失项、修复建议和可复制命令
- 常见 Windows 环境报错已开始转成用户可理解提示

### 14.3 仍待开发 / 下一步重点

#### P0：继续统一执行入口
- [ ] 审查并清理剩余硬编码的 `powershell.exe` / `pwsh` / `python` / `node`
- [ ] 重点检查：
  - `src/main/mcp/gui-operate-server.ts`
  - `src/main/mcp/mcp-config-store.ts`
  - 其他 MCP / skill / plugin 启动入口
- [ ] 将更多运行入口收敛到 Runtime Resolver / Process Runner

#### P0：继续减少 shell-first 依赖
- [ ] 为搜索能力补 wrapper，减少 agent 直接拼 `rg` / `grep`
- [ ] 逐步把文件搜索 / 文本搜索迁到更结构化的工具接口

#### P1：把 Environment Doctor 从“建议修复”推进到“可操作修复”
- [ ] 为 shell / Python / Git / WSL 缺失项提供更明确的 CTA
- [ ] 评估增加：
  - 打开下载页
  - 打开设置页
  - 切换兼容模式
  - WSL 引导
- [ ] 后续再考虑真正的一键修复 / 自动安装

#### P1：Runtime Resolver 继续增强
- [ ] 加入 workspace runtime 解析（而不只看系统 PATH）
- [ ] 引入 `.venv` / Poetry / Conda / Volta / Corepack / fnm 等探测
- [ ] 区分 Agent Runtime 与 Workspace Runtime

#### P2：结构化能力建设
- [ ] 结构化 git service
- [ ] 结构化 search service
- [ ] `run_process` / `run_pwsh` / `run_bash` 统一抽象
- [ ] Execution Plane Manager / Workspace Environment Service 初版

### 14.4 最近关键提交

- `95da95a` — `feat(windows): bundle rg and add runtime resolver groundwork`

本轮提交应作为其后的连续推进，重点覆盖：

- Environment Doctor 前后端接线
- fix command 可见与复制
- 用户错误提示产品化
- Windows PATH 恢复逻辑共享化
- MCP / plugin runtime 接入 resolver

