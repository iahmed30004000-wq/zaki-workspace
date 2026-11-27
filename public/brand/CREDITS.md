# Brand and decoration assets — origin and licences

Everything in `public/brand/`, `public/fonts/` and `public/icons/` is listed here (and the Apple icon in
`src/app/`). A file that is not listed does not belong in the repository (the repository is public).

| File | What it is | Origin / licence |
|---|---|---|
| `brand/decor/islamic-epic.{rosette,corner,skyline}.webp` | Geometric ornament masks for the "إسلامي ملحمي" theme (white on transparent, tinted by the theme colour in CSS) | The owner's own artwork, made for the OMS and copied from `MKory18/Zaki-ai-CRM` (`public/brand/decor`). Geometry and architecture only: no calligraphy, no text, no people. No third-party material. |
| `brand/decor/neon-coast.{door,door-tall,strip}.webp` | Opaque backgrounds for the "ساحل النيون" theme: a night coast road with neon light (wide, tall and a thin strip) | The owner's own image generations for the OMS (copied from the same place). Original work: not taken from any game or film, no logo, no text. |
| `brand/hero/workspace-dusk.svg` | The picture behind «المهمّة الجاية» on «اليوم» (the "ليل" and "نهار" themes): a dusk scene with the star on the horizon, a road leading to it and three task cards, drawn as a vector, about 3 KB | The project's own original drawing, made for Zaki Workspace: no photograph, no third-party material. |
| `brand/wallpapers/{boxes,phones,bubbles,stars,leaves,coins}.svg` | The six chat wallpapers of the flat themes «سماء» and «ليل أزرق»: simple line icons of work objects (boxes, phones, chat bubbles, stars, leaves, coins) on a 96 px tile, one ink, tinted by the theme's `chat-pattern` colour | The project's own original drawings, made for Zaki Workspace (D1): stroke-only vectors under 1 KB each. No downloaded pattern set, no third-party material. |
| `sounds/ring.mp3` | The ring of a call, heard by the person being rung and by the caller until somebody answers (a short chirp that loops with a pause), 20 KB mono mp3 | «Modern Ringtone [Chirptone]» by Zane Little Music, **CC0** (public domain dedication), https://opengameart.org/content/modern-ringtone-chirptone. Modified: converted from WAV to a mono mp3. |
| `sounds/sent.mp3`, `sounds/received.mp3` | The chat's two soft pops: a message of mine went / somebody else's arrived (the second one twice when it mentions me); about 1 KB each, mono mp3 | «pop2» and «pop6» from «Pop sounds» by cogitollc, **CC0** (public domain dedication), https://opengameart.org/content/pop-sounds. Modified: converted from OGG to mono mp3. |
| `fonts/zaki-digits-{400,500,600,700}.woff2` | "Zaki Digits": the ten Arabic-Indic digits (٠-٩) of IBM Plex Sans Arabic at four weights, also mapped to 0-9, about 1 KB each. Drawn in place of 0-9 when a person picks «الأرقام: ١٢٣» (src/lib/digits.ts) | A Modified Version of IBM Plex Sans Arabic, SIL OFL 1.1 (Copyright 2017 IBM Corp., Reserved Font Name "Plex", so it is renamed); text in `fonts/zaki-digits-OFL.txt`. Built by `scripts/make-digits-fonts.py`. |
| `fonts/reem-kufi-var.woff2` | Reem Kufi (variable, Arabic subset) for the Islamic themes' headings | SIL Open Font License 1.1, text in `fonts/reem-kufi-OFL.txt`. The Reserved Font Name is "Josefin Sans": keep the name "Reem Kufi" and do not rename the font. |
| `icons/icon-192.png`, `icons/icon-512.png` (in `public/`) | The app icon for "any" use (the web app manifest): the «Z» mark on the default theme's paper colour, on a rounded tile with transparent corners | The project's own logo, a «Z» with the eight-pointed star (`src/app/icon.svg`), drawn by `scripts/make-icons.mjs`. No third-party material. |
| `icons/icon-maskable-512.png` (in `public/`) | The maskable app icon: full-bleed paper colour, the mark inside the 80% safe zone so a round or squircle mask cuts nothing | Same as above. |
| `src/app/apple-icon.png` (served by Next at `/apple-icon.png`, outside `public/`) | The iPhone home-screen icon, 180x180, opaque | Same as above. |

IBM Plex Sans Arabic (the body font) and Lalezar (the wordmark «ذكي» of «نجمة وطريق») are loaded
through `next/font/google` at build time and served from this site; both are SIL OFL 1.1.

The whiteboard («الصبورة») is Excalidraw (`@excalidraw/excalidraw`, MIT). Its fonts are copied from that package
into `public/excalidraw/fonts` at build (`scripts/copy-whiteboard-assets.mjs`, not tracked) and served from this site:
Excalifont, Virgil, Nunito, Cascadia Code, Assistant, Liberation Sans and Lilita One are SIL OFL 1.1, Comic Shanns is
MIT; the Chinese / Japanese face Xiaolai is left out.

The field of eight-pointed stars of the "ليل" and "نهار" themes is no file: it is drawn in code
(`patternTileSvg` in `src/lib/themes/decor.ts`), plain geometry, the project's own.

Rules for new files: say who made it and under what licence, keep photos and masks under 150 KB,
and never add anything that reproduces a third party's game, film, brand or character.

## Tooling

`sharp` (a dev dependency, Apache-2.0) is what draws the PNG icons above from `src/app/icon.svg`
(`node scripts/make-icons.mjs`; the PNGs are committed and the build never runs the script) and what
`tests/pwa-icons.test.ts` and `tests/pwa-manifest.test.ts` read them with. Its native image library comes as
separate binary packages (`@img/sharp-libvips-*`), licensed **LGPL-3.0-or-later**.

- ⚠️ The Docker image installs every dependency (`npm ci`) and its runner stage copies the whole
  `node_modules`, so those LGPL binaries ship inside the production image, and the app uses them: the chat
  reads an uploaded image's width and height with sharp (`src/server/chat/attachments.ts`, a runtime
  `import("sharp")`; without it the dimensions are left out and the upload still works). 🔧 Give the runner stage production dependencies only (then none of it ships), or keep the binaries
  unmodified, as npm installs them, and put the LGPL-3.0 text beside them in the image (their `package.json`
  names the licence; the package folders carry no licence file of their own).
- ⚠️ On a machine where sharp's binary cannot be loaded, the icon checks are skipped instead of failing.
  🔧 On CI they are never skipped: `tests/pwa-icons.test.ts` fails there when sharp does not load.

## Chat wallpapers — pictures (`brand/wallpapers/photo/`)

Fifteen picture wallpapers supplied by the owner («خلفيات_الدردشة», 2026-11-20) and used with his permission as the
chat backgrounds. Each is stored three times: a wide file, a tall file for phones, and a small thumbnail for the
picker (converted to WebP, about 2 MB in all). ⚠️ Two of them («كلود», «كلود إيموجي») carry the word «Claude» and two
(«ذكي داكن», «ذكي فاتح») the product's own mark: keep them only while the owner wants them.
