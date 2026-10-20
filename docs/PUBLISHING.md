# 提交与发布流程

仓库包含 Windows 主程序和 server/ 配套 CLI，不包含安卓项目。Git 作者在本仓库设置为 conghexiangcai <104054665+conghexiangcai@users.noreply.github.com>。

1. 修改后检查 git diff 与状态，只暂存本次工作文件；运行 npm test 及与改动相关的隔离 UI 检查。
2. 填写 CHANGELOG.md 和 docs/releases/版本号.md。正式交付需要递增版本号、更新锁文件及 VERIFICATION-版本号.md，再执行 npm run package。
3. 检查源码、安装包和服务器包，不包含数据库、登录会话、认证、个人名单或实际测试账号。为附件生成 SHA256。
4. 提交并推送 main；分支保护要求 PR 时使用 PR。正式标签为 vX.Y.Z；推送前确认该标签不存在，已发布标签禁止覆盖。
5. 使用 gh release create 创建版本，将 notes 文件通过 --notes-file 传入，再 gh release upload 上传经检查的附件。历史版本使用 --latest=false，仅当前最新稳定版标记 latest。
6. 更新 docs/versions.md 和 docs/release-index.json 的版本、修订、commit、tag、附件和哈希。上传完成后核对 API 返回的 size、digest；失败保留本地文件，下次只补传缺失附件，不使用 --clobber。

GitHub CLI 认证由 gh auth login 完成，使用系统凭据存储；不要打印 gh auth token，不把 token 写入脚本或远程 URL。所有 Git 命令保持 TLS 证书校验。

历史 1.0.0～1.1.3 只提供脱敏源码。中间修订用 vX.Y.Z-build.N 标签；同版本只有一条 Release，附件用 build 编号区分。历史补录不回填 Git 作者日期。
