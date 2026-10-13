# Locally embedded typeface

The public snapshot embeds Inter in its existing same-origin stylesheet
artifact, so the page makes no font request of its own and none to a third
party. Inter is licensed under the SIL Open Font License 1.1; its verbatim
license is stored in `inter-OFL.txt` beside the font asset.

- Inter: https://github.com/rsms/inter

`inter-latin.woff2` is Inter variable (`wght` 100–900), Latin subset: a byte
copy of `files/inter-latin-wght-normal.woff2` from
`@fontsource-variable/inter` 5.2.8, the same file the Lamp landing and
operator app serve (`src/site/lamp/fonts/`, provenance in
`src/site/lamp/asset-provenance.json`). The public page uses weights 400–600.
