# 插件风向标 · Plugin Pulse

DeepSeek Harness 社区插件榜单与需求反馈。无需 DeepSeek API Key。

Community plugin rankings and feature requests for DeepSeek Harness. No DeepSeek API key required.

| 功能 / Feature | 中文 | English |
| --- | --- | --- |
| 最受欢迎 / Popular | 按近 30 天 npm 下载量或 GitHub Stars 排行。 | Rank by 30-day npm downloads or GitHub stars. |
| 新插件飙升 / Trending | 比较新插件最近两周的增长。 | See which new plugins gained the most week over week. |
| 最期待功能 / Requests | 搜不到合适插件时可提交需求，查看热门提议。 | Request a missing feature and see what others want. |

## Quick start / 快速开始

Use Node.js 24. Run `npm run build && npm run preview`, then open the [local preview](http://127.0.0.1:4173).

Install a release `.tgz` with `dsh plugin --profile desktop add /path/to/file.tgz`, restart Harness and open **Settings → 插件风向标**. Use `--profile web` for Harness Web. A packaged snapshot supports offline browsing. Public voting requires a configured identity gateway.

## 本地预览

需要 Node.js 24，无需安装第三方依赖：

```sh
npm run build
npm run preview
```

打开 [本地预览](http://127.0.0.1:4173)。它使用随项目附带的真实公开快照，并运行一个本地需求统计服务。此处的提交保存在当前仓库的 `.pulse/demand.sqlite`，只供连接到这台服务的访客统计。

## 安装到 Harness

从仓库根目录生成安装包：

```sh
npm pack
```

在启动过一次的 Harness Desktop 中，先完全退出应用，再在同一目录运行：

```sh
dsh plugin --profile desktop add "$PWD/dsh-plugin-pulse-0.1.0.tgz"
```

重新打开应用，在「设置 → 插件风向标」查看。Web 使用 `dsh plugin --profile web add "$PWD/dsh-plugin-pulse-0.1.0.tgz"`，重启 `dsh --profile web` 后进入同一个设置页。已验证 macOS Harness Desktop `0.2.2-rc.1` 和 Harness Web `0.2.0-rc.2` 的安装、界面和卸载。卸载时使用 `dsh plugin --profile desktop remove dsh-plugin-pulse`（Web 将 profile 换成 `web`）。

安装包带公开榜单快照。需求榜使用部署方选择的统计服务；默认包未预设任何外部地址。

## 排名口径

- **最受欢迎**：对有数据的插件按 npm 最近 30 个完整统计日下载量排序，或按 GitHub 仓库 Stars 排序。共享主项目的 Stars 单列。下载量可能包括自动化拉取；Stars 反映仓库关注度。
- **新插件飙升**：只看过去 60 天内在 npm 首次发布 DSH bundle 的插件。下载量以最近 7 日减前 7 日计算，净增至少 10 才上榜；切换到 Stars 时使用相距 7 个 UTC 日期的采集快照，净增至少 1。未发布的日期可计零，缺失的发布后日期不可计零。当前首批目录只覆盖 npm 发布的插件，暂未收录纯 Git 安装源。
- **最期待功能**：按最近 30 天的需求提交数排序。找不到合适的主题时，可通过 GitHub 表单提议新主题（需部署方开启）。

目录根据维护清单抓取 npm 注册表，并核验最新版本声明了有效的 `dsh.bundle`，没有运行这些第三方插件。兼容范围来自发布包声明；缺失时不推定兼容。GitHub 采集按 UTC 保存 Stars 计数；npm 默认延后两天取窗口终点，给数据更新留余量。GitHub 和 npm 数据是独立信号，不用一个综合分混排。功能简介由项目编写。见[榜单数据来源](data/README.md)。

## 刷新数据和接入需求服务

```sh
npm run collect       # 可选环境变量 GITHUB_TOKEN，提高公共 API 额度
npm run check
```

`.github/workflows/collect.yml` 默认关闭。确认 GitHub 仓库允许采集任务更新默认分支后，将仓库的 Actions 变量 `PULSE_ENABLE_COLLECTION` 设为 `true`，再手动运行一次，检查 `data/snapshot.json` 和 `data/stars.json` 是否更新。也可将 `data/snapshot.json` 放到公开静态托管，通过 `PULSE_SNAPSHOT_URL` 在打包时配置。请求失败或数据无效时，插件优先保留上次验证通过的快照，其次使用内置快照。

公开服务使用 `npm run serve`，默认关闭投票。要接收公开投票，需通过 HTTPS 身份网关验证账号，并在后端配置两个不同的随机密钥 `PULSE_GATEWAY_SECRET` 和 `PULSE_VOTER_KEY`（各至少 32 字符）。后端默认监听 `127.0.0.1:4173`。仅允许网关访问后端，由网关删除客户端传入的 `X-Pulse-Gateway-Secret` 和 `X-Pulse-User`，然后在已认证的请求中分别写入共享密钥与稳定的账号 ID。网关需为登录和 API 请求配置限流。

用 `PULSE_DB` 指定持久数据库，公开服务和本地预览使用独立数据库。`PULSE_ALLOWED_ORIGINS` 填写允许提交的浏览器来源（多个值用逗号分隔），包含托管界面自身的 HTTPS 来源。跨站部署时，网关需放行 `OPTIONS /api/votes` 预检，浏览器也需允许发送网关的会话 Cookie。保留 `PULSE_VOTER_KEY`，以免轮换后把同一账号当作新提交者。

配置后重新打包，例如：

```sh
PULSE_DEMAND_URL=https://pulse.example.org/api \
PULSE_DEMAND_AUTHENTICATED=1 \
PULSE_SNAPSHOT_URL=https://pulse.example.org/snapshot.json \
PULSE_ISSUE_URL=https://github.com/OWNER/REPO/issues/new?template=feature-demand.yml \
npm pack
```

本机联调可使用 `PULSE_DEMAND_URL=http://127.0.0.1:4173/api`，预览服务允许来源填实际 Harness Web 地址，如 `PULSE_ALLOWED_ORIGINS=http://127.0.0.1:3080`。桌面壳的外部接口请求仍需联调确认。

普通搜索在浏览器内完成。本地预览按浏览器凭证去重，公开服务按网关验证的账号去重。服务只保存主题、散列后的标识和时间戳，定期清理超过 35 天的记录。统计窗口为 30 天，主题至少有 5 条有效提交才上榜。

数据接口：[DSH 插件开发文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md) · [npm 下载量](https://github.com/npm/registry/blob/main/docs/download-counts.md) · [GitHub Stars](https://docs.github.com/en/rest/activity/starring)。本项目以 MIT 许可证开源，与 DeepSeek 官方无隶属关系。
