# 验证记录

版本：0.1.4。日期：2026-09-30。验收环境：macOS、DeepSeek Harness Desktop 0.2.0-rc.2。

## 已验证

- Host 与 Client 严格 TypeScript 检查及构建成功，12 项自动测试通过。测试使用官方 Authorization 与临时 credentials-local 存储；其中 LLM/settings 行为单测使用替身，不能等同于真实模型服务。
- 发布前在新的独立目录执行 npm ci --ignore-scripts，从锁定依赖重新安装，构建与 12 项测试再次通过；不是只沿用旧 node_modules 的结果。
- 使用桌面自带 Electron 运行时启动隔离 profile：官方设置、模型配置目录和插件列表 RPC 返回 200/成功；未认证请求为 401，跨来源请求为 403。
- 使用桌面自带 CLI 安装 0.1.4，真实 dsh-app://app/ 设置页能列出 8 个原生 OAuth flow；插件无页面错误，官方设置与模型配置 RPC 正常。之后恢复普通桌面启动，临时调试端口关闭，没有新增启动崩溃日志。
- 安装前后本地凭据文件校验相同，profile 补丁未改变；已有登录仍显示。没有覆盖、删除或重新授权这些登录。
- 真实浅色桌面 UI：标题 16px/500，厂商标题 14px/500，普通厂商行约 66.5px，无插件内容横向溢出。
- 使用相同 React 组件及官方字体/主题 token 的隔离 UI 测试，覆盖 1280/788/390px、中英文、明暗主题、未登录、保存登录、路由未启用、API-key 禁用、加载、空列表、错误、不可用和原生 prompt 展示。浏览器运行错误为 0，非禁用文本与占位文字对比度至少 4.5:1。
- 隔离 UI 交互覆盖：键盘 Enter 发起、必选项禁止空提交、选项答复、密码输入框、授权链接安全属性、取消并移除 prompt。这些测试使用合成状态，不连接真实账号。

## 未验证

- 本次 0.1.4 验证没有提交真实账号或授权 code，没有执行模型请求，也没有验证真实 token 刷新、订阅资格和远端 token 当前有效性。
- 已有真实登录的厂商不会在测试中重新授权。0.1.3 曾完成真实桌面 Codex 原生方式选择与取消；本次当前 UI 的相应交互用隔离测试覆盖。
- 各厂商完整真实授权流程、手机官方设置布局、其他操作系统与未来 Harness 版本未验收。
- 深色/提示/错误/窄宽度检查主要是隔离组件测试，不冒充所有真实桌面状态已端到端验收。
- 构建成功、测试通过和截图不等于整套 Harness 所有功能健康，也不等于每个订阅能成功调用模型。

## 历史故障

0.1.2 占用了官方 /api Gateway 的唯一 RPC interceptor，导致官方设置和模型 Remote 404，并阻断桌面 welcome 请求。0.1.3 已改为六个精确 authenticated Fetch 路由；0.1.4 的 Host 构建文件与 0.1.3 相同，保留修复。

不要安装旧 0.1.2。仓库不上传真实凭据、本机 profile、浏览器账号、调试日志或合成授权存储。

## 当前依赖告警

2026-09-30 的在线 npm audit 报告 8 项 moderate、0 项 high/critical。这 8 项是一个 fflate 问题沿官方 DSH Office 开发依赖链传播的结果，不是 8 个独立漏洞。

链路为开发依赖 @deepseek-ai/dsh → 官方 Office 相关包 → @deepseek-ai/libreoffice-kit → fflate。对应 [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98)：受影响的 unzipSync 处理特定畸形 ZIP64 时可能陷入无限循环。

本插件的 OAuth 代码不调用 Office/ZIP 处理；安装包也不携带 node_modules。但这不等于证明整个上游运行时没有风险。没有执行 npm audit fix --force 或擅自升级已锁定的 Harness 版本；升级需重新做兼容性验证。公开锁文件保留实际依赖状态，不将测试通过表述为“无漏洞”。
