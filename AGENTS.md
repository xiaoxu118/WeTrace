# WeTrace 编码助手指南

本文件适用于整个仓库。开始任务时先阅读本文件，再按任务查阅相关代码；不必一次读取全部源码。默认使用中文沟通。

## 项目概况

WeTrace 是读取本机微信聊天记录的桌面应用，提供消息浏览与搜索、聊天规律与群成员统计、AI 对话，以及 HTML / PNG 报告。对微信原始数据库保持只读，不向微信发送消息。

- 技术栈：Electron、React、TypeScript、electron-vite、Ant Design。
- 包管理器：pnpm；依赖锁定文件为 `pnpm-lock.yaml`。
- 当前打包配置面向 macOS，原生 WCDB 资源包含 arm64 / x64；不要据此假定其他平台已受支持。
- TypeScript 开启 `strict`，采用 ES modules。部分测试直接运行 TypeScript，需要支持 `--experimental-strip-types` 的 Node.js；仓库未声明固定 Node 版本。
- 用户操作说明见 `README.md`；产品背景可参考 `WeTrace-PRD.html`，设计参考见 `design/`。实际行为以当前源码及测试为准。

## 代码导航

| 位置 | 职责 / 阅读入口 |
| --- | --- |
| `src/main/index.ts` | Electron 主进程、窗口、IPC 注册和应用生命周期 |
| `src/main/wechat.ts`、`wechat-records.ts`、`wechat-background.ts` | 微信数据读取与后台同步 |
| `src/main/wechat-records-process.ts` | 独立记录处理进程入口 |
| `src/main/wcdb4-client.ts` | WCDB 原生接口封装 |
| `src/main/chat-index.ts`、`src/shared/chat-index.ts` | 聊天索引、搜索及相关数据契约 |
| `src/main/ai-chat.ts`、`ai-chat-prompts.ts`、`ai-chat-reduction.ts` | AI 对话、提示词与上下文处理 |
| `src/main/report-generator.ts`、`report-renderer.ts`、`report-*.ts` | 报告生成、渲染、缓存、历史及诊断 |
| `src/main/*cache*.ts`、`conversation-cache-policy.ts` | 媒体 / 记录缓存及会话缓存策略 |
| `src/main/security.ts`、`database-key-store.ts`、`model-config-store.ts` | 安全存储、数据库密钥及模型配置 |
| `src/preload/index.ts`、`index.d.ts` | `window.wetrace` 桥接 API 及窗口类型声明 |
| `src/shared/` | 主进程与界面共享的类型、协议和业务计算 |
| `src/renderer/src/App.tsx` | 界面主入口与页面组织 |
| `src/renderer/src/components/` | 消息、AI、报告、统计等界面组件；`ui/` 为通用组件 |
| `src/renderer/src/styles.css`、`theme.css` | 界面样式与主题 |
| `scripts/` | 开发启动封装、业务测试及 Electron 界面测试 |
| `resources/` | WCDB 动态库、密钥捕获工具等运行资源 |
| `electron.vite.config.ts`、`electron-builder.yml` | 构建入口、打包及原生资源配置 |

## 常用命令

在仓库根目录执行，具体脚本以 `package.json` 为准。

| 命令 | 用途 |
| --- | --- |
| `pnpm install` | 安装依赖 |
| `pnpm dev` | 启动开发环境 |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm build` | 构建主进程、preload 和界面至 `out/` |
| `pnpm start` | 预览构建后的应用，需先构建 |
| `pnpm package` | 构建并生成安装包至 `dist/` |
| `pnpm test:local` | macOS WCDB 加载和 ABI 自测，不读取微信数据 |
| `pnpm test:startup` | 启动环境、启动封装及 macOS 光标测试 |
| `pnpm test:report` | 报告业务与界面测试集合，包含构建 |
| `pnpm test:index` | 索引、增量更新、搜索与界面测试，包含构建 |
| `pnpm test:cache-exclusions` | 缓存排除策略及界面测试，包含构建 |
| `pnpm test:patterns` | 聊天规律测试 |

使用现有 `scripts/run-electron.mjs` 启动 Electron；它会清理影响 Electron 启动的环境变量。不要为了绕开启动问题直接替换此封装。

## 修改约定

1. 修改前查看 `git status --short`，区分已有改动与本次任务；保留无关的已修改、未跟踪文件，不重置用户工作。
2. 优先沿用相邻代码的命名、格式及组件模式，保持修改集中，避免顺带重构大型文件。
3. 新增或修改 IPC 时，同步检查主进程处理器、`src/preload/index.ts`、`src/preload/index.d.ts` 和 `src/shared/` 类型，确保参数、返回值和事件一致。
4. 文件系统、原生库、密钥与模型调用放在主进程侧；界面通过 preload API 访问。事件订阅应返回并调用取消订阅函数。
5. 涉及跨进程记录处理时，同时检查 `src/shared/records-process.ts` 与进程两端；避免在界面线程执行大量记录计算。
6. 索引、缓存与统计修改应关注账号 / 会话隔离、增量刷新、历史完整性和现有缓存兼容性。统计口径与实际显示保持一致。
7. AI 与报告修改应保留取消、进度、错误处理和原文引用能力；生成内容中的统计、参与者和引用应依据真实记录。
8. UI 文案保持中文，优先复用现有通用组件、主题和样式。界面交互控件必须使用现有 Ant Design 组件库及项目封装，保持组件库 UI 风格；不得为绕过交互问题改用原生 select 等控件。遇到组件问题应修复事件、焦点或弹层行为。涉及使用方式变化时同步更新 `README.md`。
9. 依赖有变化时更新 `package.json` 和 `pnpm-lock.yaml`；不要手改生成文件或无关原生二进制。
10. 页面保持简洁，不主动添加无关紧要的说明文字、副标题、提示条、技术实现介绍或重复提示。只展示完成当前操作所需的标签、状态、必要错误和确认信息；额外背景与使用说明放入文档，确有必要时按需展示，避免常驻页面干扰主要内容。

## 验证方式

- 按改动范围运行 `pnpm typecheck`、`pnpm build` 和相关业务测试；纯文档改动无需运行应用测试。
- 测试主要使用 Node.js `assert` 和独立脚本，没有统一的 `pnpm test` 命令。新增回归测试优先沿用 `scripts/test-*.mjs` / `.cjs` 模式。
- 可单独执行纯逻辑测试，例如：`node --experimental-strip-types scripts/test-report-topics.mjs`。
- Electron 界面测试通常加载 `out/renderer/index.html`，需先 `pnpm build`，再执行例如：`node scripts/run-electron.mjs exec scripts/test-chat-history-ui.cjs`。
- 单独运行测试前先读脚本，确认是否依赖本机微信数据、原生库、网络或模型配置；优先使用已有模拟数据进行回归。
- 汇报实际运行的验证和结果；环境不满足时明确说明未完成的检查，不将未运行的测试描述为通过。

## 数据与文件边界

- 不提交、打印或写入测试样例中的真实聊天内容、账号标识、数据库密钥、API Key 或用户数据库。测试数据使用虚构内容。
- 维护现有安全存储路径；不要将秘密改存为明文。访问模型服务时继续遵循用户配置与现有调用流程。
- `node_modules/`、`out/`、`dist/`、`.cache/`、`.screenshots/` 和 `.pnpm-store/` 为依赖、构建或本地临时产物，不作为源码修改目标。
- `build/` 包含打包资源，`resources/` 包含运行资源，不能仅因目录名或文件为二进制就当作临时产物删除。
- 不为常规开发或测试操作真实微信数据库、捕获密钥或更改系统安全设置；相关功能优先通过模拟和现有自测验证。
