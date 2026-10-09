# Template contracts and contributions

[简体中文](README.zh-CN.md) · [Project documentation](../README.md) · [HFUT historical contract](hfut-2018.en.md)

Institutional templates require a fixed version, source and acceptance fixture. Only inspected source fields may enter the conversion registry. A verified historical field mapping does not establish current institutional acceptance. The adopting institution remains responsible for recognition.

The project includes generic evidence requirements and one historical field converter for Hefei University of Technology's 2018 registration form. Nanjing University and Shandong University publish relevant notices, but their original templates have not been obtained. Their field contracts remain pending; see [source status](pending-sources.json). No institutional maintainer or actual institutional acceptance is established.

## Required contribution contents

| Item | Requirement |
| --- | --- |
| ID and version | Stable ID and positive integer version. Never change published fields, units, calculation policies or defaults in place. |
| Source evidence | Official page and attachment URLs, publication and inspection dates, attachment SHA-256. A notice alone does not establish spreadsheet fields. |
| Maintainer | Named maintainer and review channel, or explicit `unassigned` status. An institution's name does not establish permission to maintain its template. |
| Metadata and fields | Original sheet, cells/columns, required values, types, units, precision, dates and capacity. Include reporting metadata. |
| Rules and ambiguity | Conflicting notes/formulas, missing values, inferred units, selected policy and recognition provenance. Never hide uncertain rules behind a default. |
| Anonymous fixture | Entirely fictional people, student numbers, activity and evidence references. Include leading zeros and identical names with distinct IDs. |
| Independent expected output | Manually checked order, metadata, values and boundaries. Never generate expected values with the converter being tested. |
| Compatibility | Separate the evidence for historical mapping, layout fidelity, current acceptance and institutional recognition. |
| Changes and rollback | New version, reason, affected fields and reproducibility of old versions. Never rewrite historical completion snapshots. |

## Contribution and review workflow

1. Obtain the form from an official source and record its date and SHA-256. Do not access student databases, account cookies or login credentials to retrieve a form. A restricted source needs a reviewable blank form supplied by its holder.
2. Check for example personal records, hidden sheets, notes and author metadata. Create new fictional fixtures. Keep only links and fingerprints when permission to redistribute the original attachment is unconfirmed.
3. Add a fixed version to the [contract module](../../shared/institutional-templates.ts). Define fields, coordinates, units, metadata and ambiguities before implementing the pure converter. Conversion must not access databases, bind accounts, send email or write to external systems.
4. Add Chinese and English documentation, anonymous input and independent expected output here. Extend [contract tests](../../server/tests/template-contracts.test.ts) for valid input, missing values, conflicts, boundaries, unsupported versions and preservation of original data.
5. Include source verification, diff, test commands/results, maintenance status and unresolved institutional questions in the PR. Repository review can establish the code contract. Claims of institutional acceptance also need the responsible department, exact version, date and reviewable acceptance evidence.
6. Test with isolated fictional data, then have an institutional coordinator review the anonymous output. Approval does not transfer to another institution, year, activity or template version.

## Consuming a conversion

Select a fixed version with `getInstitutionalTemplate(id, version)` and call `convertInstitutionalTemplate(input)`. The [anonymous fixture](hfut-2018.anonymous.json) contains the input shape under `input`. Its `expected` object is test data, not API input. Callers must enforce an authorized completion snapshot and confirmed members. A browser must not supply approval status or replace snapshot-confirmed service minutes.

Travel minutes and their source reference are required for every person, including explicit `0` when no travel occurred. `totalPolicy` has no default: choose `manual-confirmed`, `documented-threshold` or `original-formula`. Record the selecting actor, UTC timestamp, reason and `acknowledgedAmbiguity: true`. This records a caller's calculation choice; it does not prove institutional authorization.

The result provides `cells` and `rows` for exporters, plus `originalInput`, original minutes, original formula, source fingerprint, confirmation and warnings. Preserve this provenance alongside the export and associate it with a fixed snapshot version. Write student numbers as XLSX text; apply the existing safe export rules to CSV text. `originalFormula` is evidence text and must not execute instead of the selected policy.

This module does not perform official-system import, authentication, sending or academic recognition. No official receiving API is currently verified. Repeating the same conversion produces the same result without changing accounts, rosters or reviews. Corrections create a new export and association record; previous outputs remain reviewable.

After compilation, use the local preview command to inspect the anonymous fixture. It accepts a direct input object or this fixture's `input` wrapper and creates `preview.json`, `preview.xlsx` and `README.txt` in a new directory without reading the application database. Run `npm run build:server` first, then:

```sh
npm run template:preview -- docs/templates/hfut-2018.anonymous.json ./template-preview
```

The preview supports field and value review. Institutional acceptance remains pending, and nothing is submitted to the institution.

## Verification and rollback

```sh
node --test --test-concurrency=1 --import tsx server/tests/template-contracts.test.ts
npm run type-check:server
npm run type-check:test
python docs/templates/verify-hfut-source.py
```

The last command reads the public file at its fixed URL, verifies SHA-256, then prints fields, instructions, formulas and merged ranges. It does not save the attachment or print source names/student numbers. Network changes or a different hash fail the check; review a new version instead of replacing expected values to bypass it. Contract tests use local fictional data and require no network, real database or `.env`.

Initial version, 2026-10-08: distinguish the historical file actually retrieved from institutional templates still unavailable, preventing unsupported compatibility claims. New files can be reverted through the PR diff. Preserve versions already consumed; disable the new export entry point before reverting a caller. Do not delete existing exports or rewrite snapshots. These additions change no database, production configuration or permission rules.

**Before release, recheck the source fingerprint, anonymous fixture, independent expectations, both languages, maintenance status, institutional acceptance gaps and reproducibility of previous versions. Unverified acceptance remains pending.**
