# 更新记录

以下根据各版源码差异、README 和当时验证说明补录。所有限制以对应版本说明为准。

## [2.4.3](https://github.com/conghexiangcai/dy-tools/releases/tag/v2.4.3) · 浏览器式标签与窗口释放

右键关闭当前／其他／全部／左／右，重新加载、复制标签和链接；最后标签关闭时销毁窗口，再次打开重建。


## [2.4.2](https://github.com/conghexiangcai/dy-tools/releases/tag/v2.4.2) · 邮件告警、标签性能与群成员资料

桌面和服务器 QQ 邮件失败告警；主页按需加载、关闭音频释放；跨群资料合并及按需补全；修复启动切页 ERR_ABORTED。


## [2.4.1](https://github.com/conghexiangcai/dy-tools/releases/tag/v2.4.1) · 关注采集自动等待重试

空响应和临时网络失败保存断点，显示退避倒计时并自动重试；验证码、身份失效仍人工处理。


## [2.4.0](https://github.com/conghexiangcai/dy-tools/releases/tag/v2.4.0) · 单篇作品下载

多分享链接解析、视频及静态图集、资源核验、串行流式下载、临时文件、暂停续传和账号隔离记录。


## [2.3.1](https://github.com/conghexiangcai/dy-tools/releases/tag/v2.3.1) · 群扫描、登录同步及分组刷新修复

群成员读取保留完整 IM 对象；统一在线登录状态；分组目录与个人归属分离，独立刷新并保留失败前数据。

- 统一拦截 bytedance、intent 等外部客户端协议，覆盖网页、子框架、重定向和系统应用打开权限。

## [2.3.0](https://github.com/conghexiangcai/dy-tools/releases/tag/v2.3.0) · 分组管家与关注／群成员动态

新增分组管家、关注动态、群成员变动；完整快照比较、增删与昵称变化、成员复制／移动预览、导出和历史。

- 变化导出补充前后快照时间、来源及完整性；修复 Windows 打包所需压缩程序集加载。

## [2.2.0](https://github.com/conghexiangcai/dy-tools/releases/tag/v2.2.0) · 粉丝团打卡与服务器 CLI

全部已加入粉丝团作为名单来源，普通签到与状态回读；指定时间点或间隔排程、Windows 任务定义及独立服务器脚本。

- 只接受同一已核实抖音会话，移除独立 fandom Cookie；实际提交前再次检查跨日，防止旧日历提交。
- 历史签到记录标注记录日期，避免将往日结果显示为今日已签到。服务器包另含后续使用说明修订。

## [2.1.0](https://github.com/conghexiangcai/dy-tools/releases/tag/v2.1.0) · 分享链接与群成员检索

支持作品作者／主页分享识别；已加入群目录、成员扫描、跨群查重、查人、导入对比和 JSON／Excel。


## [2.0.0](https://github.com/conghexiangcai/dy-tools/releases/tag/v2.0.0) · 抖音整理箱导航与批量工具

关注管理和粉丝团查询拆分为独立入口；加入筛选／分组取关预览、忽视名单、关注迁移、互动清理和群名单查重。


## [1.4.1](https://github.com/conghexiangcai/dy-tools/releases/tag/v1.4.1) · 私密标识跟随主页

将私密提示移到主页关注按钮旁的隔离浮层，滚动与身份变化时重定位或隐藏。


## [1.4.0](https://github.com/conghexiangcai/dy-tools/releases/tag/v1.4.0) · 抖音号检索与查询请求优化

加入抖音号搜索候选、身份确认、复用登录与请求上下文；补充私密标识和空响应耗时处理。


## [1.3.0](https://github.com/conghexiangcai/dy-tools/releases/tag/v1.3.0) · 指定主播粉丝团查询

增加主播名单与目标用户识别，查询灯牌等级／状态、荣誉等级和按等级估算的钻石区间，支持导出和续传。

- 目标输入与已解析身份绑定，输入变更后隐藏旧预览、禁止查询旧目标，并补充 UI 检查。

## [1.2.1](https://github.com/conghexiangcai/dy-tools/releases/tag/v1.2.1) · 分组筛选与列整理

增加分组下拉并叠加现有筛选；删除关注状态列、交换分组与命中条件；私密字段兼容旧名单。


## [1.2.0](https://github.com/conghexiangcai/dy-tools/releases/tag/v1.2.0) · 抖音真实关注分组

主页锚定设置分组按钮、多选归属、列表所属分组及刷新；差量写入和回读，账号绑定及大 ID 保护。


## [1.1.5](https://github.com/conghexiangcai/dy-tools/releases/tag/v1.1.5) · 私密账号标识

在昵称旁显示已明确采集的私密状态，窄列换行，无需重新采集。


## [1.1.4](https://github.com/conghexiangcai/dy-tools/releases/tag/v1.1.4) · 全新安装从空名单开始

取消自动导入历史名单，连接检查使用当前账号样本，分发包移除个人快照。


## [1.1.3](https://github.com/conghexiangcai/dy-tools/releases/tag/v1.1.3) · 空响应重试与记录合并

空响应核查验证码后有限重试；导入期间保留同时发生的筛选、勾选和打开操作；数据更新时间准确展示。


## [1.1.2](https://github.com/conghexiangcai/dy-tools/releases/tag/v1.1.2) · 兼容空作品列表

兼容成功响应中的 null 作品列表和省略分页字段；未知时间保持未知，验证码仍暂停。


## [1.1.1](https://github.com/conghexiangcai/dy-tools/releases/tag/v1.1.1) · 单账号视频分页异常保护

视频游标未推进或超过限额时将该账号标记为冲突／未知，继续其他账号，不中止整批。


## [1.1.0](https://github.com/conghexiangcai/dy-tools/releases/tag/v1.1.0) · 最新作品时间与剩余时长

增加最新三条发布时间、距今天数筛选和排序、采集剩余时长；分别保存详情与视频阶段。

- 补充已完成详情任务的视频阶段恢复；避免无任务时启动续传；跨北京时间自然日重新计算筛选。

## [1.0.0](https://github.com/conghexiangcai/dy-tools/releases/tag/v1.0.0) · 首版 Windows 关注清单

Electron 桌面登录、关注分页与详情采集、SQLite 断点、筛选排序、多选分批打开及 HTML／JSON／Markdown 导出。


