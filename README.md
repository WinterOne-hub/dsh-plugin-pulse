# 插件风向标 · Plugin Pulse

[中文](#本地预览) · [English](#english) · [下载安装包 / Download](https://github.com/WinterOne-hub/dsh-plugin-pulse/releases)

DeepSeek Harness 社区插件榜单与需求反馈。无需 DeepSeek API Key。

Plugin directory, leaderboards, and feature requests for DeepSeek Harness (DSH). No DeepSeek API key required.

| 功能 / Feature | 中文 | English |
| --- | --- | --- |
| 最受欢迎 / Popular | 按近 30 天 npm 下载量或 GitHub Stars 排行。 | Rank by 30-day npm downloads or GitHub stars. |
| 新插件飙升 / Trending | 比较新插件最近两周的增长。 | See which new plugins gained the most week over week. |
| 最期待功能 / Requests | 搜不到合适插件时可提交需求，查看热门提议。 | Request a missing feature and see what others want. |

## 本地预览

需要 Node.js 24，无需安装第三方依赖：

```sh
npm run build
npm run preview
```

打开 [本地预览](http://127.0.0.1:4173)。它使用随项目附带的真实公开快照，并运行一个本地需求统计服务。此处的提交保存在当前仓库的 `.pulse/demand.sqlite`，只供连接到这台服务的访客统计。

## 安装到 Harness

从 [GitHub Releases](https://github.com/WinterOne-hub/dsh-plugin-pulse/releases) 下载 `.tgz`，或在仓库根目录运行：

```sh
npm pack
```

在启动过一次的 Harness Desktop 中，先完全退出应用，再在同一目录运行：

```sh
dsh plugin --profile desktop add "$PWD/dsh-plugin-pulse-0.1.4.tgz"
```

重启后，在左侧栏打开「插件风向标」。「复制 GitHub 地址」会复制仓库链接。「去安装」会复制可粘贴的安装地址并打开 Harness 的「插件」页。仓库根目录的插件包与榜单版本匹配时使用 GitHub 地址，其他条目使用 `包名@版本`。点「添加插件」，粘贴后按提示确认。Web 版安装时把 `desktop` 换成 `web`。使用旧版 `0.1.0` 时，入口位于「设置 → 插件风向标」，安装命令中的文件名也应与下载版本一致。

卸载使用 `dsh plugin --profile desktop remove dsh-plugin-pulse`（Web 将 profile 换成 `web`）。

榜单顶部显示当前版本。Harness 启动时会检查更新。发现新版后，点主界面提醒或榜单顶部的「立即更新」，即可在 Harness 内下载并安装。安装后按提示重启。已安装旧安装包的 `v0.1.4` 用户需要用本次更新后的附件重装一次，才能使用一键更新。

从 v0.1.3 起，榜单会读取每日发布的公开快照，并显示数据日期。无法刷新时使用上次可用的快照或随包数据。需求榜使用部署方选择的统计服务。

## 排名口径

- **最受欢迎**：对有数据的插件按 npm 最近 30 个完整统计日下载量排序，或按 GitHub 仓库 Stars 排序。共享主项目的 Stars 单列。下载量可能包括自动化拉取；Stars 反映仓库关注度。
- **新插件飙升**：覆盖过去 60 天首发的 npm 插件，比较两个完整的 7 天窗口。发布未满 14 天的插件单列为「刚发布」。趋势分使用 `ln(1 + 增量) × ln(1 + 增量 ÷ (前周基数 + 平滑值))`。下载量用 100 平滑，最近一周至少 50 次且净增至少 10。Stars 比较两周各自的净增，用 5 平滑，最近一周至少净增 3 颗且比前周多增至少 1 颗。
- **最期待功能**：按最近 30 天的需求提交数排序。找不到合适的主题时，可通过 GitHub 表单提议新主题（需部署方开启）。

目录根据维护清单抓取 npm 注册表，并核验最新版本声明了有效的 `dsh.bundle`，没有运行这些第三方插件。兼容范围来自发布包声明；缺失时不推定兼容。GitHub 采集按 UTC 保存 Stars 计数；npm 默认延后两天取窗口终点，给数据更新留余量。GitHub 和 npm 数据是独立信号，不用一个综合分混排。功能简介由项目编写。见[榜单数据来源](data/README.md)。

## 刷新数据和接入需求服务

```sh
npm run collect       # 可选环境变量 GITHUB_TOKEN，提高公共 API 额度
npm run check
```

在 GitHub Actions 手动运行 `Refresh public data` 验证采集。定时任务由 `PULSE_ENABLE_COLLECTION=true` 启用。新版默认从 GitHub 读取公开快照，也可在打包时用 `PULSE_SNAPSHOT_URL` 指定其他地址。任务还会在运行摘要中列出 npm 候选插件。维护者核对安装来源，并在 `data/seeds.json` 补齐中英简介后收录。

公开服务使用 `npm run serve`，默认关闭投票。要接收公开投票，需通过 HTTPS 身份网关验证账号，并在后端配置两个不同的随机密钥 `PULSE_GATEWAY_SECRET` 和 `PULSE_VOTER_KEY`（各至少 32 字符）。后端默认监听 `127.0.0.1:4173`。仅允许网关访问后端，由网关删除客户端传入的 `X-Pulse-Gateway-Secret` 和 `X-Pulse-User`，然后在已认证的请求中分别写入共享密钥与稳定的账号 ID。网关需为登录和 API 请求配置限流。

用 `PULSE_DB` 指定持久数据库，公开服务和本地预览使用独立数据库。`PULSE_ALLOWED_ORIGINS` 填写允许提交的浏览器来源（多个值用逗号分隔），包含托管界面自身的 HTTPS 来源。跨站部署时，网关需放行 `OPTIONS /api/votes` 预检，浏览器也需允许发送网关的会话 Cookie。保留 `PULSE_VOTER_KEY`，以免轮换后把同一账号当作新提交者。

配置后重新打包，例如：

```sh
PULSE_DEMAND_URL=https://pulse.example.org/api \
PULSE_DEMAND_AUTHENTICATED=1 \
PULSE_SNAPSHOT_URL=https://pulse.example.org/snapshot.json \
PULSE_ISSUE_URL='https://github.com/OWNER/REPO/issues/new?template=feature-demand.yml' \
npm pack
```

本机联调可使用 `PULSE_DEMAND_URL=http://127.0.0.1:4173/api`，预览服务允许来源填实际 Harness Web 地址，如 `PULSE_ALLOWED_ORIGINS=http://127.0.0.1:3080`。桌面壳的外部接口请求仍需联调确认。

普通搜索在浏览器内完成。本地预览按浏览器凭证去重，公开服务按网关验证的账号去重。服务只保存主题、散列后的标识和时间戳，定期清理超过 35 天的记录。统计窗口为 30 天，主题至少有 5 条有效提交才上榜。

数据接口：[DSH 插件开发文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md) · [npm 下载量](https://github.com/npm/registry/blob/main/docs/download-counts.md) · [GitHub Stars](https://docs.github.com/en/rest/activity/starring)。本项目以 MIT 许可证开源，与 DeepSeek 官方无隶属关系。

## English

### Local preview

Use Node.js 24. Run `npm run build && npm run preview`, then open the [local preview](http://127.0.0.1:4173). It uses a bundled snapshot and stores local votes in `.pulse/demand.sqlite`.

### Install in Harness

Download the `.tgz` from [GitHub Releases](https://github.com/WinterOne-hub/dsh-plugin-pulse/releases), or run `npm pack` in the repository. Quit Harness Desktop, open a terminal in the directory containing the package, and run the following command.

```sh
dsh plugin --profile desktop add "$PWD/dsh-plugin-pulse-0.1.4.tgz"
```

Restart Harness and open **插件风向标** in the left sidebar. **复制 GitHub 地址** copies the repository URL. **去安装** copies a target and opens Harness’s **Plugins** page. It uses the GitHub URL when the root package matches the listed version and `package@version` for other entries. Choose **Add plugin**, paste, and follow the prompts. Use `--profile web` for Harness Web. For `0.1.0`, look under **Settings → 插件风向标** and use the downloaded filename in the install command.

To uninstall, run `dsh plugin --profile desktop remove dsh-plugin-pulse` with the appropriate profile. The bundled snapshot works offline. Public voting requires a configured service.

The header shows your installed version. Plugin Pulse checks for updates when Harness opens. Choose **立即更新** (Update now) in the notice or panel to install the new release inside Harness, then restart when prompted. If you installed the earlier `v0.1.4` archive, reinstall once from the refreshed attachment to enable this action.

### Ranking rules

- **Popular.** Rank by npm downloads over 30 complete days or GitHub stars. Shared repository stars appear separately. Download counts can include automated activity.
- **Trending.** Include DSH bundles first published on npm within 60 days. Compare two complete weeks using `ln(1 + gain) × ln(1 + gain / (previous week + smoothing))`, with negative baselines treated as zero. Downloads use a smoothing value of 100, a minimum of 50 downloads in the latest week, and a gain of at least 10. Weekly star gains use a smoothing value of 5, a minimum of 3 net new stars this week, and an increase of at least 1 over the previous week. Plugins released less than 14 days ago appear under New Releases.
- **Requests.** Rank by submissions over the past 30 days. Where enabled, users can propose new topics through a GitHub issue form.

The collector checks the latest package for a `dsh.bundle` declaration and reads compatibility from package metadata. It records GitHub stars by UTC date and allows two days for npm download figures to settle. Plugin summaries are written for this project. [Data sources](data/README.md)

### Refresh data and enable voting

- **Data.** Run `npm run collect` to refresh snapshots. An optional `GITHUB_TOKEN` raises the GitHub API limit. Run `npm run check` to verify the build. To enable scheduled collection, confirm that Actions can update the default branch, set `PULSE_ENABLE_COLLECTION=true` as a repository variable, and run the workflow manually once. Check both `data/snapshot.json` and `data/stars.json`.
- **Snapshots.** The plugin reads the public GitHub snapshot by default. Set `PULSE_SNAPSHOT_URL` at build time to use another endpoint. A failed refresh falls back to the last valid snapshot or the bundled copy. The workflow summary lists npm candidates for review before they are added to `data/seeds.json`.
- **Public voting.** Run `npm run serve` behind an HTTPS identity gateway. The server binds to `127.0.0.1:4173` by default and voting starts disabled. Configure distinct random values of at least 32 characters for `PULSE_GATEWAY_SECRET` and `PULSE_VOTER_KEY`. Allow only the gateway to reach the backend. The gateway must strip incoming `X-Pulse-Gateway-Secret` and `X-Pulse-User` headers, then set them to the shared secret and a stable authenticated account ID. Rate-limit login and API requests.
- **Storage and browser access.** Set `PULSE_DB` to a persistent file separate from the local preview database. Add allowed browser origins, including the hosted UI, to `PULSE_ALLOWED_ORIGINS`. For cross-site access, forward `OPTIONS /api/votes` and allow the browser to send the gateway session cookie. Keep `PULSE_VOTER_KEY` stable for account deduplication.
- **Build options.** Set `PULSE_DEMAND_URL` to the service’s `/api` URL and `PULSE_DEMAND_AUTHENTICATED=1` for public voting, then run `npm pack`. Set `PULSE_ISSUE_URL` to link a public topic form. For local Web testing, use `http://127.0.0.1:4173/api` with the Harness Web origin in `PULSE_ALLOWED_ORIGINS`. External requests from the desktop app still need testing against the deployed gateway.

Search runs locally. The preview deduplicates votes by browser ID and public voting uses authenticated accounts. The service keeps the topic, a hashed identifier, and a timestamp, and regularly deletes records older than 35 days. A topic needs five valid submissions within 30 days to appear.

MIT-licensed community project for DeepSeek Harness. [Harness plugin guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md) · [npm download counts](https://github.com/npm/registry/blob/main/docs/download-counts.md) · [GitHub stars](https://docs.github.com/en/rest/activity/starring)
