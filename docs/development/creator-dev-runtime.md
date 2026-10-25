# 开发环境的 Creator Runtime

Web 开发服务启动 Daemon 前，先调用 `scripts/build-krillinai.mjs` 检查当前 checkout 的源码与构建缓存；不一致时重新构建 CLI。下载、转录、字体和 NLP 依赖继续复用已准备的 `.pack/creator-runtime/krillinai`。

Daemon 实际使用 `.runtime/dev/creator-runtime/krillinai/<版本摘要>`。该目录独立保存当前 CLI、manifest 和 build-record，并同步两份资源的 SHA-256。后续构建或其他 worktree 替换 `.pack/bin/krillinai-cli` 时，不会替换已经选定的开发 CLI。目录资源仍接受 Daemon 的完整性校验。

合并 Runtime 源码后重新启动开发服务即可选用当前分支；只合并 Go 源码不会热替换已经启动的翻译子进程。显式设置 `OPENCREATOR_CREATOR_RUNTIME_ROOT` 时仍使用指定目录，便于验证固定版本。

这个流程仅用于 Web 开发环境，不修改 Desktop 安装包、生产网关或已有任务价格。已启动的任务沿用原子进程，更新开发版本应等待当前任务结束，避免中断或重复请求。
