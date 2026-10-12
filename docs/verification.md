# 验证说明 / Verification

## 本地验证

2026-10-12，Linux、Node.js 24.21.0 环境下完成以下检查：

| 检查 | 结果 |
| --- | --- |
| 格式检查、前端、后端、测试类型检查及生产构建 | 通过 |
| 后端测试 | 94 项通过 |
| 客户端测试 | 32 项通过 |
| 浏览器测试（Google Chrome） | 24 项通过 |

后端测试包含 HTTP 接口、业务服务、SQLite、维护命令和并发边界；浏览器测试覆盖初始化、三个角色、双语流程、名单导入、审核、结项导出及会话失效。测试使用虚构数据；邮件测试使用替身，不能据此判断真实 SMTP 服务是否可用。

测试代码保存在 `server/tests`、`src/mobile` 和 `tests/e2e`。在仓库根目录运行：

```sh
npm ci
npx playwright install chromium
npm run build
npm run test:api
npm run test:client
npm run test:e2e:built
```

GitHub Actions 按 [ci.yml](../.github/workflows/ci.yml) 在 Ubuntu 上执行检查。每次提交的实际结果请查看 [Actions](https://github.com/tswawa/CampusTask/actions)，本地通过不代表远端已通过。

首次公开提交 `e04917e` 的 [Ubuntu CI](https://github.com/tswawa/CampusTask/actions/runs/37880337338) 已通过依赖安装、类型检查、后端与客户端测试、生产构建和 Chromium 浏览器测试。

当前没有学校实际采用记录，也没有真实邮件投递、学校现行模板接收或大规模部署的验证结论。部署步骤及维护限制见[运维说明](operations.md)。

## English

On 2026-10-12, the application passed the format check, type checks, a production build, 94 backend tests, 32 client tests and 24 browser tests (Google Chrome) on Linux with Node.js 24.21.0.

Backend coverage includes HTTP routes, services, SQLite, maintenance commands and concurrency boundaries. Browser coverage includes setup, all three roles, both languages, roster import, review, completion exports and session expiry. Fixtures are fictional and email delivery is mocked.

The commands above reproduce the checks. GitHub Actions runs them on Ubuntu; check [the workflow results](https://github.com/tswawa/CampusTask/actions) for each commit. Local success does not establish a remote CI result, live SMTP delivery, institutional adoption, acceptance of school-specific templates or large-scale deployment readiness. See [operations](operations.en.md) for deployment and maintenance requirements.

The [Ubuntu CI run for the first public commit, e04917e](https://github.com/tswawa/CampusTask/actions/runs/37880337338), passed dependency installation, type checks, backend and client tests, the production build and Chromium browser tests.
