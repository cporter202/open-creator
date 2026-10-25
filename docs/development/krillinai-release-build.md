# KrillinAI 发布构建校验

`pnpm desktop:package`、`pnpm desktop:dist`、`pnpm desktop:release` 和 `pnpm krillinai:package` 均使用当前 checkout 中的 `runtime/krillinai` 源码。构建不会自动切换分支或拉取远端；应先将需要发布的代码合并到构建分支。

构建缓存同时绑定源码内容 SHA-256（包括未提交修改）、Git commit、版本、构建脚本及其校验工具、目标系统和架构。只有 CLI、Server 及各自发布产物的文件摘要都一致时才能复用。编译期间源码发生变化会使构建失败，不生成有效构建清单。

准备 Creator Runtime 时，重新验证当前源码和实际 CLI，随后将构建配方摘要及原始 CLI 摘要写入 `manifest.json`、`build-record.json`。打包前、Electron `afterPack` 和最终 `verify-package` 再次检查。只有旧 CLI 和旧清单的自洽缓存也会被拒绝，不能仅通过重写资源文件摘要绕过检查。

macOS Developer ID 签名前必须匹配原始 CLI；签名后记录原始与签后摘要的对应关系，最终包同时校验来源和签后完整性。Windows 及未签名目录包直接对照原始构建摘要。Desktop 构建清单记录 `krillinBuild`，独立 CLI/Server 压缩包同样需要通过当前源码校验。

这些检查发生在构建和打包阶段，不访问模型供应商，也不修改已安装客户端或正在执行的任务。
