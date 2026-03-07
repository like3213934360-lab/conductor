# ArkTS LSP — ace-server 空结果诊断与修复设计

> 日期：2026-02-27
> 状态：已批准

## 问题

ace-server bridge 方案已实现，但 hover/completion/definition 返回空结果。需要确认是通信协议问题还是初始化时序问题。

## 方案：两阶段调试

### 第一阶段：独立诊断脚本

写一个纯 Node.js 脚本（`scripts/diagnose-ace.ts`），绕过 VS Code 直接与 ace-server 通信。

**脚本流程：**

1. 检测 DevEco 环境（复用 ace-bridge）
2. 解析目标项目配置
3. spawn ace-server 子进程
4. 手动实现 LSP JSON-RPC 协议（Content-Length header + JSON body）
5. `initialize` 请求 → 验证 capabilities
6. `initialized` 通知（带 `editors: []`）
7. 监听 `aceProject/onIndexingProgressUpdate` → 等索引到 100%
8. `aceProject/onAsyncDidOpen`（打开真实 .ets 文件）
9. 等待 worker 处理
10. `aceProject/onAsyncHover` → 记录完整响应
11. `aceProject/onAsyncDefinition` → 记录完整响应
12. `aceProject/onAsyncCompletion` → 记录完整响应
13. 汇总诊断结果

**每步输出：**
- `[SEND]` 完整 JSON-RPC 消息
- `[RECV]` 完整响应/通知
- `[DIAG]` 诊断判断
- `[WARN]` 可疑行为

### 第二阶段：根据诊断结果修复扩展

**三个嫌疑根因：**

1. **`initialized` 时序** — LanguageClient 自动发 `{}` + extension.ts 补发 `{editors:[]}` = 两次，第二次可能被忽略
2. **`didOpen` 在索引前** — worker 还在 `generateModuleMap` 时 `didOpen` 到达，文件不被索引
3. **响应数据结构不匹配** — `data.result` 可能不是实际数据位置

**修复流程：**
```
诊断脚本 → 确认根因 → 应用修复 → 打包 vsix → 验证
```

## 逆向关键发现

### checkModule 校验链（6 个必填字段）

```
deviceType → aceLoaderPath → jsComponentType → sdkJsPath → compatibleSdkLevel → apiType
```

当前 module-builder.ts 已正确填充所有 6 个字段。

### ace-server 通信协议

- 主进程通过 `MsgHandlerFactory.getMsgHandler(MsgType.*)` 分发消息
- 每个 handler 有 `executeOnMainThreadForClient`（主线程处理）和 `executeOnWorker`（转发给 worker）
- worker 通过 `worker_threads` 运行，入口 `./worker/index.js`
- 响应通过 `connection.sendNotification(method, {requestId, result, traceId})` 回发

### initializeOpenedFiles 机制

```javascript
// ace-server 内部：
if (editors.length === 0) return true  // 空数组 → 立即验证
if (Date.now() - receivedTime > 5000) return true  // 超时 → 立即验证
if (editors.every(e => e.receivedOpened)) return true  // 全部打开 → 验证
```

这意味着 `editors: []` 是安全的，不会导致崩溃。
