# D1 — The new look and the buttons («الشكل والأزرار»)

> Prerequisites: P0. Runs in parallel with C1 (different files). C2 and N1 build on it. The owner (2026-11-16): «حتى
> الشكل بدي أغيّره والأزرار — إعادة هيكلة 100٪».
>
> Today's look is «نجمة وطريق» (adopted 2026-10-24): four themes (`night` default, `day`, `islamic-epic`, `neon-coast`),
> gold star accent, Lalezar wordmark, photographs on the sidebar header and the Today strip, decoration layers with
> infinite animations and backdrop blur, a pink «+ جديد» pill, cards with borders everywhere. The new direction is
> Telegram's: flat, quiet, list-first, one accent colour, content before decoration.

## 1. Principles (write them into AGENTS.md «Conventions» when D1 merges)

1. **Lists, not cards.** Working screens (chat, tasks, people, files) are full-width lists with thin dividers;
   cards only for dashboards and empty states.
2. **One accent per theme**, used for: the primary button, links, selection, unread badges, own bubbles. Everything
   else is neutral surfaces and text greys. Status colours (ok / warn / danger / info) only for status.
3. **Flat:** no gradients or blur behind content; one soft shadow level for floating things (menus, sheets, FAB).
4. **Decoration only where it was allowed** (AGENTS.md: login door, empty states, sidebar header, Today strip) — and in
   the new default themes those places use the plain identity (logo + colour), the photographs move to the optional
   themes. Nothing is removed: the four existing themes stay selectable (D-D1).
5. **Motion is short and purposeful** (120–200 ms), always off under `prefers-reduced-motion`.

## 2. Two new themes, the new default (D-D1)

Add to `src/lib/themes/registry.ts` + `palettes.ts` (then `npm run themes:css`; the contrast gate
`tests/themes-palettes.test.ts` must pass for every pair):

| Token | «سماء» (light, new default for light) | «ليل أزرق» (dark, new default for dark) |
|---|---|---|
| surface (page / chat wallpaper base) | very light grey-blue | deep blue-grey |
| surface-1 (list, panels) | white | slightly lighter blue-grey |
| surface-2 (hover, inputs) | light grey | lighter blue-grey |
| border | hairline grey | hairline blue-grey |
| fg / fg-muted / muted | near-black / grey / lighter grey (all ≥ 4.5:1 where text) | near-white / grey-blue / dimmer |
| accent / accent-fg | a calm blue / white | a lighter blue / near-black or white (gate decides) |
| accent-2 | a second, warm shape colour (kept for the brand star) | same family, adjusted |
| ok / warn / danger / info | standard, gate-tuned | standard, gate-tuned |

New chat tokens (add to `COLOR_TOKENS`, with contrast pairs in the gate):
`bubble-out`, `bubble-out-fg`, `bubble-in`, `bubble-in-fg`, `chat-wallpaper`, `chat-pattern` (the pattern's ink,
low contrast on purpose — decoration, not text), `selected-row`, `selected-row-fg`, `badge-muted`.
Existing themes get values for the new tokens too (derived from their own palette), so every theme renders the chat.

`theme: "system"` (the column already exists) follows the device: light → «سماء», dark → «ليل أزرق».
The «نجمة وطريق» themes stay in the theme gallery and the theme switch; `night` stops being the default only for
people who never chose a theme (`User.theme = "system"`).

**Fit with what exists:** the themes live in `src/lib/themes/registry.ts` + `palettes.ts` and are driven by the continuous
theme engine merged in #218 (the switch knob `User.themeSwitch`, `src/lib/themes/switch-fx.ts`, the night/day switch).
The two new themes must plug into that engine (registry entry, palette, FX colours, switch mapping) — not a parallel
system. Changing `DEFAULT_THEME` breaks `tests/pwa-manifest.test.ts` (it pins it) and changes the manifest colours:
do it only with D-D1 answered, behind the switch `themeV2Default`, and update that test in the same PR.

**Chat wallpapers:** six SVG patterns drawn in-house for this project (simple line icons of work objects: boxes,
phones, chat bubbles, stars, leaves, coins), tinted by `chat-pattern`, stored in `public/brand/wallpapers/`, credited
as our own work in `public/brand/CREDITS.md` and the guide's «الاعتمادات» article. No downloaded pattern sets.

Strings: `src/lib/i18n/ar.design-v2.json` (theme names, gallery labels).

## 3. Typography

- Body stays IBM Plex Sans Arabic (already loaded; excellent for UI). Sizes: 15 px body in chat/lists (Telegram
  15–16), 13 px secondary, 12 px meta (time, ticks), 17 px titles in app bars, 20/24 px page titles.
- Titles in working screens use Plex semibold (not Reem Kufi); Reem Kufi and Lalezar stay for the brand (wordmark,
  login, empty states). Lalezar stays not preloaded.
- Line height 1.45 for Arabic body text; numbers tabular in times and counters.
- C4's text-size setting scales the chat and list sizes with a CSS variable `--chat-font-scale`.

## 4. The button set (rebuild `src/components/ui/button.tsx` variants, keep its API)

| Variant | Look | Use |
|---|---|---|
| `primary` | filled accent, `accent-fg` label, radius 10 px, 40 px high (44 px touch) | the ONE main action of a screen/dialog |
| `tonal` (new) | `accent/12` fill, accent label | secondary actions next to a primary |
| `ghost` | no fill, fg label, hover `surface-2` | toolbars, list actions |
| `danger` | filled danger | destructive confirms only |
| `link` | accent text, no padding | inline |
| `icon` | 40×40 round, ghost | app bars, composer, headers |
| `fab` (new) | 56×56 round, accent, shadow, icon only | phone: new message / new task |

- Icons: `lucide-react` only, 20 px in bars, 18 px in lists, stroke 2.
- Labels are verbs in Levantine Arabic, short («ابعت», «احفظ», «أضف مهمة»).
- The top bar «+ جديد» pink pill becomes a `primary` button «جديد» with a plus icon on the computer and the `fab` on the
  phone (`src/components/shell/new-wheel.tsx` keeps its menu; `newActionsFor()` unchanged).
- Guard test: no `bg-pink-*`/raw palette classes (already enforced) and no new button styles outside `button.tsx`
  (a source test listing allowed class sets for `<button` in `src/components/**/v2/**` and the shell).

## 5. Other primitives (restyle, keep APIs)

`src/components/ui/`: `input`, `textarea`, `select`, `dialog`/`modal`/`sheet` (phone: sheets from the bottom with a
grab handle; computer: centered dialogs ≤ 480 px), `dropdown-menu` (Telegram-like: 8 px radius, 36 px rows, icons at
the start), `toast` (bottom-center snackbar with optional «تراجع»), `avatar` (round; initials on `avatarHue`; when the picture fails to load — seen live: `/api/avatars/<id>` answering 404 and a broken-image icon on every page — it falls back to the initials and stops asking for that picture), new
`list-row` (the shared row: avatar · title/subtitle · trailing meta/badge, 56/64/72 px densities), new `badge`
(unread pill, muted pill, mention «@»), new `segmented` (two-to-four choices), new `switch` (Telegram toggle).

## 6. Delivery

- [ ] D1.1 Tokens + two themes + generated CSS (`npm run themes:css`) + gate tests.
- [ ] D1.2 Primitives restyled (`ui/*`), new `list-row`, `badge`, `segmented`, `switch`, `fab`; the button set (§4).
- [ ] D1.3 A visual review page in the theme gallery (`/theme-gallery`, exists) showing every primitive in every theme.
- [ ] D1.4 Credits: patterns/sounds/icons are ours or OFL/MIT, listed in `public/brand/CREDITS.md` and the guide's
      «الاعتمادات» article (AGENTS.md rule).

## Acceptance

- [ ] Every theme passes the contrast gate including the new tokens.
- [ ] `/theme-gallery` shows all primitives in all six themes; the owner picks the final accent shades («شيك»).
- [ ] No screen changes behaviour; snapshot/render tests of primitives updated.
