# مفاتيح المظهر — THEME-SWITCH-FX

The look and the motion of the day/night switch come from ONE source of truth: a 49-second screen recording the owner chose
(`ssstwitter.com_1794162295852.mp4`, 1720 x 1080). There is no source code to copy; every number below was measured on frames
of that video. The gallery «معرض مفاتيح المظهر» (`/theme-gallery`, staff only, behind the `themeSwitchFx` switch) reproduces the six
variants full screen; the top bar's switch (`src/components/theme/switch-fx/`) is their compact version.

Where things live:

| What | Where |
|---|---|
| Pure motion maths (inertia, lamp readings, sky, kelvin, pixel icon, reveal polygon) | `src/lib/themes/switch-motion.ts` |
| Colours (`--fx-*` tokens, light/dark pairs `-l` / `-d`, the muddy middle `-x`) | `src/lib/themes/palettes.ts` (`SCENE_FX`), generated `src/app/themes.css` |
| Knob, frame loop, token reader | `src/components/theme/fx/kit.ts` |
| Glass knob (real refraction) | `fx/glass-knob.tsx`, `fx/glass-maps.ts` |
| Pixel sun / moon | `fx/pixel-icon.tsx` |
| Sky landscape | `fx/sky-art.tsx` |
| Particles | `fx/sheds.tsx` (the switch), the scenes' own pools (the gallery) |
| The six scenes | `src/components/theme/gallery/*-scene.tsx`, `lumen-scenes.tsx` |
| The «repainting NN%» reveal | `src/components/theme/switch-fx/reveal.ts` + the rules at the end of `src/app/globals.css` |

Every scene is drawn on a 1720 x 1080 stage and scaled to the window. The tracks are always drawn left to right (night / moon on
the left, day / sun on the right) because they are pictures; the control pill and the captions are Arabic and right-to-left.
The numbering is the reference's (01 .. 06); the names are Arabic.

⚠️ Effects move a lot of pixels. 🔧 They exist only behind `themeSwitchFx`; `prefers-reduced-motion` and «وضع التوفير» turn the
reveal, the sheds, the rays and the glide off (the knobs still work, the position jumps); every particle pool is capped
(`PARTICLE_CAP` = 120 in the gallery, 60 in the top bar); nothing is heavier than SVG, canvas 2D, CSS and one SVG filter (no WebGL, no Three.js).

## The knob (all variants)

- While dragging the knob follows the pointer with a short lag: exponential smoothing, tau 70 ms (80–90 ms for the sky), the same at any frame rate.
- On release (glass, lamp, repainting) it flies to the nearer end on a damped spring (stiffness 210, damping 21: one small overshoot, then rest);
  a flick (the pointer's speed when it let go) carries it over the middle. A press without travel on the track toggles.
- The sky and the colour temperature do not snap: they stay where they were dropped.
- «Toggle» (the button) and Space glide the knob to the opposite end.

## 06 · Real glass — «زجاج حقيقي»

A huge word under a frosted track (veil 38% light / 55% dark so the word reads grey inside the track, full ink outside) and a 335 px glass
knob sliding in it (x 415 dark .. 1000 light). The knob is a real refraction: an SVG filter inside `backdrop-filter` (Chromium engines;
a flat frosted knob elsewhere) built from two maps drawn once on a canvas — **0.72x magnification**, a **22% bevel with a circular profile**
— and a **red / blue split of ±22%** (three displacements at 1.22 / 1.0 / 0.78 of the bevel's strength, screened together). On top: the tint
(amber in the light page, violet in the dark one), a Fresnel rim and a **caustic glow that leans toward the pointer** ("your pointer is the
light": a white dot follows the pointer with a 110 ms lag). Four mono callouts keep their lines glued to points on the knob while the labels
slide apart (each label has a light and a dark position). The page colour is mixed by the knob's position, so half way is the brown the
reference passes through. The pixel icon dissolves from sun to moon while the knob travels.

## 02 · The knob is the lamp — «المفتاح هو اللمبة»

A pill track with a square knob (pixel sun / moon) and the labels «LAMP» and a live %. The knob lights a whole analytics dashboard: page,
rays (a slowly turning conic fan from the knob), bar colour, card shadows and the readings follow its position:
lux 221 → 738 (`221 + 517 p^0.8`), colour temperature 7,800 K → 2,900 K, % = position. The knob sheds dots and short ticks while it moves.
The numbers on the cards are fake and exist only inside the gallery.

## 03 · repainting — «إعادة الطلاء» (and the product's reveal)

Pressing the toggle (top right) repaints the page from the press. The new page is shown through a torn polygon (`revealPolygon`, 96 points,
spiky) that grows along a logistic curve read off the reference: **1% at 0.5 s, 16% at 1.0 s, 59% at 1.5 s, 96% at 2.0 s** (2 s long).
A canvas layer (its own View Transition group so it stays above both snapshots) draws loose shards running ahead of the edge, thin trails
with a bright head flying outward (violet toward dark, amber toward light), expanding rings, and the «repainting NN%» pill with a progress line.
The percentage is the share of the way to the farthest corner. No View Transitions → the page just changes.

## 04 · ink — «حبر على الورق»

The same engine with the `ink` look: a soft wobbling blot (not spiky), ink droplets that fall as they fly, and no pill; 1.5 s, fast at first with a long tail.

## 05 · drag the sky — «اسحب السما»

A pill with an SVG landscape (far and near mountains, pines, a cabin with smoke, a lake with a sailboat, birds, clouds, lanterns). Dragging
scrubs 00:00 .. 12:00 across the pill. Five captions: midnight (< 01:00), moonset (< 05:00), golden hour (< 07:00), morning (< 11:00), high
noon. Six key frames (`fx-sk0..5-*`: top, low, page colour, far hills, near hills) are blended; the sun climbs its arc from 05:00, the moon
sets from the upper left, the stars and the aurora fade by 05:00, the cabin's window and the lanterns go out in the morning, the clouds turn
pink at the golden hour. The page behind changes colour with the time and the caption's ink follows.
The product's sky switch flips the theme at 06:00.

## 01 · colour temperature — «حرارة اللون»

A moon (left) and a sun (right) with glow orbs, a track with a glass knob that stays where it is dropped, and a scale **10,500 K .. 2,100 K**
with a marker, the live value (`5,900 K`) and a caption: cool above 6,500 K, neutral 4,800–6,500 K, warm below. Moving toward the moon leaves
four-point sparkles, toward the sun square dots; a dotted halo follows the knob; a lens flare grows toward the sun.
In the top bar the position becomes the gentle tint over the app (`warmth`, capped) on release.

## What is not the same as the reference

See the table in the pull request. In short: the giant word is Arabic («زجاج»), the dashboards' text is Arabic with fake numbers, the glass is
Chromium-only (an SVG filter, not WebGL), the repaint reveal's shards are polygons drawn ahead of one torn edge (the reference's pieces are
separate regions of the new page), and the particle trails are fewer.
