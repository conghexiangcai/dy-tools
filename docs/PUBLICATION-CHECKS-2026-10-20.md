# GitHub 历史归档核验

核验日期：2026-10-20（北京时间）。仓库：[conghexiangcai/dy-tools](https://github.com/conghexiangcai/dy-tools)。

## 结果

- 21 个版本 Release、27 份源码修订、27 个标签，远程标签逐项对应版本索引中的提交。
- 57 个源码／Windows／服务器 ZIP，加 21 个 SHA256 清单，共 78 个附件、3,287,611,189 字节。
- 所有附件均从公开下载地址完整流式下载，字节数及 SHA256 与本地发布清单一致；另核对 GitHub API 返回的大小、摘要及上传状态。
- 21 条 Release 的中文说明与仓库版本说明一致；唯一 Latest 为 v2.4.3。
- 本轮在脱敏后的 2.4.3 源码上重新完成 TypeScript 构建和 170 项自动测试。历史版本沿用对应版本留存证据，没有将旧版描述为本轮重新实测。

## 数据保护与历史范围

全部 480 个初始历史 Git 文件对象及源码附件经过脱敏检查。1.0.0～1.1.3 只发布脱敏源码；依赖的个人种子名单及取关历史没有随附，早期源码不承诺直接运行。二进制附件从 1.1.4 开始提供。原始历史 ZIP 和用户本地使用数据保持原样。

历史提交、标签及 Release 在此次归档时建立，不回填或伪造 Git 发布时间；旧 ZIP 留存时间单独记录。本轮范围仅含 Windows 和服务器 CLI，未上传安卓工程，未新增开源授权。

## 后续维护

现有开发目录已连接本仓库；Git 作者和 noreply 邮箱为本项目单独配置，GitHub 凭据由系统存储。后续修改按 [AGENTS.md](../AGENTS.md) 和 [发布流程](PUBLISHING.md) 完成测试、提交和推送，新版本同时更新说明、标签、附件及 SHA256。已发布标签和附件不覆盖。

完整下载核验结果见 [release-verification.json](release-verification.json)，历史提交、修订及各版本文件清单见 [版本索引](versions.md) 和 [release-index.json](release-index.json)。
