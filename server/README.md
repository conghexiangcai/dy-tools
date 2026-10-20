# 粉丝团打卡 · 独立服务器脚本

需要 Node.js 24 或更新版本（内置 `node:sqlite`），不需要 Electron、浏览器、Python、npm 安装或聊天助手。先阅读下方实测范围。

## 准备与认证

1. 桌面软件进入“粉丝团打卡”，登录并连接自己的账号，检查认证后点击“导出服务器认证”。`credentials.json` 含登录 Cookie，不是分享链接 token。
2. 将服务器包和认证文件放在自己的私有目录，复制 `config.example.json` 为 `config.json`。不要将认证文件发到聊天、日志或公开仓库；Linux 设置 `chmod 600 credentials.json config.json`。示例认证是占位值。
3. 检查认证并只读核查全部粉丝团：

```sh
node checkin-cli.js --config config.json --check-auth
node checkin-cli.js --config config.json --inspect
```

认证检查必须返回本人 UID。名单来自当前账号全部已加入粉丝团，不按灯牌点亮过滤，也不受圈子数量限制。

## 手动执行与恢复

```sh
node checkin-cli.js --config config.json --once
node checkin-cli.js --config config.json --resume
```

`--once` 新建一轮，刷新名单，核对当天状态，已签到的跳过。`--resume` 继续断点；跨日或上轮完成则新建一轮。只有 `--once`、签到任务的 `--resume/--verified` 和启用的定时运行会提交普通签到。

退出码 0 表示程序正常结束，单次任务暂停返回 2，启动失败返回 1。完成仍可能包含未知／需入圈／不支持项，以逐项结果为准。结果保存在 `data/checkin.sqlite`；Ctrl+C 保存断点并停止，继续先回读不明确的提交。

## 每天多个指定时刻

定时默认关闭。修改 `config.json` 的 `schedule`，例如：

```json
{
  "enabled": true,
  "mode": "times",
  "times": ["08:30", "12:00", "21:15"],
  "start": "09:00",
  "repeats": 3,
  "interval_minutes": 240,
  "timezone": "Asia/Shanghai"
}
```

时间均为北京时间。指定时点可不等间隔，排序去重、最多 24 个。`mode: "times"` 不使用间隔生成时刻。按间隔执行则改成 `mode: "interval"`，设置起始时间、次数、间隔；不允许跨到次日。

```sh
node checkin-cli.js --config config.json --daemon
```

每 15 秒重读配置，时点后 5 分钟内可触发。停机超过窗口不追补，下个时点重新刷新全名单补做。同一数据库内有账号进程锁与时点去重记录。不同设备不能共用本地锁，桌面和服务器建议只启用一端定时。

Linux 常驻参考 `checkin.service.example`，修改路径及普通用户后安装到 systemd。示例未自动安装、启动服务。Windows 桌面使用自己的任务计划设置。

## 到期替换、验证码和暂停

- 认证所属账号不符或被替换即暂停。没有可信的到期时间，不能保证固定有效天数。
- 到期后桌面重新登录并导出，用临时文件上传后原子替换服务器 `credentials.json`，保留数据库。
- 替换后运行 `--check-auth`，成功再用 `--resume`。若发生验证码，在抖音窗口人工完成并重新导出认证，然后运行：

```sh
node checkin-cli.js --config config.json --verified
```

该命令等待五秒后重试，仍受限就暂停。纯服务器脚本没有验证码窗口，不自动识别或绕过验证。

认证失效、验证码、限流或中断都保存断点；守护进程发现未完成任务时保持等待，须人工处理并继续，不在下个时点持续试探。普通网络或空响应最多额外重试两次；签到 POST 不盲目重试。连续三个团读取失败暂停。单请求并发，间隔至少一秒。

## 实测范围（2026-10-11）

- 独立 Node 成功核对登录身份，完整读取 48 个粉丝团与 48 份签到日历；20 个当日已签到，17 个待签到，11 个需入圈，未提交 POST。
- 桌面会话完成一个无圈子粉丝团的普通签到并回读确认；没有批量签到。服务器真实 POST 和已入圈分支写入尚未单独实测，不能保证其他网络环境均可用。
- 原网页版本人接口脱离页面曾为空，现使用 APK 的 `api3-core-c.amemv.com/aweme/v1/user/profile/self/` 核对身份。
- 普通签到实际使用官方日历 `/ent/fandom/join/`、`business_type=4&join_type=3&action=1`。`fandom_id` 按官方包装使用主播业务 ID。原计划 `/ent/fandom/sign/in` 仅为生成的 API 定义，没有用于真实提交。
- 无圈子映射仍核查粉丝团日历；有圈子但未加入则跳过。ID 缺失、业务类型不明、日历缺失或冲突保留未知／不支持。灯牌点亮和当日签到分别判断。程序不调用礼物、付费、补签卡或自动入圈操作。
- 分页、跨日、锁、认证替换、五秒等待与中断用合成测试检查。真实限流、验证码及自然过期未实测，触发后停止等待人工处理。

包内不含真实 Cookie、名单或数据库。


## QQ 邮件失败告警（2.4.2）

无需可视化界面，也无需第三方发信服务。程序直连 QQ SMTP（smtp.qq.com，465，TLS）。需要自己的 QQ／Foxmail 发件地址、SMTP 授权码以及收件地址；在 QQ 邮箱设置中开启 SMTP 并获取授权码，不能填写 QQ 登录密码。

在 config.json 中添加或修改 email 段，其余配置保持原样：

```json
"email": {
  "enabled": true,
  "from": "your-account@qq.com",
  "to": ["recipient@example.com"],
  "credentials_file": "./mail-credentials.json",
  "cooldown_minutes": 60,
  "include_unavailable": false
}
```

把 mail-credentials.example.json 复制为 mail-credentials.json。默认示例从 QQ_SMTP_AUTH_CODE 环境变量读取授权码。无交互服务环境推荐直接在私有文件中填写（请用编辑器填写，不粘贴到日志）：

```json
{
  "version": 1,
  "from": "your-account@qq.com",
  "auth_code": "在本地填写SMTP授权码"
}
```

如果使用 auth_code，删除示例的 auth_code_env；两者同时存在时以环境变量为准。服务运行用户需要能读取文件，Linux 设置权限：

```bash
chmod 600 config.json mail-credentials.json
node checkin-cli.js --config config.json --test-mail
```

--test-mail 只发送一封测试邮件，不连接抖音、不签到，也不需要抖音认证文件有效。该命令是你主动发送的测试；即使自动告警开关关闭仍可测试。输出 sent 表示 QQ 邮箱已接受，需查看收件箱及垃圾箱；不保证实际入箱。

- 自动告警默认关闭。启用后，普通签到失败、认证失效、验证码和限流等产生每轮汇总。inspect 和 check-auth 不触发自动邮件，主动暂停和切换账号不报告。
- unsupported／needs_join 默认不发，可设 include_unavailable 为 true。不会自动加入圈子或额外付费。
- 同账号、同日、同类问题按 cooldown_minutes 去重；范围 10～1440 分钟。后续执行或 daemon 检查发现问题仍在，且间隔已过，才再次提醒。没有单独的邮件后台定时进程。
- SMTP 断线后若无法确认已收件，记录为 unknown，保持不自动重复发送同一告警。明确发信失败记录 failed，可检查配置后主动测试；打卡任务状态与邮件状态分开。
- 收件人最多 5 个。告警包含账号 UID、日期、任务状态及最多 50 个失败粉丝团名称；不包含 Cookie、授权码、接口原文或临时 URL。
- 替换凭据时，在服务器本地编辑 mail-credentials.json 并原子替换。程序每次发信重新读取。若改环境变量，需更新服务环境并重启 daemon；已运行进程不能自动继承你在另一终端修改的环境变量。
- QQ 授权码与抖音 credentials.json 独立，任一失效均可分别替换，无需删除 SQLite。桌面和服务器不共享授权码或发信去重记录。
- CLI 输出配置、认证错误时不会打印凭据。如果 config.json 本身无法解析，程序无法确定收件人，只能写本地错误日志。请确保服务可访问 QQ 的 465 端口，检查主机或云服务商的出站限制。

本次使用模拟 SMTP 检查成功接收、认证失败、明确拒绝、断线及超时，没有连接真实邮箱发送。请配置后手动执行测试命令确认。
