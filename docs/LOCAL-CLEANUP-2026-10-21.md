# 2026-10-21 本地目录清理

这是用户授权的本地磁盘整理，不是软件版本发布。软件仍为 **Windows 2.4.3**；不修改既有标签、GitHub Release 或附件。历史源码继续通过本仓库的提交和标签访问，历史成品通过 GitHub Release 获取。

## 保留位置

以下路径以本项目所在工作区为基准。

| 内容 | 保留位置 |
| --- | --- |
| Windows 当前源码、完整 Git 历史、依赖 | `douyin-following-desktop/`、`.git/`、`node_modules/` |
| Windows 最新可运行软件 | `douyin-following-desktop/release/抖音整理箱-2.4.3-win-x64/` |
| 最新 Windows、源码、服务器公开压缩包 | `douyin-following-desktop/release/v2.4.3-*.zip` |
| 服务器脚本可运行目录 | `douyin-following-desktop/release/粉丝团打卡-2.4.3-服务器/` |
| 本地成品指针与校验 | `release/latest.json`、`release/v2.4.3-SHA256SUMS.txt`、`release/SHA256-2.4.3.txt` |
| 两套初始数据的私有备份 | `douyin-following-desktop/backups/初始数据-5036人及4278人-私有备份.zip` |
| 清理清单及逐项结果 | `douyin-following-desktop/backups/cleanup-2026-10-20/` |
| GitHub CLI 及许可证 | `douyin-following-desktop/.tools/gh/` |
| Android 0.1.0 验证版源码、APK、源码包 | `douyin-organizer-mobile/`、其 `release/` |
| Android 签名材料、开发环境 | `douyin-organizer-mobile/.signing/`、`node_modules/`、工作区 `.android-tools/` |
| APK 静态分析与接口说明 | `douyin-screening-2026-09-22/apk-analysis/` 及两份顶层接口说明 |

当前使用的数据库、登录会话和操作记录仍位于 `%APPDATA%/DouyinFollowingReview`，未列入删除清单。其他项目、简历和非抖音文件不动。Android 签名密钥及其受系统保护的密码文件均保留，未读取或导出密码。

## 备份与历史文件

私有 ZIP 分别保存最初网页 5,036 人名单及对应筛选文件、Windows 首版 4,278 人名单及随附的 204 条取关结果。原文件按原字节保存，不合并改写；ZIP 内有文件 SHA256 清单。验证了 ZIP 可读取性、每个文件的哈希和名单条数，并核对 Windows 首版嵌入数据与备份一致。

清理旧 Windows 安装目录、旧 ZIP、重复源码目录、旧服务器包、两套 GitHub 发布暂存副本、过渡名单、旧 HTML、测试输出、临时登录副本和可重新构建的产物。开发依赖和必要构建缓存保留；已解压使用的 JDK、SDK、JADX 下载 ZIP 删除。输出目录内仍有价值的 29 份静态代码或接口提取文件移至 `apk-analysis/desktop-extracts/` 后才清理原目录。

本地 `release/latest.json` 已指向从 GitHub 下载并校验过的公开附件；公开源码包经过发布整理，与旧的本地重复源码 ZIP 大小不同。原 `CHECKS-2.4.3.md` 保留为历史构建记录，其当时的文件名或条目数不改写。

## 安全边界与检查

- 固定删除清单限定于工作区中的已确认抖音目录；先检查绝对路径、保留文件和正在运行的程序，再执行。
- 目录链接只解除链接，不遍历其目标；文件清单在执行前重新核对。遇到变更或占用则跳过并记录，不强制结束应用。
- 最新版使用独立合成数据目录通过打包版启动、标签菜单、窗口销毁和再次打开检查；测试无远程请求，原程序继续运行。
- 最新四个公开附件的大小、SHA256 与 GitHub Release 一致；Android APK、源码 ZIP 哈希一致，APK 签名验证通过。
- GitHub CLI 已迁至 `.tools/gh/`，仅更新本仓库凭据助手并验证账号；不改全局邮箱，不保存或显示 Token。
- `backups/`、`.tools/`、登录数据、密钥和二进制不提交 Git。清理后的源码可按 README 重新构建 `dist/`。

## 执行结果

- 固定清单 **224 项全部删除**，无跳过、占用或部分失败项目；共删除 **85,233 个文件**，逻辑大小 **23,308,188,386 字节（23.31 GB／21.71 GiB）**。
- 仅解除 **2 处目录链接**，链接指向的当前开发依赖保留。
- 执行期间 D 盘可用空间从 28,210,671,616 字节变为 51,664,392,192 字节，净增加约 **23.45 GB**。此差额包含文件系统分配和同期其他程序活动，删除规模以逐文件统计为准。
- 清理后复核 **272 份受保护文件**；除本次有意修改的 `.gitignore`、`AGENTS.md` 外，哈希保持不变。另核验 **29 份静态 API 提取文件**、两套私有数据的 ZIP 与条数。
- Windows／服务器可运行目录中的 **6,145 个文件**与保留的发布 ZIP 内容逐个一致；四个公开附件、Android 两个成品哈希一致。Android APK 签名验证通过。
- `git fsck --full` 通过，原先 27 个标签及原有提交保留。当前运行的 2.4.3 未被终止；没有改写 AppData 使用数据、登录会话或用户操作记录。

本次只提交 `.gitignore`、`AGENTS.md` 和本说明；私有备份、逐项删除记录、二进制及工具仍仅保存在本地。源码仍为 2.4.3，不重新打包或改动该版本已发布附件。以后使用 `npm run build`、测试或打包命令时，`dist/`、`output/` 等可生成目录会再次出现。
