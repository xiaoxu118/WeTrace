# 微信密钥获取与版本适配调研

调研日期：2026-11-03。仅核对本仓库、公开文档与源码；没有运行取钥工具、读取真实账号数据库、重签微信、修改SIP或安装外部项目。文中的第三方实测不等于WeTrace验收通过。

## 结论

存在可接入的替代方案。建议优先开发“已有密钥验证与导入 + macOS系统函数捕获 + Windows运行期对象读取”，避免继续只依赖一个按版本命名的外部二进制。

需要先区分两类32字节材料：账号级passphrase，以及按数据库盐值派生的raw key。它们都可能显示为64位十六进制，但语义不同。SQLCipher官方说明，同一passphrase配合不同数据库salt会产生不同加密密钥，也支持直接提供raw key；因此单库密钥不能无条件当成全账号密钥。[SQLCipher设计](https://www.zetetic.net/sqlcipher/design/)、[密钥输入API](https://www.zetetic.net/sqlcipher/sqlcipher-api/)

## 候选路线

| 路线 | 证据和局限 | 对WeTrace的建议 |
| --- | --- | --- |
| 验证复用已有账号密钥 | GreenBubbles的verify不附加微信进程；作者记录了既有密钥验证及新库复用。不能由进程重启推断数据库密钥必定变化。[获取文档](https://github.com/bojieli/greenbubbles/blob/main/docs/PASSPHRASE_ACQUISITION.md) | 第一优先级：先验证已有材料，失效后才启动取钥；新增外部材料导入，但不显示或记录秘密 |
| macOS观察系统派生函数 | `wcdb-key-tool`源码在CommonCrypto的`CCKeyDerivationPBKDF`调用点捕获原料；使用系统符号，减少对微信代码偏移的依赖，仍需要适当调试权限和数据库打开事件。[macOS源码](https://github.com/TANGandXUE/wcdb-key-tool/blob/main/wcdb_key_tool_macos.py) | 新增独立provider，跟踪登录导致的PID变化；不能宣传所有版本通用或无权限要求 |
| macOS临时副本初始化 | acmerfight的工具记录了Apple Silicon/macOS 15.6.1/微信4.1.15的单机流程：仅重签临时副本，由LLDB启动，SIP和原版签名保持不变。副本仍访问原账号数据，会中断当前微信使用，不能当作隔离沙箱或通用免权限方案。[工具及验证记录](https://gist.github.com/acmerfight/0a01249ef72970d07a2603dbb629e80f) | 作为后续显式选择的初始化路线研究；不自动改签原应用，也不默认要求关闭SIP |
| Windows运行期对象读取 | `wcdb-key-tool`已有针对4.1.11布局的`Config.Cipher`只读扫描与HMAC验证代码，实验性调试断点是另一条尚未证实的备用路径。[Windows源码](https://github.com/TANGandXUE/wcdb-key-tool/blob/main/wcdb_key_tool_windows.py) | 优先复用可审计实现来构建自有工具，不必将闭源取钥DLL作为唯一选择；对象布局仍须版本验证 |
| 4.0.x旧式内存模式读取 | 上述项目保留旧式密钥字面量扫描；不能据此假设4.1+继续保留同样表示。[项目说明](https://github.com/TANGandXUE/wcdb-key-tool) | 独立旧版provider，不在新版失败后无限扫描或误判成功 |
| 已导出记录/备份导入 | 能绕开实时取钥这一产品依赖，但不等于取得原数据库密钥，也不能保证支持微信原生加密备份 | 可做离线入口，与实时连接分开标注 |

本次没有找到“保持官方进程及签名不变、不改系统保护、也不需要额外进程访问权限，同时覆盖当前Mac新版”的公开通用验证方案。普通sudo或增加完全磁盘访问权限不能被当作必定能读取受保护进程的证明；上述临时副本工具也记录了官方进程访问被拒的实测。该判断是本次调研范围内的结论，不是对所有可能方法的否定。

## 版本证据与适配顺序

以下全部是候选范围，不是新增支持声明。

| 平台/版本 | 可核实的公开证据 | 后续次序 |
| --- | --- | --- |
| Mac Apple Silicon 4.1.12、4.1.13 | GreenBubbles作者记录了一个Mac/账号上的两次取钥验证；文档明确不承诺其他环境成功 | 先建立可重复的passphrase捕获、验证与PID重启回归；补齐完整build号 |
| Mac Apple Silicon 4.1.15 | 临时副本工具记录了macOS 15.6.1单机实测；其他macOS及相同短版本的不同构建不能套用结论 | 下一候选，单独记录系统版本、完整build、签名状态 |
| Windows x64 4.1.13.65 | WeChatMsg-4x作者明确标注此版本实测，并提供`wx4/key.py`与读取代码。[适配说明](https://github.com/chenanhan230-del/WeChatMsg-4x/blob/main/doc/微信4.x适配说明.md) | Windows首个明确候选；真机验收按当前要求暂缓，不先宣称支持整个4.1系列 |
| Windows x64 4.1.11 | 有标注版本的运行期读取函数；不据函数名推断所有完整构建通过 | 第二个对象布局候选 |
| Mac Intel、4.0.x及Windows其他构建 | 当前核对材料不足以给出WeTrace可声明支持的完整矩阵 | 保持待适配，按具体样本扩展 |
| 微信3.x | 与4.x在目录、加密参数、消息结构上存在明显差异；不能只增加允许的版本号 | 单独数据/加密适配器，后置处理 |

Mac 4.1.12/4.1.13的证据见上述GreenBubbles获取文档；Mac 4.1.15的证据见上述临时副本工具；Windows 4.1.11的证据见上述Windows源码。Windows 4.1.13.65相关项目采用GPL-3.0；适合核对行为和测试口径，实际代码复用须按许可证处理。`wcdb-key-tool`为MIT，适合作为优先审计候选。[MIT许可证](https://github.com/TANGandXUE/wcdb-key-tool/blob/main/LICENSE)、[GPL许可证](https://github.com/chenanhan230-del/WeChatMsg-4x/blob/main/LICENSE)

## 对当前代码的具体影响

1. `src/shared/wechat-compatibility.ts`现在只有4.1.13分支。它是允许列表，不是更多版本已经适配的证据。
2. `src/main/wechat.ts`在验证已保存密钥之前先执行版本门禁，`syncWechat`也复用这道门禁。上一轮把“自动取钥已适配”与“已有密钥可读取”绑得过紧。建议拆成两套判断：取钥按provider精确限制；读取按已知加密/结构能力、实际密钥验证与覆盖范围判断。遇到未知结构仍应停止，不能无条件放开。
3. `database-key-store.ts`和`Wcdb4Client.openAccount`当前传递单个账号密钥。接入只返回逐库raw key的工具时，需要新增带类型的密钥材料及后端能力声明，不能直接选出第一把密钥传给现有库。
4. `fetchKey`目前统一要求SIP关闭。采用其他Mac provider后应改成对应路线的前置条件检查；保留原有路线，但不再把关闭SIP当作所有方案的共同前提。
5. Windows取钥与Windows读库是两个依赖。自有取钥工具可以不依赖`wx_key.dll`；当前读库仍依赖`wcdb_api.dll`。后续可评估SQLCipher只读后端，降低闭源桥接依赖，但它不是Tencent WCDB库的直接替换件，需要自行实现现有会话、联系人、消息和媒体接口。

建议的材料模型：账号级passphrase与逐库raw-key映射分别标记，记录账号、数据库相对路径、盐值/文件身份、来源provider和验证覆盖，不将密钥放入命令行、日志或AI上下文；继续经现有系统安全存储保存。

## 建议实施批次

- 第一批：密钥材料类型、验证复用/导入、获取与读取门禁分离、虚构加密数据库回归。
- 第二批：Mac系统函数provider，优先4.1.12/4.1.13；临时副本路线单独验证，不自动修改用户环境。
- 第三批：Windows运行期对象provider，先对齐4.1.13.65，再核对4.1.11布局；目前只做源码与模拟验证，真机状态单独保留。
- 第四批：Mac 4.1.15，以及版本间消息字段、ZSTD、成员身份、媒体路径、撤回和DB/WAL一致性测试。

每个版本分别记录“取钥、session、contact、各message分库、WAL新消息、图片/语音、撤回”的通过情况；不能仅因session库可打开便标记全部聊天可用。结构探测可按列签名与字段别名设计，保持未知字段和缺口可诊断。[数据库结构参考](https://github.com/bojieli/greenbubbles/blob/main/docs/WECHAT_DATABASE_FORMAT.md)

## 依赖维护状态

chatlog主仓库目前只保留移除说明，不能继续当作可获取的官方维护实现；EchoTrace README明确说明停止维护。可用其历史设计做参考，但不应把旧文章中的“支持新版”当作当前证据。[chatlog当前README](https://github.com/sjzar/chatlog)、[EchoTrace当前README](https://github.com/ycccccccy/echotrace)

调研快照：`wcdb-key-tool` main=`79f1b5b92e12c66aa281b4a60a3c478b5f547dfa`；GreenBubbles main=`69f19c7089d7ef011e9ba43d44c6fb4e6e5be98b`。以上用公开仓库HEAD核对；未安装、编译或执行其取钥程序。
