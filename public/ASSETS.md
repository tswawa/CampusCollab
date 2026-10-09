# CampusCollab public assets

The 2026-10-09 `brand.svg` is an original geometric drawing created for
CampusCollab: two connected collaboration nodes and a check mark. It contains
no fonts, institution emblems or external artwork. The SVG and its generated
PNG, JPEG, ICO and monochrome SVG variants are distributed under this project's
AGPL-3.0-only license; see [LICENSE](../LICENSE).

Regenerate the existing public image URLs after installing the locked project
dependencies with Node.js 24.13.1 or a newer 24.x release:

```sh
node scripts/generate-icons.mjs
```

The generator uses the existing `sharp` dependency. The opaque maskable icon
keeps the complete symbol inside the central safe area. README screenshots live
in `docs/screenshots/`; they are separate from this icon set.
