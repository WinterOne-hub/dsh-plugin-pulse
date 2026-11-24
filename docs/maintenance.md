# 数据与部署 / Data and deployment

## 排名口径

- **最受欢迎**：对有数据的插件按 npm 最近 30 个完整统计日下载量排序，或按 GitHub 仓库 Stars 排序。共享主项目的 Stars 单列。下载量可能包括自动化拉取；Stars 反映仓库关注度。
- **插件趋势**：覆盖所有已发布满 14 天的插件，发布未满 14 天的条目单列为「刚发布」。下载量比较两个完整的 7 天窗口，最近一周至少 20 次下载且比前周增加至少 1 次，趋势分为 `ln(1 + 增量) × ln(1 + 增量 ÷ (前周下载量 + 100))`。Stars 使用最近 7 天净增，至少新增 1 颗，趋势分为 `ln(1 + 新增 Stars) × ln(1 + 新增 Stars ÷ (周初 Stars + 20))`。两种指标各自排名。
- **最期待功能**：按最近 30 天的需求提交数排序。找不到合适的主题时，可通过 GitHub 表单提议新主题（需部署方开启）。

目录根据维护清单抓取 npm 注册表，并核验最新版本声明了有效的 `dsh.bundle`，没有运行这些第三方插件。兼容范围来自发布包声明；缺失时不推定兼容。GitHub 采集按 UTC 保存 Stars 计数；npm 默认延后两天取窗口终点，给数据更新留余量。GitHub 和 npm 数据是独立信号，不用一个综合分混排。功能简介由项目编写。见[榜单数据来源](../data/README.md)。

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

### Ranking rules

- **Popular.** Rank by npm downloads over 30 complete days or GitHub stars. Shared repository stars appear separately. Download counts can include automated activity.
- **Trending.** Include plugins published at least 14 days ago, with newer plugins listed under New Releases. Downloads compare two complete weeks, requiring at least 20 downloads this week and a gain of at least 1. The score is `ln(1 + gain) × ln(1 + gain / (previous week downloads + 100))`. GitHub requires at least 1 net new star over the last 7 days and uses `ln(1 + new stars) × ln(1 + new stars / (stars at the start of the week + 20))`. Each metric has its own ranking.
- **Requests.** Rank by submissions over the past 30 days. Where enabled, users can propose new topics through a GitHub issue form.

The collector checks the latest package for a `dsh.bundle` declaration and reads compatibility from package metadata. It records GitHub stars by UTC date and allows two days for npm download figures to settle. Plugin summaries are written for this project. [Data sources](../data/README.md)

### Refresh data and enable voting

- **Data.** Run `npm run collect` to refresh snapshots. An optional `GITHUB_TOKEN` raises the GitHub API limit. Run `npm run check` to verify the build. To enable scheduled collection, confirm that Actions can update the default branch, set `PULSE_ENABLE_COLLECTION=true` as a repository variable, and run the workflow manually once. Check both `data/snapshot.json` and `data/stars.json`.
- **Snapshots.** The plugin reads the public GitHub snapshot by default. Set `PULSE_SNAPSHOT_URL` at build time to use another endpoint. A failed refresh falls back to the last valid snapshot or the bundled copy. The workflow summary lists npm candidates for review before they are added to `data/seeds.json`.
- **Public voting.** Run `npm run serve` behind an HTTPS identity gateway. The server binds to `127.0.0.1:4173` by default and voting starts disabled. Configure distinct random values of at least 32 characters for `PULSE_GATEWAY_SECRET` and `PULSE_VOTER_KEY`. Allow only the gateway to reach the backend. The gateway must strip incoming `X-Pulse-Gateway-Secret` and `X-Pulse-User` headers, then set them to the shared secret and a stable authenticated account ID. Rate-limit login and API requests.
- **Storage and browser access.** Set `PULSE_DB` to a persistent file separate from the local preview database. Add allowed browser origins, including the hosted UI, to `PULSE_ALLOWED_ORIGINS`. For cross-site access, forward `OPTIONS /api/votes` and allow the browser to send the gateway session cookie. Keep `PULSE_VOTER_KEY` stable for account deduplication.
- **Build options.** Set `PULSE_DEMAND_URL` to the service’s `/api` URL and `PULSE_DEMAND_AUTHENTICATED=1` for public voting, then run `npm pack`. Set `PULSE_ISSUE_URL` to link a public topic form. For local Web testing, use `http://127.0.0.1:4173/api` with the Harness Web origin in `PULSE_ALLOWED_ORIGINS`. External requests from the desktop app still need testing against the deployed gateway.

Search runs locally. The preview deduplicates votes by browser ID and public voting uses authenticated accounts. The service keeps the topic, a hashed identifier, and a timestamp, and regularly deletes records older than 35 days. A topic needs five valid submissions within 30 days to appear.

MIT-licensed community project for DeepSeek Harness. [Harness plugin guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md) · [npm download counts](https://github.com/npm/registry/blob/main/docs/download-counts.md) · [GitHub stars](https://docs.github.com/en/rest/activity/starring)

### Version checks / 更新检查

After a GitHub release and its package are publicly available, set the published version in `data/release.json`. Plugin Pulse uses this file when the Releases API is unavailable.

GitHub Release 和安装包公开后，将发布版本写入 `data/release.json`。Releases API 无法连接时，插件读取这个文件。
