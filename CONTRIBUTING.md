# Contributing / 贡献

Read the [architecture and scope](docs/ARCHITECTURE.md), [plan](PLAN.en.md) and [verification notes](docs/verification.md) before changing a workflow. Use a branch, preserve existing changes and keep migrations additive. Do not rewrite an applied migration or commit real institutional records, credentials or uploaded evidence.

Every functional change needs Chinese and English UI/error resources, permission checks and a meaningful test for its business invariant. Run type checks, API/client tests and affected browser scenarios. Use fictional fixtures. Maintain task/participant/evidence-version relationships, per-item conflict handling and immutable closeout identities.

Template contributions need an ID, version, source URL and date, field/unit definitions, a fictional input fixture and expected output. Explain missing fields and inconsistent source rules. Distinguish a historically verified file layout from acceptance by today's institution; do not claim formal integration without evidence. Never add arbitrary executable template uploads.

Before a pull request, describe the concrete problem, resulting behavior, tests and remaining limits. Contributions to this application are under AGPL-3.0-only; retain upstream and dependency notices. Do not copy third-party material without the right to distribute it.

Keep iterations bounded: reproduce the issue, identify the authoritative module, apply the smallest coherent fix, test the positive and rejection paths, and update affected contracts and documentation. Remove or archive newly orphaned code/configuration with a verified recovery copy. Do not restore retired frameworks, add speculative features or change runtime requirements without evidence. Historical audit results remain tied to their own source fingerprint; current acceptance needs current evidence.

中文：先读架构、边界、计划和验证说明，使用分支并保留既有修改。每轮从真实问题和负责模块出发，完成最小修复、正反回归、文档与源树整理后收敛；不扩展未经证实的需求，不把退役框架重新接回。新功能同时提供中英文，验证权限、材料版本和业务结果。模板须带来源、版本、字段单位、虚构样例及期望输出；历史表格格式不等于当前学校认可。PR 写清问题、行为、验证和限制，不提交真实学生资料或凭据，保留原版权声明。
