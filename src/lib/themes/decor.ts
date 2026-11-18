/**
 * DECORATION — what each theme draws, in the four places it is allowed.
 *
 * A pure module (no React, no DOM, no server imports): the component, the generator script and the tests all
 * read the layers, the files and the numbers from here. The stylesheet is GENERATED from it
 * (`renderDecorCss()` -> `scripts/build-decor-css.mjs` -> `src/components/theme/decor.css`, committed;
 * `tests/themes-decor-css.test.ts` fails when the two differ).
 *
 * Ported from the OMS decoration engine (`theme-decoration.ts` / `theme-shape.ts` there): the IDEAS and the
 * measured NUMBERS are the same, the code is adapted to this stack — the theme is the `data-theme` attribute of
 * <html>, the level is `data-decor`, and every colour is an RGB-triplet variable (`rgb(var(--accent) / .12)`).
 *
 * ── THE RULE THE OWNER DREW HIMSELF ──
 *
 *   ⚠️ NEVER BEHIND A NUMBER, AN AMOUNT OR A TABLE.
 *
 * A glow under a column of figures is a glow somebody reads through, every row, all day. So there are exactly
 * four places, the four where nothing is being measured or decided:
 *
 *   door     sign-in, the first-run set-up and the onboarding: the whole screen behind a calm card.
 *   empty    behind the sentence of a list that has nothing in it yet (~320 px, centred).
 *   sidebar  the 72 px header of the navigation (a corner, turned).
 *   strip    the thin hero strip of the Today page.
 *
 * `tests/themes-decor-guards.test.ts` sweeps the source for a fifth place and for any screen of figures that
 * draws one. And text over a photograph is ALWAYS on a scrim: the pictures are mood, the colour under the words
 * is the page's own (`tests/themes-decor-readable.test.ts` holds the words against the worst picture there could
 * be, through the very numbers below).
 *
 * ── LEVELS (the cookie `zk-decor`, <html data-decor>) ──
 *
 *   off    draws nothing: the layer is `display: none`, so no picture is even requested.
 *   light  (the default) static washes and ornament. Nothing moves, so there is nothing for reduced motion to
 *          switch off and nothing for a hidden tab to waste a frame on.
 *   full   adds one slow motion: a 24 s drift (night, day), a 420 s turn of the door's rosette (epic), a
 *          70 s zoom of the door photograph (neon coast). `prefers-reduced-motion` REMOVES it (not slows it), and
 *          a hidden tab pauses it (`watchDecorVisibility`, a `data-decor-hidden` attribute the stylesheet reads).
 *
 * ── WHAT EACH THEME WEARS ──
 *
 *   night, day                   a PATTERN of eight-pointed stars, drawn in code (an SVG tile written into the
 *                                sheet, no file on the disk), painted in the star's gold (`accent-2`) through a
 *                                CSS mask: «نجمة وطريق», the owner's adopted look. A tile repeats without an edge,
 *                                so the layer may drift.
 *   islamic-epic                 three MASKS — rosette, corner, skyline — white on transparent, painted in the
 *                                theme's accent through CSS `mask`: shape only, never a colour of its own. A
 *                                composed theme turns its rosette; it does not drift (a drift would show a seam of
 *                                background along the edges the corners and the roofline are anchored to).
 *   neon-coast                   three opaque PHOTOGRAPHS (the owner's own generations) under a veil made of the
 *                                theme's surface colour. A photograph does not drift either; the door zooms from
 *                                its centre, which cannot uncover an edge. The door's text column becomes a panel.
 *
 * ── RTL ──
 *
 * The product is Arabic and right-to-left only (`<html dir="rtl">`): "start" is the RIGHT edge. The corners are
 * drawn at the top right and turned for the left; a veil is heaviest at the right, where the words begin.
 */
import { THEME_KEYS, type ThemeKey } from "./registry";

// ───────────────────────────────────────── the places ─────────────────────────────────────────

export const DECOR_KINDS = ["door", "empty", "sidebar", "strip"] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];

/** The class a layer carries, so one sweep can find every one of them. */
export const DECOR_CLASS = "zk-decor";
export const decorClass = (kind: DecorKind): string => `${DECOR_CLASS} ${DECOR_CLASS}-${kind}`;

/** Where the owner's masks and photographs live (public/brand/decor), as the browser asks for them. */
export const DECOR_DIR_URL = "/brand/decor";
/** Where the owner's GPT artwork will arrive (public/brand/art/<slot>.webp). */
export const ART_DIR_URL = "/brand/art";
/** Set on <html> by `watchDecorVisibility` while the tab is hidden; the stylesheet pauses on it. */
export const DECOR_HIDDEN_ATTR = "data-decor-hidden";
/** Set on <html> while the company's «وضع التوفير» is on (`syncDecorEconomy`); the stylesheet hides every decoration layer on it. */
export const DECOR_ECONOMY_ATTR = "data-decor-economy";

// ───────────────────────────────────────── the numbers ─────────────────────────────────────────

/**
 * ── A COMPOSED THEME WEARS THREE DRAWINGS, NOT ONE ──
 *
 * The owner, 21/10: «الشكل خرافي مستوحى من الإسلامي حتى الرسوميات». A rosette to stand in front of, a corner of
 * vine and strapwork at each top corner, and a city's roofline along the bottom. Each is its own mask
 * (`<theme>.rosette.webp`, `.corner.webp`, `.skyline.webp`), all painted from the accent.
 *
 * These numbers are the OMS's, set by eye in a browser at 1920, 1280 and 390 px over the real card size (a first
 * attempt measured by the light each mask moves read a kinder screen than the real one). The corners and the
 * skyline sit at the edges of the screen, where nothing is drawn, and are louder; the rosette sits where the
 * words are, and is the quietest. Night (navy and gold) carries more weight than day (ivory and green), because
 * dark-on-pale is the loudest pairing in the set.
 */
export interface Composition {
  readonly rosette: number;
  readonly corner: number;
  readonly skyline: number;
}
export const COMPOSED = {
  "islamic-epic": { rosette: 0.15, corner: 0.28, skyline: 0.17 },
} satisfies Record<string, Composition>;

/** The three drawings of a composed theme, by the name the file carries. */
export const PIECES = ["rosette", "corner", "skyline"] as const;

/**
 * ── «نجمة وطريق» — A FIELD OF STARS, DRAWN IN CODE ──
 *
 * «ليل» and «نهار» wear one pattern: an eight-pointed star on a square tile, with a quarter star in each corner
 * so the tiles meet as a staggered field. It is vector, written into the sheet as an SVG `data:` URL
 * (`patternTileUrl`), so there is no file to download, nothing to license and nothing to go stale. It is painted
 * in `accent-2`, the star's gold, through the mask: shape only, the colour is the theme's.
 *
 * `ink` is the field's opacity (it is behind words, so the readability test holds it like a rosette); `tile` is
 * the tile's size in px. Night carries a little more than day: gold on paper is the louder pair.
 */
export interface Pattern {
  readonly ink: number;
  readonly tile: number;
}
export const PATTERN = {
  night: { ink: 0.08, tile: 56 },
  day: { ink: 0.035, tile: 56 }, // a hover row of paper (surface-2) takes the accent link to 4.5:1 at this ink
} satisfies Record<string, Pattern>;

/** The 16 corners of an eight-pointed star of outer radius `r` around (cx, cy), as an SVG polygon's points. */
function starPoints(cx: number, cy: number, r: number): string {
  const inner = (r * Math.cos(Math.PI / 4)) / Math.cos(Math.PI / 8);
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const radius = i % 2 === 0 ? r : inner;
    const angle = (i * Math.PI) / 8 - Math.PI / 2;
    pts.push(`${+(cx + radius * Math.cos(angle)).toFixed(2)},${+(cy + radius * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(" ");
}

/** The tile of the star field: a star in the middle and a quarter star in each corner, opaque on transparent. */
export function patternTileSvg(size: number): string {
  const r = size * 0.18;
  const at: Array<[number, number]> = [
    [size / 2, size / 2],
    [0, 0],
    [size, 0],
    [0, size],
    [size, size],
  ];
  const stars = at.map(([x, y]) => `<polygon points="${starPoints(x, y, r)}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${stars}</svg>`;
}

/** The tile as the `data:` URL the mask uses (base64: the sheet then holds no quote, no colour word, no `#`). */
export const patternTileUrl = (size: number): string => `data:image/svg+xml;base64,${btoa(patternTileSvg(size))}`;

/**
 * ── A THEME THAT WEARS PHOTOGRAPHS — THE ONE PLACE «MASKS ONLY» IS BROKEN, AND WHAT HOLDS IN ITS PLACE ──
 *
 * The rule «shape only, never colour» protects against a full-colour picture carrying greens and golds that no
 * palette test ever looks at. The owner asked for exactly that for one theme («ثيم بصور حقيقية»), so
 * `neon-coast`, and only it, wears three real photographs, and what the rule protected is protected another way:
 *
 *   • THE LIST IS CLOSED (this table has one key; the files test fails on a second without a decision).
 *   • THE FOUR PLACES ARE THE SAME FOUR. Never behind a figure, a table or a form.
 *   • THE TEXT DOES NOT DEPEND ON THE PICTURE: every word is read on a panel / a veil of the page's own colour,
 *     and a test composites the worst picture there could be (pure white) and the brightest region of the real
 *     files through these numbers.
 *
 *   door     the wide picture, or the portrait one on a phone (a browser asks for ONE of them), under a veil of
 *            `veil` alpha at the top, the middle and the bottom — mood, not safety. The door's text column becomes
 *            a panel of `panel` alpha, and THAT, not the picture, is what every word is read against.
 *   empty    the same picture at `empty` opacity behind the list's sentence, faded to nothing at its edges.
 *   header   the 5:1 strip across the 72 px header and the Today strip, under a veil that is heaviest where the
 *            words are (the right-hand side, the start): `header[0]` there and `header[1]` at the far end. The
 *            picture was shot with its calm sea on the right for that reason.
 */
export interface Photographs {
  readonly door: string;
  readonly doorTall: string;
  readonly strip: string;
  readonly panel: number;
  readonly veil: readonly [number, number, number];
  readonly empty: number;
  readonly header: readonly [number, number];
}
export const PHOTOGRAPHIC = {
  "neon-coast": {
    door: "neon-coast.door.webp",
    doorTall: "neon-coast.door-tall.webp",
    strip: "neon-coast.strip.webp",
    panel: 0.8,
    veil: [0.55, 0.2, 0.55],
    empty: 0.14,
    header: [0.82, 0.25],
  },
} satisfies Record<string, Photographs>;

/** The soft radial washes of the `light` level: the accent at this alpha, fading to nothing. Static. */
export const WASH = 0.12;

/**
 * The panel to put under words that sit over a PICTURE the code does not control (`.zk-scrim`, and the text
 * column of a door whose login picture has loaded). It is nearly opaque on purpose: whatever the owner's artwork
 * turns out to be, the colour under the words stays the page's own, and the contrast gate of the theme tokens
 * (which holds `fg`, `fg-muted` and `accent` on the plain surface) is what holds here, with a margin that
 * `tests/themes-decor-readable.test.ts` proves over pure white AND pure black in every theme.
 */
export const SCRIM = { alpha: 0.94, blur: 10 } as const;

/** Seconds of each slow motion of the `full` level. */
export const MOTION = { drift: 24, turn: 420, zoom: 70 } as const;

/**
 * THE CEILINGS. A number is nudged by somebody who reads it as taste, «to make it show»; these are what stops it.
 * The rosette has the lowest because it sits where the words are; the corners and the skyline live at the edges.
 */
export const CAPS = {
  rosette: 0.2,
  corner: 0.3,
  skyline: 0.3,
  pattern: 0.12,
  empty: 0.2,
  wash: 0.2,
  /** A panel under words over a picture is at least this opaque. */
  panelMin: 0.75,
} as const;

/**
 * ── THE FLAT THEMES WEAR NOTHING (D1) ──
 *
 * «سماء» and «ليل أزرق» are the Telegram-style direction: flat, quiet, list-first, content before decoration. In the places where decoration was
 * allowed (the login door, an empty list, the sidebar header, the Today strip) they use the plain identity — the logo and the colour — so each of the four
 * places has a rule that draws nothing. No file, no pattern, no motion.
 */
export const PLAIN = ["sky", "blue-night"] as const satisfies readonly ThemeKey[];

// ───────────────────────────────────── what a theme owns on the disk ─────────────────────────────────────

type ComposedKey = keyof typeof COMPOSED;
type PhotographicKey = keyof typeof PHOTOGRAPHIC;
type PatternKey = keyof typeof PATTERN;

const isComposed = (key: ThemeKey): key is ComposedKey & ThemeKey => key in COMPOSED;
const isPhotographic = (key: ThemeKey): key is PhotographicKey & ThemeKey => key in PHOTOGRAPHIC;

/** The files (names under public/brand/decor) a theme draws with. */
export function decorFilesOf(theme: ThemeKey): string[] {
  if (isComposed(theme)) return PIECES.map((piece) => `${theme}.${piece}.webp`);
  if (isPhotographic(theme)) {
    const p = PHOTOGRAPHIC[theme];
    return [p.door, p.doorTall, p.strip];
  }
  return []; // a pattern theme draws in code: no file
}

/** Every file of every theme: exactly what public/brand/decor must hold. */
export function allDecorFiles(): string[] {
  return THEME_KEYS.flatMap((theme) => decorFilesOf(theme));
}

// ───────────────────────────────────── the artwork that arrives later ─────────────────────────────────────

/**
 * The slots of the owner's GPT artwork, by the lower-case words of his prompt list. A page asks for a slot by
 * name; the picture is `public/brand/art/<slot>.webp`, and until that file exists the page shows nothing broken
 * (`ArtSlot` hides itself on error) and the CSS ornament is the fallback.
 *
 *   login-door, today-strip     two SCENES (a night gate, a city at dusk) — Islamic themes only, see ART_SCENES.
 *   empty-*                     one object on a tile, for an empty list (1:1).
 *   guide-*                     the drawings of the in-app guide (4:3).
 */
export const ART_SLOTS = [
  "login-door",
  "today-strip",
  "empty-chat",
  "empty-tasks",
  "empty-library",
  "empty-inbox",
  "empty-search",
  "guide-welcome",
  "guide-spaces",
  "guide-message-to-task",
  "guide-notifications",
  "guide-install-app",
] as const;
export type ArtSlotName = (typeof ART_SLOTS)[number];

/**
 * The two slots that are SCENES painted in the Islamic palette (night navy, gold). They belong to «إسلامي ملحمي»:
 * «ساحل النيون» has its own photographs, and «ليل» and «نهار» their field of stars. The stylesheet hides them
 * elsewhere (and when decoration is off), so no other theme ever downloads them.
 */
export const ART_SCENES = ["login-door", "today-strip"] as const satisfies readonly ArtSlotName[];
const SCENE_THEMES = ["islamic-epic"] as const satisfies readonly ThemeKey[];

export function isArtSlot(value: unknown): value is ArtSlotName {
  return typeof value === "string" && (ART_SLOTS as readonly string[]).includes(value);
}

/**
 * The artwork files that ACTUALLY exist in `public/brand/art/` right now. Until the owner delivers
 * any, this list is empty and `ArtSlot` renders NOTHING (no request, no broken image, no flash):
 * the CSS ornament is the whole decoration. A slot is only listed here once its file is shipped.
 */
export const ART_AVAILABLE: readonly ArtSlotName[] = [];

export const artUrl = (slot: ArtSlotName): string => `${ART_DIR_URL}/${slot}.webp`;

export type ArtState = "loading" | "loaded" | "failed";

/**
 * What the browser knows about an <img> right now. A `complete` image with no width is a file that failed to
 * load or to decode (a 404 included). It is read when the component mounts too: an error that fired while the
 * server's HTML was still being parsed is gone before React attaches its listener, and is not replayed.
 */
export function artStateOf(img: { complete: boolean; naturalWidth: number } | null | undefined): ArtState {
  if (!img || !img.complete) return "loading";
  return img.naturalWidth > 0 ? "loaded" : "failed";
}

// ───────────────────────────────────── a hidden tab pauses the motion ─────────────────────────────────────

export interface VisibilityTarget {
  hidden: boolean;
  documentElement: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void };
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

interface Watcher {
  count: number;
  sync: () => void;
}
const watchers = new WeakMap<object, Watcher>();

/**
 * A CSS animation in a hidden tab can still composite on some platforms, and «some platforms» means a phone with
 * eleven tabs open. While the tab is hidden <html> carries `data-decor-hidden`, and one stylesheet rule pauses
 * every layer on it. Layers share ONE listener (a page can mount several): the first to unmount does not take
 * the others' pause away, the last one removes the listener and the attribute. The returned function stops one
 * watcher and is harmless to call twice (React strict mode mounts, unmounts and mounts again).
 */
export function watchDecorVisibility(doc: VisibilityTarget): () => void {
  let watcher = watchers.get(doc);
  if (!watcher) {
    const fresh: Watcher = {
      count: 0,
      sync: () => {
        if (doc.hidden) doc.documentElement.setAttribute(DECOR_HIDDEN_ATTR, "1");
        else doc.documentElement.removeAttribute(DECOR_HIDDEN_ATTR);
      },
    };
    watchers.set(doc, fresh);
    watcher = fresh;
  }
  const mine = watcher;
  if (mine.count === 0) doc.addEventListener("visibilitychange", mine.sync);
  mine.count += 1;
  mine.sync();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    mine.count -= 1;
    if (mine.count === 0) {
      doc.removeEventListener("visibilitychange", mine.sync);
      doc.documentElement.removeAttribute(DECOR_HIDDEN_ATTR);
    }
  };
}

export interface EconomyRoot {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * «وضع التوفير» (the company's switch, `economyActive()` on the screen): the decoration layers are off, as at the level «off».
 * The old themes keep their look for everybody else; the flat themes of D1 draw nothing either way (the stylesheet's economy stop reads this attribute).
 * Writing the same state twice changes nothing.
 */
export function syncDecorEconomy(root: EconomyRoot, on: boolean): void {
  if (on) root.setAttribute(DECOR_ECONOMY_ATTR, "1");
  else root.removeAttribute(DECOR_ECONOMY_ATTR);
}

const economyHolds = new WeakMap<object, number>();

/**
 * A layer's claim on the economy attribute: the LAST layer to go takes it off <html>, so a mark made for a shell does not outlive
 * every layer of it. The returned function is harmless to call twice (React strict mode mounts, unmounts and mounts again).
 */
export function holdDecorEconomy(root: EconomyRoot): () => void {
  economyHolds.set(root, (economyHolds.get(root) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (economyHolds.get(root) ?? 1) - 1;
    economyHolds.set(root, left);
    if (left <= 0) root.removeAttribute(DECOR_ECONOMY_ATTR);
  };
}

// ───────────────────────────────────── the stylesheet ─────────────────────────────────────

type Decl = readonly [prop: string, value: string];
const d = (prop: string, value: string | number): Decl => [prop, String(value)];

/** One rule, a selector list on lines of its own and one declaration per line. */
function rule(selectors: string | readonly string[], decls: readonly Decl[]): string {
  const list = typeof selectors === "string" ? [selectors] : selectors;
  return `${list.join(",\n")} {\n${decls.map(([p, v]) => `  ${p}: ${v};`).join("\n")}\n}`;
}

/** An at-rule around rules, indented. */
function atRule(prelude: string, rules: readonly string[]): string {
  const inner = rules
    .map((r) =>
      r
        .split("\n")
        .map((line) => (line ? `  ${line}` : line))
        .join("\n"),
    )
    .join("\n\n");
  return `${prelude} {\n${inner}\n}`;
}

/** A comment sits directly on top of the rule it explains, with no blank line between them: see `join`. */
const GLUE = "\u0001";
const comment = (text: string): string => `/* ${text} */${GLUE}`;
const banner = (title: string): string => `/* ── ${title} ── */`;

/** Blocks are separated by a blank line, except that a comment is glued to the block after it. */
function join(blocks: readonly string[]): string {
  let out = "";
  blocks.forEach((block, i) => {
    if (i > 0) out += blocks[i - 1]?.endsWith(GLUE) ? "\n" : "\n\n";
    out += block;
  });
  return out.split(GLUE).join("");
}

const url = (file: string): string => `url(${DECOR_DIR_URL}/${file})`;
/** A theme variable at an alpha: the only way a colour is written in the sheet. */
const tint = (token: "accent" | "surface", alpha: number): string => `rgb(var(--${token}) / ${alpha})`;
/** Both spellings of the shorthand: Safari still wants the prefix, and a theme losing its ornament is a smaller failure than a solid accent-coloured square. */
const mask = (value: string): Decl[] => [d("-webkit-mask", value), d("mask", value)];
const maskOf = (file: string, at: string, size: string): Decl[] => mask(`${url(file)} no-repeat ${at} / ${size}`);
const backdrop = (px: number): Decl[] => [d("-webkit-backdrop-filter", `blur(${px}px)`), d("backdrop-filter", `blur(${px}px)`)];
/** The accent, painted through whatever mask the rule adds, at the layer's own opacity. */
const ink = (opacity: number): Decl[] => [d("background-color", "rgb(var(--accent))"), d("opacity", opacity)];
/** A pseudo-element that fills the layer. */
const pseudo: Decl[] = [d("content", '""'), d("position", "absolute"), d("inset", 0)];
/** An element that fills the layer. */
const fill: Decl[] = [d("display", "block"), d("position", "absolute"), d("inset", 0)];
/** A square of at most 320 px, centred in an empty list's box: a mask is clipped to the box it belongs to, and a list with nothing in it is short. */
const square: Decl[] = [d("margin", "auto"), d("width", "min(320px, 100%)"), d("height", "min(320px, 100%)")];

const theme = (key: ThemeKey): string => `[data-theme="${key}"]`;
const full = (key: ThemeKey): string => `[data-decor="full"]${theme(key)}`;

/** The base layer: the washes of the `light` level, off at «off», gone in forced colours. */
function layerRules(): string[] {
  return [
    banner("THE LAYER — behind the content of its parent, clicking nothing, saying nothing"),
    comment("Two soft washes of the theme's accent, in two corners. Static: nothing for reduced motion to switch off."),
    rule(`.${DECOR_CLASS}`, [
      d("position", "absolute"),
      d("inset", 0),
      d("z-index", 0),
      d("overflow", "hidden"),
      d("pointer-events", "none"),
      d(
        "background",
        `radial-gradient(120% 85% at 85% 0%, ${tint("accent", WASH)} 0%, transparent 55%), radial-gradient(100% 70% at 10% 100%, ${tint("accent", WASH)} 0%, transparent 50%)`,
      ),
    ]),
    comment("The header and the strip are short, so their wash comes from the start side only: two washes in 72 px read as a smudge."),
    rule(`.${DECOR_CLASS}-sidebar`, [d("background", `radial-gradient(140% 160% at 100% 0%, ${tint("accent", WASH)} 0%, transparent 70%)`)]),
    rule(`.${DECOR_CLASS}-strip`, [d("background", `radial-gradient(90% 180% at 100% 0%, ${tint("accent", WASH)} 0%, transparent 70%)`)]),
    comment("The door's two extra layers are empty until a composed theme draws them."),
    rule([`.${DECOR_CLASS}-l`, `.${DECOR_CLASS}-b`], [d("display", "none")]),
    comment("«off» draws nothing: the layer is not displayed, so no picture is ever requested."),
    rule(`[data-decor="off"] .${DECOR_CLASS}`, [d("display", "none")]),
    atRule("@media (forced-colors: active)", [rule(`.${DECOR_CLASS}`, [d("display", "none")])]),
  ];
}

/** The two Islamic themes: three masks each, painted in the accent. */
function composedRules(key: ComposedKey): string[] {
  const c = COMPOSED[key];
  const P = theme(key);
  const file = (piece: (typeof PIECES)[number]) => `${key}.${piece}.webp`;
  const corner = (opacity: number): Decl[] => [...ink(opacity), ...maskOf(file("corner"), "right top", "min(46vmin, 420px) auto")];
  return [
    banner(`${key.toUpperCase()} — three masks: a rosette, a corner, a skyline`),
    comment("Door: the rosette behind the content (::before, painted first), a corner at each top corner, the skyline along the bottom. The corners and the skyline sit at the edges of the viewport, where nothing is drawn, so they work at any width."),
    rule(`${P} .${DECOR_CLASS}-door::before`, [...pseudo, ...ink(c.rosette), ...maskOf(file("rosette"), "center", "min(92vmin, 1000px)")]),
    rule(`${P} .${DECOR_CLASS}-door::after`, [...pseudo, ...corner(c.corner)]),
    comment("The left corner is the right one, turned: one file, drawn three times, not 68 KB of the same bytes."),
    rule(`${P} .${DECOR_CLASS}-door .${DECOR_CLASS}-l`, [...fill, ...corner(c.corner), d("transform", "scaleX(-1)")]),
    rule(`${P} .${DECOR_CLASS}-door .${DECOR_CLASS}-b`, [...fill, ...ink(c.skyline), ...maskOf(file("skyline"), "center bottom", "min(100%, 1700px) auto")]),
    comment("An empty list: the rosette alone, in a square of at most 320 px centred behind the sentence."),
    rule(`${P} .${DECOR_CLASS}-empty::after`, [...pseudo, ...square, ...ink(c.rosette), ...maskOf(file("rosette"), "center", "contain")]),
    comment("The 72 px header: one corner, turned, at the end away from the wordmark."),
    rule(`${P} .${DECOR_CLASS}-sidebar::after`, [
      ...pseudo,
      ...ink(c.corner),
      ...maskOf(file("corner"), "right top", "170px auto"),
      d("transform", "scaleX(-1)"),
    ]),
    comment("The Today strip: the skyline along the bottom at the end side, fitted to the strip. The start side is left clear for the greeting."),
    rule(`${P} .${DECOR_CLASS}-strip::before`, [
      d("content", '""'),
      d("position", "absolute"),
      d("inset-block", 0),
      d("inset-inline-end", 0),
      d("width", "min(55%, 560px)"),
      ...ink(c.skyline),
      ...maskOf(file("skyline"), "center bottom", "contain"),
    ]),
  ];
}

/** «ليل» and «نهار»: the field of stars, in the star's gold, in the four places. */
function patternRules(key: PatternKey): string[] {
  const { ink: opacity, tile } = PATTERN[key];
  const P = theme(key);
  const stars: Decl[] = [
    ...pseudo,
    d("background-color", "rgb(var(--accent-2))"),
    d("opacity", opacity),
    ...mask(`url(${patternTileUrl(tile)}) 0 0 / ${tile}px ${tile}px repeat`),
  ];
  return [
    banner(`${key.toUpperCase()} — a field of eight-pointed stars, in the star's gold`),
    comment("Door: the field over the whole screen, behind the opaque card."),
    rule(`${P} .${DECOR_CLASS}-door::after`, stars),
    comment("An empty list: the field in a square of at most 320 px centred behind the sentence."),
    rule(`${P} .${DECOR_CLASS}-empty::after`, [...stars, ...square]),
    comment("The 72 px header and the Today strip: the same field."),
    rule(`${P} .${DECOR_CLASS}-sidebar::after`, stars),
    rule(`${P} .${DECOR_CLASS}-strip::after`, stars),
  ];
}

/** «ساحل النيون»: photographs under a veil of the surface colour, and the panel under the door's words. */
function photographicRules(key: PhotographicKey): string[] {
  const p = PHOTOGRAPHIC[key];
  const P = theme(key);
  const veil = (a: number): string => tint("surface", a);
  const door = (file: string): Decl[] => [
    d(
      "background",
      `linear-gradient(180deg, ${veil(p.veil[0])} 0%, ${veil(p.veil[1])} 45%, ${veil(p.veil[2])} 100%), ${url(file)} center bottom / cover no-repeat`,
    ),
  ];
  /** Heaviest at the start (right) side, where the words are; the calm sea is on that side of the picture. */
  const header: Decl[] = [
    d(
      "background",
      `linear-gradient(to left, ${veil(p.header[0])} 0%, ${veil(p.header[0])} 55%, ${veil(p.header[1])} 100%), ${url(p.strip)} right center / cover no-repeat`,
    ),
  ];
  const fade = "radial-gradient(ellipse at center, rgb(var(--surface)) 38%, transparent 80%)";
  const empty = (file: string): Decl => d("background", `${url(file)} center 72% / cover no-repeat`);
  return [
    banner("NEON-COAST — three photographs, each under a veil of the theme's own surface colour"),
    comment("The veil and the picture are ONE declaration: a browser that drops it shows the plain wash, never a picture with no veil."),
    rule(`${P} .${DECOR_CLASS}-door`, door(p.door)),
    comment("A browser is asked for ONE door picture: the wide one, or the portrait one when the window is taller than it is wide."),
    atRule("@media (orientation: portrait)", [rule(`${P} .${DECOR_CLASS}-door`, door(p.doorTall))]),
    comment("The text column of the door becomes a panel of the page's own colour: that panel, not the picture, is what every word is read against. (Its padding is in the markup, so the panel moves nothing.)"),
    rule(`${P}:not([data-decor="off"]) .zk-door-column`, [d("background", veil(p.panel)), ...backdrop(SCRIM.blur), d("border-radius", "1.25rem")]),
    comment("An empty list: the same picture, faint, faded to nothing at its edges."),
    rule(`${P} .${DECOR_CLASS}-empty`, [empty(p.door), d("opacity", p.empty), ...mask(fade)]),
    atRule("@media (orientation: portrait)", [rule(`${P} .${DECOR_CLASS}-empty`, [empty(p.doorTall)])]),
    comment("The 72 px header and the Today strip: the strip picture, veiled heaviest where the words begin."),
    rule(`${P} .${DECOR_CLASS}-sidebar`, header),
    rule(`${P} .${DECOR_CLASS}-strip`, header),
  ];
}

/** «سماء» and «ليل أزرق»: the four places draw nothing (plain identity). */
function plainRules(key: (typeof PLAIN)[number]): string[] {
  const P = theme(key);
  return [banner(`${key.toUpperCase()} — flat: no decoration, the logo and the colour only`), ...DECOR_KINDS.map((kind) => rule(`${P} .${DECOR_CLASS}-${kind}`, [d("display", "none")]))];
}

/** The `full` level: one slow motion per voice. Each selector begins with the level, so `light` is still. */
function motionRules(): string[] {
  const composed = (Object.keys(COMPOSED) as ComposedKey[]).map((key) => `${full(key)} .${DECOR_CLASS}-door::before`);
  return [
    banner("MOTION — only at the «full» level"),
    comment("The keyframes do nothing until a rule below uses them."),
    `@keyframes zk-decor-drift {\n  from { transform: translate3d(0, 0, 0); }\n  to { transform: translate3d(-2%, 1.5%, 0); }\n}`,
    `@keyframes zk-decor-turn {\n  to { transform: rotate(1turn); }\n}`,
    `@keyframes zk-decor-zoom {\n  to { transform: scale(1.06); }\n}`,
    comment("A wash and a glow may wander; a corner and a roofline anchored to the edges may not, and neither may a photograph."),
    comment("The field of stars repeats without an edge, so a pattern theme's layer may drift."),
    rule(
      (Object.keys(PATTERN) as PatternKey[]).map((key) => `${full(key)} .${DECOR_CLASS}`),
      [d("animation", `zk-decor-drift ${MOTION.drift}s ease-in-out infinite alternate`), d("will-change", "transform")],
    ),
    comment("A composed theme turns its rosette, once round in seven minutes: slow enough that nobody sees it turn and everybody sees that it did."),
    rule(composed, [d("animation", `zk-decor-turn ${MOTION.turn}s linear infinite`)]),
    comment("The photograph of the door zooms from its centre, 6% over seventy seconds: a transform that cannot uncover an edge."),
    rule(`${full("neon-coast")} .${DECOR_CLASS}-door`, [d("animation", `zk-decor-zoom ${MOTION.zoom}s ease-in-out infinite alternate`), d("will-change", "transform")]),
  ];
}

/** Scrims, the pictures that arrive later, the stops. */
function artRules(): string[] {
  const scene = (slot: string): string => `[data-art-slot="${slot}"]`;
  const shown = SCENE_THEMES.flatMap((key) => ART_SCENES.map((slot) => `${theme(key)} ${scene(slot)}`));
  const hiddenOff = ART_SCENES.map((slot) => `[data-decor="off"] ${scene(slot)}`);
  return [
    banner("A SCRIM, AND THE PICTURES THE OWNER ADDS LATER"),
    comment("Put this under words that sit over a picture: the page's own colour, nearly opaque. The picture is mood; the colour under the words is the page's."),
    rule(".zk-scrim", [d("background", tint("surface", SCRIM.alpha)), ...backdrop(SCRIM.blur)]),
    comment("<ArtSlot> renders public/brand/art/<slot>.webp and removes itself if the file is missing, so a picture that has not arrived yet shows nothing broken."),
    rule(".zk-art", [d("display", "block"), d("max-width", "100%"), d("height", "auto")]),
    comment("The login picture covers the door once it has LOADED (the component says so with data-state), and only then does the text column become a scrim panel."),
    rule(".zk-door-art", [
      d("position", "absolute"),
      d("inset", 0),
      d("z-index", 0),
      d("width", "100%"),
      d("height", "100%"),
      d("max-width", "none"),
      d("object-fit", "cover"),
      d("object-position", "center bottom"),
      d("opacity", 0),
      d("transition", "opacity 0.4s ease"),
      d("pointer-events", "none"),
    ]),
    rule('.zk-door-art[data-state="loaded"]', [d("opacity", 1)]),
    rule('.zk-door-art[data-state="loaded"] ~ .zk-door-column', [d("background", tint("surface", SCRIM.alpha)), ...backdrop(SCRIM.blur), d("border-radius", "1.25rem")]),
    comment("The Today strip's picture fills the strip (behind the greeting, which goes on a .zk-scrim). It is cropped from the middle on a phone, where the strip is narrower than the picture."),
    rule(".zk-strip-art", [
      d("position", "absolute"),
      d("inset", 0),
      d("z-index", 0),
      d("width", "100%"),
      d("height", "100%"),
      d("max-width", "none"),
      d("object-fit", "cover"),
      d("object-position", "center"),
      d("pointer-events", "none"),
    ]),
    comment("The two scenes are painted in the Islamic palette: they belong to that theme, and «off» hides them."),
    rule(ART_SCENES.map(scene), [d("display", "none")]),
    rule(shown, [d("display", "block")]),
    rule(hiddenOff, [d("display", "none")]),
  ];
}

/** The stops come last so they win: a hidden tab pauses, reduced motion removes. */
function stopRules(): string[] {
  const layers = [`.${DECOR_CLASS}`, `.${DECOR_CLASS}::before`, `.${DECOR_CLASS}::after`];
  return [
    banner("THE STOPS — they come last, and they are !important"),
    comment("A hidden tab pauses every layer (the attribute is set by watchDecorVisibility)."),
    rule(layers.map((s) => `[${DECOR_HIDDEN_ATTR}] ${s}`), [d("animation-play-state", "paused !important")]),
    comment("«وضع التوفير» switches the layer off, like the level «off» (the attribute is set by syncDecorEconomy): no picture is drawn, nothing moves, no compositor layer is kept."),
    rule([`[${DECOR_ECONOMY_ATTR}] .${DECOR_CLASS}`, ...ART_SCENES.map((slot) => `[${DECOR_ECONOMY_ATTR}] [data-art-slot="${slot}"]`)], [d("display", "none !important")]),
    comment("Reduced motion REMOVES the animation outright, and the fade of a picture; it does not slow them."),
    atRule("@media (prefers-reduced-motion: reduce)", [
      rule(layers, [d("animation", "none !important")]),
      rule([".zk-art", ".zk-door-art"], [d("transition", "none")]),
    ]),
  ];
}

/**
 * The whole decoration stylesheet, as text. Deterministic: the committed `decor.css` is exactly this, and a test
 * fails when they differ. Written for a browser with `rgb(r g b / a)`, `inset` and `mask` (the prefixed spelling
 * is written beside the standard one).
 */
export function renderDecorCss(): string {
  const sections = [
    [
      "/*",
      " * GENERATED by scripts/build-decor-css.mjs from src/lib/themes/decor.ts. DO NOT EDIT BY HAND:",
      " * change the module, run `node scripts/build-decor-css.mjs`, commit both. tests/themes-decor-css.test.ts compares them.",
      " *",
      " * The decoration layer: an aria-hidden div with the classes zk-decor and zk-decor-door, -empty, -sidebar or -strip.",
      " * Everything here is keyed on <html data-theme=... data-decor=off|light|full> and draws with the theme's own",
      " * variables (--accent, --accent-2, --surface) and nothing else. The four places are the only places; see the module.",
      " */",
    ].join("\n"),
    ...layerRules(),
    ...(Object.keys(COMPOSED) as ComposedKey[]).flatMap((key) => composedRules(key)),
    ...(Object.keys(PATTERN) as PatternKey[]).flatMap((key) => patternRules(key)),
    ...(Object.keys(PHOTOGRAPHIC) as PhotographicKey[]).flatMap((key) => photographicRules(key)),
    ...PLAIN.flatMap((key) => plainRules(key)),
    ...motionRules(),
    ...artRules(),
    ...stopRules(),
  ];
  return `${join(sections)}\n`;
}
