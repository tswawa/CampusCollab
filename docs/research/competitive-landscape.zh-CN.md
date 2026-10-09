# 校园任务协作：竞品与开源供给研究

> **历史范围：本文保留 2026-10-08 实施前的研究结论与项目状态。当前功能以 [README](../../README.zh-CN.md) 为准，当前许可证以 [LICENSE](../../LICENSE) 为准；下文的“尚未实现”等描述不代表当前版本。**

[English](competitive-landscape.en.md) · [产品计划](../../PLAN.md) · [市场研究](market-research.zh-CN.md) · [国际采用研究](international-adoption.zh-CN.md)

**研究截止：2026-10-08（Asia/Taipei）。**

**决策：继续建设一个以交付模板为起点的校园活动结项产品。已认可的方向是“模板先行 → 接入原有名单 → 逐人收集和定向补正 → 输出与被确认版本对应的名单、附件和核对清单”。这是待实现的专用体验，不是已验证的效率优势，也不是竞品绝对做不到的独占能力。**

本项目目前只有本地开发和测试，没有真实教师、学院或实验室采用。现有基础是教师发布多人任务、学生接单或申请、提交文字图片凭证、教师验收或退回，以及组织和账号管理。模板驱动结项、既有名单导入、版本对应结果包、完整组织交接等目标，不应写成已经完成。

## 1. 研究范围与证据规则

本轮覆盖中英文公开检索、GitHub/Gitee 与微信小程序相关线索，进一步查阅可访问的核心源码、官方文档、版本发布、具体用户问题，以及学校自己的活动通知和制度。最终选取八个对决策最有价值的代表，不以名称相似、README、star 或作者自建 issue 证明产品能力和市场规模。

证据标签：

- **源码**：在注明的文件和提交中看到了实现；不等于运行验证、稳定部署或实际使用。
- **文档**：官方说明、定价或部署文档宣称的能力；不等于本轮实际操作成功。
- **学校使用**：学校文件描述了真实组织流程或报告了活动数据；不等于第三方审计，也不代表全行业。
- **未知**：所读材料没有充分证据；不等于没有该功能。
- **推断**：基于以上证据形成的判断，不当作可直接核实的事实。

GitHub 匿名接口遇到限流后没有继续反复尝试，也没有登录。部分页面通过搜索索引取得正文。没有运行竞品、测量部署成本或取得商业报价；公开版本和价格会变化。本轮没有穷尽所有语言、Gitee 项目、学校内建平台或未公开定制产品，不能据此证明不存在同类。

## 2. 应当区分的三层竞争

1. **较近的开源校园任务代码**：已经有发布、接单、进度和确认流程，但所核查的两个项目以校园个人订单和单一接单者为中心。不能把一个 `confirm` 方法直接等同于教师多人逐人验收。
2. **可配置的自托管替代**：NocoBase、Budibase 可以组成收集、审核、通知和导出流程。竞争点包含配置、运维和维护成本；“自托管”“免费用户不限量”并非本项目独有。
3. **学校实际使用的产品**：报名工具、到梦空间、易班/易瞄瞄、志愿汇已经占据入口、身份、通知习惯或正式认定流程。它们即使不开源，也会直接决定老师是否愿意多用一个系统。

**公开证据不支持“功能没人做”。更有依据的机会假设是：低门槛、开箱即用、可自托管、围绕特定学校交付物完成最后整理工作的开源成品较少被本轮样本覆盖。**“较少被覆盖”不能进一步写成“市场空白”。

## 3. 八个代表：产品、许可和部署矩阵

| 代表 | 面向谁、定位 | 已核实的许可与开放边界 | 部署与费用证据 |
| --- | --- | --- | --- |
| campus-errand | 校园发单者与接单者；个人订单 | 固定提交的 LICENSE 为 GNU GPL v2 文本，README 写 MIT，存在冲突；不能仅按 README 归类。[许可][CE-LICENSE] | 可取得代码自行部署；实际最低资源和长期运维成本未知。v1.0 发布说明披露该环境未安装 Redis/RabbitMQ，通知不可用。[发布][CE-RELEASE] |
| CampusGo | 校园订单发布者与单一接单者 | 固定提交为 MIT，有明确版权和许可文本。[许可][CG-LICENSE] | 可取得代码自行部署；本轮没有实际部署，资源下限、可靠通知和维护成本未知。 |
| NocoBase | 有能力搭建内部应用的组织或实施者 | 当前 LICENSE 引用 Apache-2.0，但规定补充条款优先；包含界面品牌信息及公开提供低代码/AI SaaS/PaaS 的限制。不能简单标为纯 Apache-2.0 或沿用旧 AGPL 判断。[许可][NC-LICENSE] | Community 免费，部分能力为商业插件。最低 1 核/2 GB 面向概念验证，建议 2 核/4 GB；还需配置、数据建模与运行维护。[资源][NC-REQ] |
| Budibase | 内部应用建设者、IT 或实施者 | 仓库总体 GPLv3；进入生成应用的包使用 MPL 2.0；付费功能在 `packages/pro` 使用 BSL。必须按包区分，不能把全部功能称作同一开源许可。[许可][BB-LICENSE] | 官方 Free 自托管列出不限应用/用户/操作/自动化、1 workspace；高级能力另列。Docker 文档建议多数用途 2 核/6 GB。资源建议不是报价或性能保证。[定价][BB-PRICE] [部署][BB-DOCKER] |
| 微信报名工具 | 活动组织者和微信参与者 | 本轮未发现可据以自托管的开放源码许可；按商业在线产品比较，不能说成开源。 | 官方列有免费能力和 VIP 差异；本轮不推算费用。无需用户维护其服务器，但存在产品规则、通知和导出/保留限制。[权益][BM-VIP] |
| 到梦空间 | 学校、学院、学生组织与学生；第二课堂流程 | 本轮没有核实公开源码许可或自托管版本。 | 学校实际使用已核实；机构合同价格、学校部署方式和集成成本未知，不能因学生可下载就称学校免费。 |
| 易班/易瞄瞄 | 学校、学院、班级和学生；活动及过程记录 | 本轮没有核实公开源码许可或自托管版本。 | 官方移动端介绍有免费使用描述；机构侧费用、采购与运行安排未知。[介绍][YB-PRODUCT] |
| 志愿汇 | 志愿组织、学校与志愿者；报名、签到、服务记录 | 本轮没有核实公开源码许可或自托管版本。 | 学校使用已核实；机构商业价格、自托管和集成成本未知。不能由学生端使用推断全部免费。 |

## 4. 八个代表：业务能力与数据带出矩阵

| 代表 | 组织 / 多人参与 | 逐人材料、审核和补正 | 通知 | 数据带出与边界 |
| --- | --- | --- | --- | --- |
| campus-errand | **源码**：多个申请者最终选一位 `receiverId`；不是一个任务多人分别完成 | **源码**：接单者可发带图片、地点、备注的进度；发布者完成订单。所读路径没有强制凭证待审与退回重交的同等状态模型 | **文档**：发布环境通知缺依赖；不能承诺正常送达 | 学校结果模板、逐人结项包未核实 |
| CampusGo | **源码**：一个 `workerId` 承接订单；学校分层组织和多人独立交付未核实 | **源码**：接单者完成后进入 `CONFIRMED`，发布者确认到 `COMPLETED`；这条路径没有必需的凭证负载 | 未核实 | 学校结果模板、逐人附件包未核实 |
| NocoBase | **文档**：可自行建组织和关系模型；Manual 节点单次一个处理人，不代表应用只能有一个参与者 | **文档**：人工表单、创建/更新记录、通过/拒绝及流程分支；须设计本项目所需关系和状态；商业 Approval 插件与此区分 | 具体渠道、授权和送达需按插件配置；本轮未做端到端验证 | Community 基础 Excel 导出；按记录组织附件的导出为商业 Standard+ 插件。[人工节点][NC-MANUAL] [表格][NC-EXPORT] [附件][NC-ATTACH] |
| Budibase | **文档**：可按用户、角色和记录搭建应用；校园名额与逐人关系需要建模 | **文档**：官方费用审批/变更申请示例含附件、批准/拒绝、理由和状态记录；不等于现成学校结项产品 | **文档**：示例含电子邮件通知；实际送达仍依赖配置 | **文档**：记录可导出 CSV/JSON；特定学校名单与附件一致包需实现。[审批][BB-EXPENSE] [变更][BB-CHANGE] [导出][BB-EXPORT] |
| 微信报名工具 | **文档**：活动、多人报名、容量及多管理员权限；不能据此推断完整学校组织树 | **文档**：必填图片/文件、逐条及批量审核、未通过后修改再交；修改/审核时间记录。没有核实不可变的逐附件版本链 | **文档**：订阅和群发；微信订阅要求用户主动授权。精确到指定缺项的通知流程未完全核实 | **文档**：XLS、内嵌图片表格、文件 ZIP；每条提交一个文件夹并可按昵称命名。官方说明文件字段附件最多保留 3 个月，需按当前规则归档。[附件][BM-IMAGES] [审核][BM-REVIEW] [修改][BM-EDIT] [订阅][BM-NOTIFY] [群发][BM-BROADCAST] |
| 到梦空间 | **文档/学校使用**：学校/学院/部落角色，名额、直接报名、抽签或审核筛选 | **学校使用**：活动后提交成果、附件及组织审核；不能把审核活动发布等同于逐人补正版本管理 | 原生提醒范围本轮未完整核实；学校实例仍结合群聊等渠道，不能反推平台没有通知 | **文档/学校使用**：报名、签到或成绩数据导出；指定学校的完整附件结果包、版本对应方式未知。[操作资料][DM-OPS] [活动后材料][DM-PROOF] [成绩导出][DM-EXPORT] |
| 易班/易瞄瞄 | **文档**：学校/学院/班级；**学校使用**：多人连续活动 | **学校使用**：劳动前后照片、文字、逐日核查与无效反馈；证实有人执行流程，不证明原生具有严格退回重提状态机 | 本轮未核实完整通知闭环 | **学校使用**：结束后统计有效记录；没有核实标准化全部附件导出和指定学校结果模板。[使用实例][YB-USE] |
| 志愿汇 | **文档/学校使用**：组织活动、参与人、签到和服务记录 | 补录或纠错主要针对服务记录；所读指南中补签退回后不能再次申请。动态照片不能直接等同于任务交付凭证 | 本轮未核实本项目需要的逐人缺项补正通知 | **文档**：组织端记录导出有数量/字段规则；学校实际以其数据评优。不能据此认定支持教师最终材料版本包。[学生指南][ZY-STUDENT] [组织指南][ZY-ORG] [学校使用][ZY-USE] |

表格中的“未核实”是证据边界，不是产品缺陷列表。免费或收费边界以相应版本的官方条款为准。

## 5. 最接近能力的深核结果

### 5.1 campus-errand：有图片进度和发布者确认，但核心仍是单人订单

固定提交：`bd8796f36d62b83bb07b23688dbe97b26c76402b`。

- `TaskServiceImpl.confirmTheRecipient`（约 824–880 行）由发布者选择一个申请者，设置一个 `receiverId`，其他申请转为未选中。
- `TaskUpdatesServiceImpl`（约 186–239 行）允许已接单者提交联系、取件、送达等进度及图片、地点、备注。
- `TaskServiceImpl.updateToCompleted`（约 987–1038 行）由发布者在已接单状态下完成订单并评价；所读路径没有教师对每个参加者的凭证版本分别验收。

证据：[订单服务源码][CE-TASK]、[进度服务源码][CE-UPDATES]。这足以推翻“校园任务和确认功能无人开源”，不足以证明它与本项目完全同类。

### 5.2 CampusGo：接单者完成、发布者确认的双步闭环

固定提交：`328746c26f75b5159a3e93cd3ba6ba73e0ea3673`。

`TaskServiceImpl` 中 `acceptTask` 设置单一接单者，`completeTask` 由接单者转为 `CONFIRMED`，`confirmTask` 由发布者转为 `COMPLETED`。这些状态表明存在双边确认；名称 `CONFIRMED` 不能单独当成已经最终通过。所读方法没有要求材料负载，也没有证明多人逐人补正。证据：[源码][CG-TASK]。

### 5.3 报名工具与到梦空间：必须正面承认其覆盖

报名工具已经覆盖收材料、审核、修改、导出和按提交分文件夹。到梦空间也已有活动后的材料填报和审核：长春工程学院制度要求活动结束后填报成果，由组织单位审核、团委复审；青岛黄海学院的读书活动要求后续上传书评照片和借阅截图。把本项目描述成“第一个把报名和成果验收分开”没有依据。[报名工具][BM-IMAGES] [长春工程学院][CCIT-RULES] [读书活动][DM-PROOF]

另一方面，中国农业大学烟台研究院通知要求学院提交结项名单、学分名单及团队材料；“返家乡”另有指定 Excel 录入模板，由工作人员后续录入到梦空间。这支持“收到材料之后仍有特定报送工作”的判断，不证明所用平台没有可配置解决方案。[学校通知][CAU-CLOSEOUT]

## 6. 维护和采用：哪些信号能说明什么

| 代表 | 看到的证据 | 不能推出的结论 |
| --- | --- | --- |
| campus-errand | 2026-08-14 v1.0 发布，公开说明 MVP 状态、通知依赖和后续事项；所见 issue 1 由作者发起 | 发布和自建 issue 不能证明真实学校采用、活跃外部贡献群体或长期维护 |
| CampusGo | 可审查的代码及 MIT 文本 | 本轮没有取得可核实学校采用或持续外部维护证据；不是断言项目无人使用 |
| NocoBase | 本轮见 2026-10-06 v2.2.21 等持续发布记录 | 活跃平台开发不能替代对某个校园模板的采用验证，也不是校园用户规模 |
| Budibase | 本轮见 2026-10-05 v3.48.0 发布；外部用户 issue 18299 描述自己的自托管配置和故障 | 是外部使用的具体信号，不代表高校采用数、留存率或商业规模 |
| 微信报名工具 | 山东大学研究生志愿服务工作细则要求相关活动使用该工具 | 一个明确采用制度不能外推全国份额，也不能说明所有工作都已自动化 |
| 到梦空间 | 多校制度与活动实例；江西旅游商贸职业学院年度总结报告 99% 激活率、6353 场活动、189 万参与人次 | 属学校自报；人次不是独立人数，活动量不是老师结项节省时间 |
| 易班/易瞄瞄 | 四川农业大学食品学院 2026 年活动报告：115 人报名、705 条有效记录，人员逐条检查并统计 | 是特定活动实际工作量，不证明平台自动完成判定，也不是学校整体留存 |
| 志愿汇 | 学校评优通知依托记录导出；蚌埠学院公开报告上一年 1925 项申请、1657 项有效、52719 参与人次及约 12.8 万小时 | 是机构使用证据，不能换算成独立活跃用户或商业付费客户 |

来源：[campus-errand 发布][CE-RELEASE]、[NocoBase 发布][NC-RELEASES]、[Budibase 发布][BB-RELEASES]、[外部用户问题][BB-ISSUE]、[山东大学][BM-USE]、[到梦空间学校年报][DM-REPORT]、[易瞄瞄活动][YB-USE]、[志愿汇使用][ZY-USE]、[蚌埠学院][ZY-REPORT]。

## 7. A / B / C 的反方判断

| 候选 | 最强反对理由 | 决策 |
| --- | --- | --- |
| A：老师结项工作台 | 必填、待审、退回、导出和按人文件夹已有；如果只是这些功能换名称，没有充分采用理由。若现用系统已经直接产出目标交付物，再引入一个系统反而增加负担 | **首要方向，有条件成立**：模板先行、接既有名单、定向补正、被确认版本与最终结果包一致 |
| B：学生材料一次提交，多处复用 | 复用文件不等于多个单位接受一次认定；不同目的和规则可能允许复用，也可能禁止重复计入。统一“批准一次处处有效”没有依据 | **后续范围**：可引用已有材料，但分别申请、分别审核、分别认定；记录材料来源、适用用途与版本 |
| C：可交接的组织记录 | 多管理员和历史列表已经常见；人员离任后服务器、域名和备份失管，仍会断档 | **纳入成品基础**：交接待办、记录、模板、权限和运行责任；支持完整导出及恢复，不只增加管理员按钮 |

关于 B，长春工程学院制度明确同一学生同一项目不重复认定。这是特定规则的实例，不是所有复用都违规的结论。[认定制度][CCIT-RULES] 关于 C，报名工具已有分权限管理员和历史管理员邀请；真正可争取的价值是完整交接及可恢复性。[管理员说明][BM-ADMIN]

## 8. 推荐体验、验证方法与否决条件

推荐定位：**面向学院、项目或学生组织负责人的活动结项助手：先确定交付要求，再把每个人的材料收齐、补正、确认并交出去。**

首版固定 1–2 个有明确来源、用途和版本的模板。国际化应使语言、字段、日期和组织称谓可替换，但不能把中文学校模板当成国外高校普遍要求；国际场景与边界见[国际采用研究](international-adoption.zh-CN.md)。

最小完整体验：

1. 选择一个最终交付用途和模板，显示适用范围、必需材料、字段及文件命名要求。
2. 导入既有名单，用稳定的参与者标识关联材料；明确显示重复、缺号、名单外人员，不能靠昵称猜人。
3. 缺件、待改、待审可见；补正意见关联到具体项，学生只处理需要改的部分。
4. 审核确认具体版本；导出期间有新修改时，不能悄悄混入已确认材料。
5. 生成名单、对应附件及核对清单，人员范围、状态和版本一致；未完成者明确排除或单列。
6. 组织交接覆盖待办、归档、模板、权限收回、运行责任和可恢复备份。
7. 真实送达渠道尚未接通或授权时，明确展示状态与替代入口，不把“生成了通知”当成“学生收到了”。

可以用合成数据立即验证产品机制：60 人名单中 49 人完整、7 人缺件、4 人待补正；4 人补正并通过后输出 53 人结果包，另列 7 人未完成。加入重名、重复提交、改名、名单外记录、被退回旧版本等情况，检查是否仍需手工对人和重命名。这是建议的验收样例，不是本轮测试结果。

[主计划](../../PLAN.md)将最小双语演示定为八人样例；上述 60 人数据可作为补充验证。通用模板足以支持开发和预览，但只有核对了真实接收方的字段、材料和命名要求，并通过对应输出检查，才能标记某个机构模板已经适配；通用演示本身不验证学校直接接收或专用体验优势。

若比较效率，应让同一操作者用同一数据和同一目标模板完成现有工具流程与新流程，分别记录人工关联/改名次数、错误、所需步骤和时间。可以形成可复核的本地证据；不得先写“节省 80% 时间”，也不以“以后找老师试用”代替当前可完成的验证。

**否决或重新缩小范围的条件：**

- 目标单位现用工具已经原样输出要求的交付物，新产品没有消除额外步骤。
- 必须让全部学生重复注册、报名或重交相同材料，增加的负担抵消整理收益。
- 找不到明确的最终模板和接收方要求，只能继续泛化做表单平台。
- 输出仍需人工重新匹配学生、改名或判断哪份是最终版，核心承诺没有兑现。
- 主要价值只剩文件重命名和压缩；此时应考虑本地小工具，而不是完整多角色平台。
- 每新增一个模板都要专门改核心代码，维护成本不能通过模板贡献和规则配置摊薄。
- 自动检查越界成真实性、学分资格或工资认定，且无被授权的规则和人工责任边界。
- 没有可承担的安装、升级、备份恢复和人员交接方式；“自托管”只把工作转嫁给下一届学生。

## 9. AGPL 开源的实际产品价值

AGPL 是协作方式，不是需求证明或技术壁垒。陌生人选择本项目的可能原因应当是：拿来就能完成一个明确结项工作、能在自己的环境运行、能带走数据、模板可改、交接可恢复；而不是代码使用了某个前后端框架。

可积累的开源资产包括：

- 有来源与版本的结项模板、字段映射和材料规则；贡献者可增加自己的组织模板。
- 匿名或合成样例、预期输出及一致性验证，帮助复核每个模板是否工作。
- 稳定的材料版本与导出约定、清晰的数据迁出方式。
- 中英文操作与部署文档，升级和恢复演练，维护者交接说明。
- 有边界的扩展接口，使新的通知渠道或模板不用复制整套项目。

采用失败的可能根因是现有微信入口已经足够、缺少安装维护负责人、每校定制成本过高、正式认定仍必须回原平台、学生不愿再交一次材料，以及项目不能持续维护。这些是基于竞争结构的推断，本项目尚无真实采用数据可确认其权重。

AGPL 第 13 节对修改后通过网络交互的版本规定提供对应源码的义务；它不等于禁止商业使用，也不会自动要求公开学生上传的数据。相关表述应以 [GNU AGPL 官方文本][GNU-AGPL] 为准，不扩张成“所有相关系统都必须开源”。

**许可证发布检查项：**

- 用户已选择 AGPL 开源方向，但尚未决定 `AGPL-3.0-only` 还是 `AGPL-3.0-or-later`；必须在发布前明确精确选项并统一文案。本研究不替用户作出该选择。
- 2026-10-08 本地 [LICENSE](../../LICENSE) 仍为 MIT，版权行为 `Copyright (c) 2023 zvms`；旧 README 链接 [ZVMS 前端来源][ZVMS-UPSTREAM]。保留所复用 MIT 代码的版权与许可告知，建立来源说明；本轮没有改动旧 README 或 LICENSE。
- [MIT 官方许可文本][MIT-OFFICIAL] 要求保留版权和许可告知。项目层面采用 AGPL 不能抹去原有来源，也不意味着已经核清所有文件与依赖的许可。
- 发布前核对实际分发文件、依赖和来源，提供与发布版本对应的源码入口；不要把研究中的竞品许可推断成可直接复制其代码的授权结论。
- 工资/支付、通用学分或工时认定引擎、全校 SSO 替换、跨校统一批准、AI 自动验真，不因“完整计划”而进入首版承诺。B 的受控材料复用属于后续范围；C 的可交接性属于成品要求。

## 10. 来源索引

以下为本轮核查所用的主要原始来源。固定提交链接可复核代码判断；产品文档、价格和主分支许可可能更新。学校数据是发布单位自述。重复引用并不构成独立证据。

### 开源项目与可配置替代

- [campus-errand 订单服务（固定提交）][CE-TASK]
- [campus-errand 进度服务（固定提交）][CE-UPDATES]
- [campus-errand LICENSE（固定提交）][CE-LICENSE]
- [campus-errand v1.0 发布说明][CE-RELEASE]
- [CampusGo 订单服务（固定提交）][CG-TASK]
- [CampusGo MIT LICENSE（固定提交）][CG-LICENSE]
- [NocoBase 当前许可证][NC-LICENSE]
- [NocoBase 人工节点][NC-MANUAL]
- [NocoBase 基础导出][NC-EXPORT]
- [NocoBase 附件导出插件][NC-ATTACH]
- [NocoBase 系统要求][NC-REQ]
- [NocoBase 版本发布][NC-RELEASES]
- [Budibase 按包许可说明][BB-LICENSE]
- [Budibase 官方定价与自托管权益][BB-PRICE]
- [Budibase Docker 部署][BB-DOCKER]
- [Budibase 费用审批示例][BB-EXPENSE]
- [Budibase 变更申请示例][BB-CHANGE]
- [Budibase 数据操作与导出][BB-EXPORT]
- [Budibase 版本发布][BB-RELEASES]
- [Budibase 外部自托管用户问题 18299][BB-ISSUE]

### 学校正在使用的替代品

- [报名工具图片收集和分文件夹导出][BM-IMAGES]
- [报名工具审核][BM-REVIEW]
- [报名工具修改与时间记录][BM-EDIT]
- [报名工具管理员权限][BM-ADMIN]
- [报名工具订阅通知][BM-NOTIFY]
- [报名工具群发通知][BM-BROADCAST]
- [报名工具权益页面][BM-VIP]
- [山东大学研究生志愿服务工作细则][BM-USE]
- [四川轻化工大学到梦空间操作资料][DM-OPS]
- [青岛黄海学院读书活动：后续上传材料][DM-PROOF]
- [黄山学院第二课堂成绩工作：导出与核查][DM-EXPORT]
- [江西旅游商贸职业学院年度总结][DM-REPORT]
- [长春工程学院社会实践学分管理办法][CCIT-RULES]
- [中国农业大学烟台研究院社会实践与模板通知][CAU-CLOSEOUT]
- [易班移动端产品介绍][YB-PRODUCT]
- [四川农业大学食品学院易瞄瞄劳动活动记录][YB-USE]
- [浙江大学志愿汇学生指南][ZY-STUDENT]
- [中国石油大学（北京）克拉玛依校区志愿汇组织管理指南][ZY-ORG]
- [安徽工业大学志愿服务评优通知][ZY-USE]
- [蚌埠学院志愿服务工作报告][ZY-REPORT]

### 本项目许可与来源

- [GNU AGPL v3 官方文本][GNU-AGPL]
- [OSI MIT 许可文本][MIT-OFFICIAL]
- [旧 README 指向的 ZVMS 前端仓库][ZVMS-UPSTREAM]
- [本地现有 LICENSE](../../LICENSE)

[CE-TASK]: https://github.com/liulasty/campus-errand/blob/bd8796f36d62b83bb07b23688dbe97b26c76402b/src/main/java/com/lz/service/impl/TaskServiceImpl.java
[CE-UPDATES]: https://github.com/liulasty/campus-errand/blob/bd8796f36d62b83bb07b23688dbe97b26c76402b/src/main/java/com/lz/service/impl/TaskUpdatesServiceImpl.java
[CE-LICENSE]: https://github.com/liulasty/campus-errand/blob/bd8796f36d62b83bb07b23688dbe97b26c76402b/LICENSE
[CE-RELEASE]: https://github.com/liulasty/campus-errand/releases/tag/v1.0
[CG-TASK]: https://github.com/huangcancan-xbc/CampusGo/blob/328746c26f75b5159a3e93cd3ba6ba73e0ea3673/backend/src/main/java/com/campus/errand/service/impl/TaskServiceImpl.java
[CG-LICENSE]: https://github.com/huangcancan-xbc/CampusGo/blob/328746c26f75b5159a3e93cd3ba6ba73e0ea3673/LICENSE
[NC-LICENSE]: https://github.com/nocobase/nocobase/blob/main/LICENSE.txt
[NC-MANUAL]: https://docs.nocobase.com/workflow/nodes/manual
[NC-EXPORT]: https://docs.nocobase.com/interface-builder/actions/types/export
[NC-ATTACH]: https://docs.nocobase.com/interface-builder/actions/types/export-attachments
[NC-REQ]: https://docs.nocobase.com/get-started/system-requirements
[NC-RELEASES]: https://github.com/nocobase/nocobase/releases
[BB-LICENSE]: https://github.com/Budibase/budibase/blob/master/LICENSE
[BB-PRICE]: https://budibase.com/pricing
[BB-DOCKER]: https://docs.budibase.com/docs/docker
[BB-EXPENSE]: https://docs.budibase.com/docs/expense-approval
[BB-CHANGE]: https://docs.budibase.com/docs/change-requests
[BB-EXPORT]: https://docs.budibase.com/docs/data-actions
[BB-RELEASES]: https://github.com/Budibase/budibase/releases
[BB-ISSUE]: https://github.com/Budibase/budibase/issues/18299
[BM-IMAGES]: https://baominggongju.com/articles/form-image-collect/
[BM-REVIEW]: https://baominggongju.com/articles/batch-review/
[BM-EDIT]: https://baominggongju.com/articles/transfer-cancel-edit/
[BM-ADMIN]: https://baominggongju.com/articles/add-admin/
[BM-NOTIFY]: https://baominggongju.com/articles/subscribe-notifications/
[BM-BROADCAST]: https://baominggongju.com/articles/mass-notification/
[BM-VIP]: https://p.baominggongju.com/auth
[BM-USE]: https://ygb.sdu.edu.cn/info/1223/19702.htm
[DM-OPS]: https://webadm.suse.edu.cn/_s17/2021/1125/c351a42764/page.psp
[DM-PROOF]: https://www.qdhhc.edu.cn/tushuguan/p_detail.aspx?id=40738
[DM-EXPORT]: https://www.hsu.edu.cn/37/a0/c3718a210848/page.htm
[DM-REPORT]: https://www.jxlsxy.edu.cn/lsyw/8a386a2f336a499a9a0b9c1816a80597.htm
[CCIT-RULES]: https://tuanwei.ccit.edu.cn/info/1008/12622.htm
[CAU-CLOSEOUT]: https://yt.cau.edu.cn/art/2025/6/16/art_43337_1072713.html
[YB-PRODUCT]: https://www.y.yiban.cn/mobile/index.html
[YB-USE]: https://spxy.sicau.edu.cn/info/1471/116211.htm
[ZY-STUDENT]: https://yunfeng.zju.edu.cn/_upload/article/files/07/e7/0b2c07a246d4b7c5beda46e29587/ed4da282-031e-42fa-9697-43b85008e7f0.pdf
[ZY-ORG]: https://www.cupk.edu.cn/gqt/upload/resources/file/2023/10/09/79460.pdf
[ZY-USE]: https://tw.ahut.edu.cn/info/1023/2371.htm
[ZY-REPORT]: https://www.bbc.edu.cn/_t554/2026/0306/c20a125203/page.psp
[GNU-AGPL]: https://www.gnu.org/licenses/agpl-3.0.en.html
[MIT-OFFICIAL]: https://opensource.org/license/mit
[ZVMS-UPSTREAM]: https://github.com/zvms/zvms4-frontend
