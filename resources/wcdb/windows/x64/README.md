# Windows x64 原生组件

组件来源：<https://github.com/Wxw-Gu/TraceMemo> 的 `main` 分支（核对提交 `c3986917929e931d817596c44b07a1139d91e5c9`），准备日期 2026-11-18。

- `WCDB.dll`：`resources/wcdb/win32/x64/`
- `wx_key.dll`：`resources/key/win32/x64/`

`manifest.json` 记录各组件 SHA-256。应用加载前校验清单；清单只开放微信 Windows `4.1.9.57` 基线，不代表其他 4.x 版本已通过验证。版本基线参考上游使用文档，不代替 WeTrace 实机验收。

密钥接口采用 `InitializeHook` / `PollKeyData` / `CleanupHook`。数据库由 WeTrace 的 `src/main/windows-wcdb.ts` 直接调用腾讯公开 C 接口：`WCDBCoreCreateDatabase`、`WCDBDatabaseConfigCipher`、`WCDBHandleStatement*` 等。只读标志在创建数据库时传入，并在执行前检查语句只读属性。捕获的 64 位十六进制密钥解码为 32 字节，以 4096 页大小、cipher version 0（WCDB 默认配置）传入，与参考账号打开流程一致。此前使用 `x'hex'` 并强制 version 4 是错误配置；模拟样例已改为独立使用 32 字节和默认配置创建。真实微信连接仍待验收。

当前验证：x64 PE 完整性、哈希、公开接口加载、密钥 DLL 导出及模拟加密数据回归通过。覆盖中文路径、会话、联系人、本地头像、头像 URL 回退、消息 BLOB、跨分库分页、发送人、64 位 ID、统计、索引、错误密钥、账号目录隔离和只读文件哈希。头像读取 `head_image/head_image.db` 的 `head_image.image_buffer`，兼容明文与加密库；联系人 URL 兼容 `small_head_url`、`big_head_url` 等字段。未访问真实微信数据，未调用密钥 Hook。群成员名单从联系人库的群成员关系表读取，群昵称从群聊记录读取，缺少群昵称时沿用联系人显示名。聊天图片和语音等尚未实现的专用接口保持不可用。

此前的 `wcdb_api.dll` 存在 TraceMemo 宿主校验，返回 `-2003`；它及其 `SDL2.dll` 依赖已从打包资源移除。自有适配层不加载、修改或调用该桥接库。底层 `WCDB.dll` 目前仍取自上述参考项目，并非 WeTrace 自行编译；自主源码构建和真实账号连接是后续验收项。

重新准备组件可执行 `node scripts/prepare-windows-resources.mjs <TraceMemo源码目录>`。分发时应核对上游及各原生组件的授权条件并保留适用声明。
