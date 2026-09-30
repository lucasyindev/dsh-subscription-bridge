# dsh-subscription-bridge

为 DeepSeek Harness 添加一个简洁的 OAuth 订阅登录入口。登录已有账号后，由 Harness 原生厂商实现使用支持的模型，Agent、工具、技能和任务仍在 Harness 内运行。

这是个人维护的非官方插件，不是 DeepSeek 或任何模型厂商的官方产品。当前版本 **0.1.4**，验证基于 **DeepSeek Harness 0.2.0-rc.2**。

## 为什么做这个项目

我希望在 DeepSeek Harness 中使用已有的厂商订阅，而不是为每个厂商切换一套 Agent 工具，也不想维护一个包含 OAuth 协议、token 文件和模型 API 适配的大型插件。

在所验证的 Harness 版本中，官方 `llm-pi-ai` 已具备原生登录、凭据存储和自动刷新能力。本项目补上一个易用的设置入口，集中显示登录状态，完成必要的交互和模型路由启用。

**目标只有一个：把 Harness 已有的 OAuth 登录能力用起来。** 不做用量面板、账号池、额度调度或另一套 Harness。

## 基于什么

项目建立在 [DeepSeek Harness 官方源码](https://github.com/deepseek-ai/deepseek-harness/tree/639ed015397290b3745d163aafe02ffee4aa3f84) 和公开插件接口上：

- **authorization**：发现并调用已注册的原生 OAuth flow，传递登录提示、答复和取消操作。
- **credentials**：读取不含凭据值的状态；登录写入和 token 刷新由官方实现管理。本插件不创建自己的 token 存储。
- **llm / settings**：登录后尝试启用原生模型路由，不覆盖已有配置或显式 API Key 引用。
- **Connection / settings.section**：通过官方受认证连接通信，将界面放入原有设置页；字体、主题、控件规范沿用官方设置界面。

OAuth 具体实现来自 Harness 集成的 [`llm-pi-ai`](https://github.com/deepseek-ai/deepseek-harness/tree/639ed015397290b3745d163aafe02ffee4aa3f84/packages/llm/llm-pi-ai)，其上游为 [pi](https://github.com/earendil-works/pi)。本插件调用这些原生能力，**没有把 pi 的 OAuth 源码复制一份，也没有调用 Codex / Claude / Gemini CLI 来启动另一个 Agent**。

请求路径：Harness Agent → Harness LLM 服务 → 原生 pi-ai 厂商实现 → 厂商服务。插件负责登录入口，不接管模型请求。

## 有什么好处

- **少维护一层协议**：OAuth、token 刷新、模型协议和流式请求继续由上游实现处理。
- **保留 Harness 工作流**：换模型不等于换 Agent；仍使用原有工具、权限、技能、任务和模型选择器。
- **保持轻量**：只提供登录、提示答复、取消和本地登录管理，没有私有代理或后台账号池。
- **保护已有配置**：已有 API-key 记录和显式 API Key 引用不会被订阅登录覆盖；只删除选中的本地 grant，不取消订阅、不撤销厂商侧授权。
- **贴近原生界面**：使用官方字号、字重和主题 token，支持中英文，并保留明确的加载、错误和重试状态。

这些是架构和交互上的好处，不代表绕过厂商限制、无限额度，或保证每家付费订阅都能使用。

## 能做什么

在「设置 → 订阅登录」中：

1. 动态列出当前 Harness 已注册、支持 OAuth 的 `llm-pi-ai/*` 厂商。
2. 发起登录，显示原生授权页面、验证码或账号选择等提示。
3. 答复提示或取消本插件发起的登录。
4. 登录成功后尝试启用原生模型路由，再通过普通模型选择器选择模型。
5. 查看本地登录状态，或在确认后移除所选厂商的本地登录。

厂商列表不是硬编码的“所有订阅都支持”清单。实际可用性由安装的 Harness / pi-ai 版本、厂商政策和账号资格决定。“已保存登录”仅表示本地存在凭据，不表示远端 token、订阅资格或模型调用已验证。

## 安装：macOS 桌面版

目前仓库提供源码；以下命令在本地构建安装包，不向 npm 发布任何内容。开发需要 Node.js **24+**；具体支持范围见 package.json。

```sh
git clone https://github.com/lucasyindev/dsh-subscription-bridge.git
cd dsh-subscription-bridge
npm ci --ignore-scripts
npm run build
npm test
npm pack
```

先运行一次桌面应用以初始化 profile，然后用 **⌘Q 完全退出 DeepSeek Harness**。在上面的项目目录执行：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" \
  plugin --profile desktop add "$PWD/dsh-subscription-bridge-0.1.4.tgz"
```

重新打开桌面应用，进入「设置 → 订阅登录」。使用**桌面应用自带的 CLI**，不要误用另一份 npm 安装的 dsh。通过官方 `plugin add` 安装即可，不要再把同一个插件手写进 profile，以免重复加载。

### Web profile

确认安装的 dsh 为 `0.2.0-rc.2`，构建后执行：

```sh
dsh plugin --profile web add "$PWD/dsh-subscription-bridge-0.1.4.tgz"
dsh --profile web
```

不宣称其他 Harness 版本、其他系统或手机设置布局已兼容。

## 安全与边界

插件只注册六个精确的受认证 Fetch 路由，不占用官方 Gateway 的 `/api` 全局拦截器；客户端使用 Harness 自带的 RPC transport。

浏览器状态不包含 access token / refresh token，OAuth 库的原始错误也不转发到 UI 或本插件日志。授权提示可能包含短期 URL 或验证码，这是登录流程本身；外部链接仅允许不含用户名和密码的 HTTPS 地址。提示答复会经过 Harness 连接，但不写入本插件日志或持久文件。

本插件不扩展厂商授权范围，也不将开源实现视为厂商允许任何使用方式的证明。账户与订阅是否适用于原生登录，需要按厂商规则判断。

**不要安装旧 0.1.2 包**：该版本存在与官方 Gateway 冲突的启动故障。0.1.3 已修复，0.1.4 保留修复；详见 [验证记录](VERIFICATION.md)。

## 开发与验证

```sh
npm run build
npm test
```

代码分为 Host 与 Client，分别进行严格 TypeScript 检查。浏览器 bundle 使用 Harness 官方 ModuleLoader 格式。

0.1.4 的验证包括：12 项自动测试；隔离官方桌面运行时的 Gateway / 认证回归；真实 macOS 桌面设置页加载、官方设置与模型配置 RPC；隔离 UI 的明暗主题、键盘操作、提示/取消和错误状态。

**没有用测试替身证明真实订阅可用**。本次发布没有重新完成真实账号授权、token 刷新或模型调用；详细证据边界见 [VERIFICATION.md](VERIFICATION.md)。

发布时 npm audit 发现一个上游 fflate 问题，沿官方 DSH Office 开发依赖链显示为 8 项中等告警；未强制升级锁定版本。详见验证记录的「当前依赖告警」，不宣称依赖无漏洞。

## 许可与来源

本项目使用 [MIT License](LICENSE)。插件源码为独立实现；调研过社区订阅插件，但没有复制其 OAuth 栈或源码。上游 DeepSeek Harness、pi 及其他依赖分别遵循自己的许可；本项目不是这些上游项目的官方分发。
