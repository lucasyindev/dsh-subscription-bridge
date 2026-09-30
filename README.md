# dsh-subscription-bridge

为 DeepSeek Harness 添加一个简洁的 OAuth 订阅登录入口。登录已有账号后，由 Harness 原生厂商实现使用支持的模型，Agent、工具、技能和任务仍在 Harness 内运行。

这是个人维护的非官方插件，不是 DeepSeek 或任何模型厂商的官方产品。当前版本 **0.1.6**，验证基于 **DeepSeek Harness 0.2.0-rc.2**。

## 为什么做这个项目

我希望在 DeepSeek Harness 中使用已有的厂商订阅，而不是为每个厂商切换一套 Agent 工具，也不想维护一个包含 OAuth 协议、token 文件和模型 API 适配的大型插件。

在所验证的 Harness 版本中，官方 `llm-pi-ai` 已具备原生登录、凭据存储和自动刷新能力。本项目补上一个易用的设置入口，集中显示登录状态，完成必要的交互和模型路由启用。

**目标只有一个：把 Harness 已有的 OAuth 登录能力用起来。** 不做用量面板、账号池、额度调度或另一套 Harness。

## 基于什么

项目建立在 [DeepSeek Harness 官方源码](https://github.com/deepseek-ai/deepseek-harness/tree/639ed015397290b3745d163aafe02ffee4aa3f84) 和公开插件接口上：

- **authorization**：发现并调用已注册的原生 OAuth flow，传递登录提示、答复和取消操作。
- **credentials**：浏览器只收到不含凭据值的状态。Host 查询 Codex 目录时，通过原生 pi 解析 Harness 中的 grant；token 刷新仍由 pi 在 Harness 的串行凭据事务中完成。不创建自己的 token 存储。
- **llm / settings**：登录后尝试启用原生模型路由；Codex 目录刷新只替换该路由的 `models` 字段，保留其他路由与参数。不会覆盖 API Key 引用、自定义 endpoint/protocol 或非空 modelOverrides。
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
6. 对 `openai-codex`，启动客户端及每次打开原生模型选择器（包括 `/model`）时，从当前账号在线更新模型目录。新模型不需要逐个写进插件。

厂商列表不是硬编码的“所有订阅都支持”清单。实际可用性由安装的 Harness / pi-ai 版本、厂商政策和账号资格决定。“已保存登录”仅表示本地存在凭据，不表示远端 token、订阅资格或模型调用已验证。

### 在线模型目录

沿用 [OpenAI 官方 Codex 的目录请求方式](https://github.com/openai/codex/blob/main/codex-rs/model-provider/src/models_endpoint.rs)，访问固定的 `https://chatgpt.com/backend-api/codex/models`，使用 Harness 当前账号的原生 OAuth grant。不会读取 Codex CLI 的 auth.json/models_cache.json，不启动另一个 Agent，不需要 API Key。

目录协议兼容参数为 `client_version=0.159.0`，它与本插件的版本不同；User-Agent 标识本插件，originator 与原生 pi 推理链路一致。此接口存在客户端版本门槛，未来协议变化仍可能需要更新插件，不承诺永久免维护。

模型 id、名称、上下文、输入类型和支持的推理档位来自在线响应。只显示 `visibility=list`，保留服务端顺序，不导入服务端提示词/工具设置，也不把模型别名映射成其他模型。原生 Harness 不能表示的 `ultra` 委派模式不显示；没有远端输出上限时沿用原生容量缺省，不编造参数。

“每次拉取”指**每次打开选择器**，不是每条推理请求。并发菜单共享一次在途请求；请求有超时、大小限制、禁止重定向及响应校验。失败保留上次成功列表，明确显示更新失败，重新打开可重试；本地 `models` 只是原生路由所需的最后成功结果，不是权威目录，也不保证旧列表对当前账号仍可调用。此功能会接管默认 `openai-codex` 路由的 `models` 字段；需要手工固定模型目录时，应停用本插件的刷新接入。

rc.2 没有公开的强制刷新菜单接口，因此 Client 使用版本限定的 `directory.load()` 装饰层，并检查内部共享目录的 refresh 能力；不替换选择、任务投影或模型请求。不兼容时显示错误并保留原生加载，卸载时恢复原方法。其他订阅厂商仍使用各自原生目录，不宣称已全部接入在线刷新。

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
  plugin --profile desktop add "$PWD/dsh-subscription-bridge-0.1.6.tgz"
```

重新打开桌面应用，进入「设置 → 订阅登录」。使用**桌面应用自带的 CLI**，不要误用另一份 npm 安装的 dsh。通过官方 `plugin add` 安装即可，不要再把同一个插件手写进 profile，以免重复加载。

### Web profile

确认安装的 dsh 为 `0.2.0-rc.2`，构建后执行：

```sh
dsh plugin --profile web add "$PWD/dsh-subscription-bridge-0.1.6.tgz"
dsh --profile web
```

不宣称其他 Harness 版本、其他系统或手机设置布局已兼容。

## 安全与边界

插件只注册七个精确的受认证 Fetch 路由，不占用官方 Gateway 的 `/api` 全局拦截器；客户端使用 Harness 自带的 RPC transport。

浏览器状态不包含 access token / refresh token，OAuth 库的原始错误也不转发到 UI 或本插件日志。授权提示可能包含短期 URL 或验证码，这是登录流程本身；外部链接仅允许不含用户名和密码的 HTTPS 地址。提示答复会经过 Harness 连接，但不写入本插件日志或持久文件。

本插件不扩展厂商授权范围，也不将开源实现视为厂商允许任何使用方式的证明。账户与订阅是否适用于原生登录，需要按厂商规则判断。

**不要安装旧 0.1.2 包**：该版本存在与官方 Gateway 冲突的启动故障。0.1.3 已修复，0.1.4 保留修复；详见 [验证记录](VERIFICATION.md)。

## 开发与验证

```sh
npm run build
npm test
```

代码分为 Host 与 Client，分别进行严格 TypeScript 检查。浏览器 bundle 使用 Harness 官方 ModuleLoader 格式。

0.1.6 已通过 23 项自动测试，以及隔离官方桌面运行时的 Gateway / 认证回归与新模型路由解析。实际桌面已安装并验证：原生菜单和 `/model` 均能显示 GPT-6.1 Sol，重复打开产生不同时间戳的成功刷新。新模型来自当前 Harness 账号的在线目录，不是硬编码或从另一份 CLI 缓存导入。

**没有用测试替身证明真实推理可用**。本次没有重新完成真实账号授权、过期 token 刷新或模型推理调用；目录成功不等于推理和工具调用已经验收。

发布时 npm audit 发现一个上游 fflate 问题，沿官方 DSH Office 开发依赖链显示为 8 项中等告警；未强制升级锁定版本。详见验证记录的「当前依赖告警」，不宣称依赖无漏洞。

## 许可与来源

本项目使用 [MIT License](LICENSE)。插件源码为独立实现；调研过社区订阅插件，但没有复制其 OAuth 栈或源码。上游 DeepSeek Harness、pi 及其他依赖分别遵循自己的许可；本项目不是这些上游项目的官方分发。
