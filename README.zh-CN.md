# 高校任务协作平台 · CampusCollab

**教师发布任务，学生报名参与，完成后提交材料并审核。**

[English](README.md) · [本地运行](#本地运行) · [文档](docs/README.md)

[![CI](https://github.com/tswawa/CampusCollab/actions/workflows/ci.yml/badge.svg)](https://github.com/tswawa/CampusCollab/actions/workflows/ci.yml)

CampusCollab 用于组织校园任务与活动。教师发布任务，设置参与条件和材料要求；学生查看任务、报名参与、提交完成情况；教师审核材料、确认实际时长，最后导出结果名单和对应材料。

每所学校独立部署，初始化时选择中文或英文版本。

| 角色 | 登录后的页面 | 可以做什么 |
| --- | --- | --- |
| 教师 / 负责人 | 教师工作台 | 发布任务、管理参与人员、审核材料、导出结果 |
| 学生 / 参与者 | 学生首页、任务大厅 | 查找任务、报名参与、跟进进度、提交材料 |
| 管理员 | 管理终端 | 审批账号、管理组织与设置、交接任务负责人 |

## 1. 登录，进入自己的工作台

输入账号和密码后，系统按账号角色进入对应页面。

<img src="docs/screenshots/showcase-zh-login.png" width="420" alt="校园账号登录页面" />

教师首页提供**发布任务**入口，显示任务数量和待验收事项。学生首页显示自己的参与进度，并提供任务浏览入口。

<table>
<tr><th>教师工作台</th><th>学生首页</th></tr>
<tr>
<td><img src="docs/screenshots/showcase-zh-teacher.png" width="420" alt="教师登录后的工作台：发布入口、任务统计和待办" /></td>
<td><img src="docs/screenshots/showcase-zh-student-home.png" width="420" alt="学生登录后的首页：个人进度和任务入口" /></td>
</tr>
</table>

## 2. 教师发布任务

填写任务名称、具体工作、地点和工作清单，选择个人任务或集体活动，再设置日期、名额、参与方式和材料要求。

发布表单分四步：基本信息、时间地点与凭证、联系方式、发布预览。

![教师填写任务内容与要求](docs/screenshots/showcase-zh-create.png)

<details>
<summary>查看参与条件与发布预览</summary>

![设置任务日期、名额、接取方式和材料要求](docs/screenshots/showcase-zh-create-rules.png)

![发布前核对完整任务信息](docs/screenshots/showcase-zh-create-preview.png)

</details>

## 3. 学生在任务大厅选择并参与

学生可以浏览、搜索和筛选任务。打开详情后，查看时间地点、工作要求和剩余名额，再决定是否参与。

![学生任务大厅：浏览和筛选可参与的任务](docs/screenshots/showcase-zh-hall.png)

<img src="docs/screenshots/showcase-zh-detail.png" width="520" alt="已发布任务的详情与参与按钮" />

任务支持直接接取，也可以先申请、由教师审核。加入后，学生可以在自己的任务列表中继续跟进。

## 4. 完成工作后提交材料

学生填写完成情况、自报时长，并按任务要求上传图片。下面展示的是前面发布的同一条任务的提交页面。

<img src="docs/screenshots/showcase-zh-submit.png" width="420" alt="学生为前面发布的任务填写完成情况并提交材料" />

## 5. 教师按人审核，跟进补正

名单工作台显示每个人的提交状态，可以筛选未提交、待审核、待补正和已确认人员，也可以按姓名或编号查找。已有 CSV 名单可预览后导入。

![教师名单工作台：查看提交、补正和确认结果](docs/screenshots/showcase-zh-roster.png)

审核时可以写明“补充实际离场时间”等具体要求。学生再次提交后，新旧版本和审核意见都会保留。教师确认材料版本与实际参与时长，也可以批量处理准备齐全的提交。

<details>
<summary>查看材料版本与补正意见</summary>

![新旧材料对照、补正意见和确认时长](docs/screenshots/showcase-zh-review.png)

</details>

<details>
<summary>查看集体活动的公共材料与逐人确认</summary>

集体活动由负责人提交公共材料，再分别确认每个人的结果和时长。活动也可以同时要求个人补充。

![公共材料版本与个人参与确认](docs/screenshots/showcase-zh-group.png)

</details>

## 6. 结项并导出结果

下载 CSV、Excel，或包含名单与已确认材料的 ZIP 包。完成、退出、未完成的人员都保留在名单中。后续更正会生成新的结项版本，原记录继续保留。

![结项结果：人员名单、确认时长和 ZIP、Excel、CSV 导出](docs/screenshots/showcase-zh-export.png)

## 管理终端

管理员负责账号审批、组织与机构设置、负责人交接、通知和数据保存。

<details>
<summary>查看管理概览</summary>

![管理概览：待审批账号、待审核材料与近期任务](docs/screenshots/showcase-zh-admin.png)

</details>

截图使用虚构活动数据，以中国海洋大学作为机构名称示例。

## 本地运行

需要 Node.js `>=24.13.1 <25` 和 npm。

```sh
git clone https://github.com/tswawa/CampusCollab.git
cd CampusCollab
npm ci
```

将 `.env.example` 复制为 `.env`，然后启动：

```sh
npm run dev
```

打开 [localhost:5173](http://localhost:5173)。API 默认端口为 `3000`，数据库在启动时自动迁移。

首次访问时选择语言、填写机构信息与时区，并创建管理员。安装码使用 `.env` 中的 `SETUP_TOKEN`；留空时，由部署负责人读取首次启动生成的 `data/campus.sqlite.setup-token` 文件。

## 部署

在 `.env` 中设置 `NODE_ENV=production`、实际的 HTTPS `APP_ORIGIN`，以及数据库、图片和备份的持久路径，然后运行：

```sh
npm run build
npm start
```

服务默认监听 `127.0.0.1:3000`，通过反向代理提供 HTTPS。配置、备份、升级和恢复步骤见[运维说明](docs/operations.md)。

## 开发

前端使用 Vue 3、Pinia 和 Vant，后端使用 Fastify 与 Node 内置 SQLite。

```sh
npm run type-check
npm run test:api
npm run test:client
npx playwright install chromium
npm run test:e2e
```

- [架构与项目边界](docs/ARCHITECTURE.md)
- [贡献说明](CONTRIBUTING.md)
- [产品计划与调研](PLAN.md)
- [验证说明](docs/verification.md)
- [安全问题报告](SECURITY.md)

## 许可证

采用 [AGPL-3.0-only](LICENSE)。项目基于 ZVMS4 前端开发，保留[上游 MIT 版权和许可声明](LICENSES/ZVMS-MIT.txt)，详见 [NOTICE](NOTICE)。生产构建附带对应源码包 `/source.zip`。
