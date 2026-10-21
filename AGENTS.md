# 本项目协作与发布规则

- GitHub 仓库：https://github.com/conghexiangcai/dy-tools 。本仓库包含 Windows 桌面版和服务器打卡脚本，安卓工程另行维护。
- 用户已授权：完成本项目修改并通过相应检查后，提交并推送本次改动；发布新版本时同步中文更新说明、版本号、Git 标签、GitHub Release、安装包／服务器包和 SHA256。不要只交付本地 ZIP 而遗漏 GitHub。
- 只提交本次工作涉及的文件。保留用户未提交改动，禁止强制推送、覆盖已发布标签或删除历史附件。遇到远程分支变化先核对，必要时通过 PR。
- 项目 Git 作者使用 conghexiangcai <104054665+conghexiangcai@users.noreply.github.com>，仅设置仓库级配置；不要使用或修改全局公司邮箱。
- 每次发布建立新的版本号。修复通常增加 patch，新增功能增加 minor；历史补录标签除外。正式标签为 vX.Y.Z，同一历史版本的早期修订为 vX.Y.Z-build.N。
- 发布说明包括功能、修复、限制、验证证据和升级方法；未验证的线上能力不得声称可用。CHANGELOG.md、docs/versions.md 和 docs/releases/ 同步维护。
- 代码进入 Git；二进制压缩包放 GitHub Release，不提交 node_modules、dist、release、output、backups、SQLite、浏览器会话、登录认证、真实邮箱授权码、个人名单及导出。示例和测试使用合成数据。
- 历史 1.0.0～1.1.3 只能发布脱敏源码，不重新上传原始安装包。所有历史发布副本先检查个人 ID、分享样本及凭据；未获授权不改写原始本地归档。用户已授权的本地历史副本清理见 docs/LOCAL-CLEANUP-2026-10-21.md；此授权不涉及删除 Git 历史、标签或远程 Release。
- 本地 GitHub CLI 和许可证保存在 .tools/gh/，凭据助手仅在本仓库配置；.tools/ 不提交。两套初始名单的私有备份保存在 backups/，不得上传。
- 不因测试而真实关注、取关、移组、清理、签到或发邮件；使用隔离模拟数据。真实写入测试仅限用户明确指定的测试账号和范围。
- 上传前检查待提交差异、测试、文件清单与摘要；上传后核对远程提交、标签、附件大小及 SHA256。网络失败保留断点，报告尚未上传部分。
- 自动发布脚本只从本机 GitHub CLI／系统凭据存储取认证；不在源码、参数回显、日志或聊天中保存 Token。
