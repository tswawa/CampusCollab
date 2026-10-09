# Dependency and source review

Dependency review: 2026-10-08. Publication check: 2026-10-09. This record describes package and source checks, not institutional adoption.

The application uses `AGPL-3.0-only`. The original ZVMS copyright and MIT notice are preserved verbatim in `LICENSES/ZVMS-MIT.txt`. The license text came from [SPDX license data](https://raw.githubusercontent.com/spdx/license-list-data/main/text/AGPL-3.0-only.txt), SHA-256 `d8a6cc31abc16b6748c7a21f21611f5a1ec33f67d22ca23d7da1c19b95496bee`. Package metadata no longer presents the upstream repository as this project's repository.

ExcelJS writes typed XLSX cells, preserving text IDs without turning user text into formulas. fflate writes ZIP packages. Nodemailer runs only when the deployment owner explicitly enables and configures email. Dependencies retain their own license files; package-lock.json records exact versions.

The first audit found vulnerable existing and newly resolved dependency versions. This branch updates dependencies within declared ranges and makes reviewed transitive selections:

- ExcelJS uses only `uuid.v4()` in inspected code. Its uuid dependency is overridden to CommonJS-compatible 11.1.1 for the [buffer-bounds advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq). XLSX round-trip tests exercise the dependency tree.
- shell-quote uses 1.11.0 for the [command quoting advisory](https://github.com/advisories/GHSA-pqg4-j6r4-53mv).
- fflate uses 0.8.3 for the [malformed ZIP64 fix](https://github.com/advisories/GHSA-px8p-9vwx-vf98). Production creates archives; tests open generated archives.

`npm audit` reported zero known vulnerabilities after these changes and email dependency installation. This is a dated package-database check. Recheck before release; do not use unreviewed `npm audit fix --force` upgrades.

On 2026-10-09, `npm audit` again reported zero known vulnerabilities with the committed lockfile. No dependencies were upgraded for publication.

Default branding uses the geometric SVG and generated images described in [public/ASSETS.md](../public/ASSETS.md). The README screenshots are lossless captures of local instances with fictional people and activities; institution names are examples. Template examples contain fictional data and source links; original institutional workbooks are not redistributed. Personal reference projects, local review archives, raw logs, environment files and runtime data are excluded from Git and the corresponding source archive.

Keep `source.zip` from the exact running build available to its users. Review provenance when adding new third-party assets or template files.

## 中文说明

本项目采用 AGPL-3.0-only，完整保留 ZVMS 原 MIT 声明；依赖仍遵守各自许可证。2026-10-09 复查未发现已知依赖漏洞。默认标识由项目 SVG 生成，README 截图使用虚构数据，学校名称仅为示例；模板保留字段映射、虚构样例和来源链接，不附原始学校表格。公开源码与构建源码包不包含本机审查归档、环境配置、数据库、上传材料或 Git 历史。
