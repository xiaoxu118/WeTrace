# 原生平台与版本适配

## 当前状态

| 平台 | 架构 | 微信版本 | 实现与验证 |
| --- | --- | --- | --- |
| macOS | arm64 | 4.1.13 分支 | 已有专用密钥工具；本机WCDB ABI自测通过，不能代替所有业务真机验收 |
| macOS | x64 | 4.1.13 分支 | 已有库与通用密钥工具；未做本轮x64真机验收 |
| Windows 10/11 | x64 | 待资源清单指定 | 已实现加载、校验、密钥工具调用、路径、进程检测与安装配置；尚缺可发布原生资源和真机验收 |
| 其他版本/架构 | — | — | 不自动套用其他密钥版本；明确提示未适配 |

密钥适配矩阵位于 `src/shared/wechat-compatibility.ts`。新增版本必须补充真实适配器、数据库字段与媒体样本回归，不能仅向矩阵添加版本号。发送通道单独匹配完整版本号，不从读取成功推断发送可用。

## Windows资源约定

在 `resources/wcdb/windows/x64/` 提供 `wcdb_api.dll`、`WCDB.dll`、`key-helper.exe` 和 `manifest.json`：

```json
{"schema":1,"versions":["已适配的完整4.x版本号"],"files":{"wcdb_api.dll":"SHA-256","WCDB.dll":"SHA-256","key-helper.exe":"SHA-256"}}
```

应用在加载前校验全部文件与清单，缺失或篡改则拒绝。`key-helper.exe capture --account-root <账号目录> --json` 需输出 `{"success":true,"key":"64位十六进制原始密钥"}`，失败输出 `{"success":false,"result":"ERROR:错误码"}`。主进程继续用WCDB校验当前账号数据库后才经Electron安全存储保存密钥，不把“找到候选密钥”等同于连接成功。此辅助程序尚未附带，不是可用Windows支持的声明。

`pnpm package:windows` 先检查资源，再构建x64 NSIS安装包；不会打包macOS dylib或macOS密钥工具。尚未运行Windows打包和真机安装测试。

Windows DLL依赖名和读取函数接口参考[EchoTrace原生接口文档](https://github.com/ycccccccy/echotrace/blob/main/docs/wcdb_realtime.md)，函数声明沿用现有WCDB桥接。需要来自合法分发源的兼容资源，不能据文档推断任意同名DLL可用。

## 发送通道

见[发送通道协议](../resources/send-bridge/README.md)。当前只完成调度、持久化、用户界面和通道调用协议，没有附带已适配的微信发送执行器，因此真实送达尚未实现和验收。没有原生适配时，功能保持关闭；可创建待确认草稿，但不能生成可执行任务。
