/**
 * The computer's motion (768 px and wider): every duration and curve of the reference «تفكيك تيليجرام ويب», section 6 (28 motions, measured at the highest
 * animation level). Numbers and behaviour only; nothing here comes from Telegram's code. The phone's timings stay in `../phone/motion.ts`.
 * Where the prompt and the reference disagree the reference wins; those places say so. Phase 0 declares them; the later phases use them.
 */

export const DK_CURVE = {
  slide: "cubic-bezier(.25,1,.5,1)",
  panel: "cubic-bezier(.33,1,.68,1)",
  menu: "cubic-bezier(.2,0,.2,1)",
  bounce: "cubic-bezier(.34,1.56,.64,1)",
  ease: "ease",
  easeIn: "ease-in",
  easeOut: "ease-out",
  linear: "linear",
} as const;

export const DK_MOTION = {
  /** 1 — a conversation opens (the level «nice and fast» uses `subPage` instead) */
  openChat: { ms: 450, curve: DK_CURVE.slide },
  /** 2, 3 — a sub-page of the list column (settings, menus) and back; the head's colour changes in `headerTintMs` on the way back */
  subPage: { ms: 300, curve: DK_CURVE.slide, shiftPx: 24, headerTintMs: 150 },
  /** 4 — the folder changes: the pill slides, the list fades over */
  folderSwitch: { ms: 300, curve: DK_CURVE.slide, shiftPx: 24 },
  /** 5 — an unread counter appears */
  counterPop: { ms: 150, curve: DK_CURVE.easeOut, fromScale: 0 },
  /** 6 — a space's topics panel opens; the list folds into the strip of pictures */
  topicsPanel: { ms: 300, curve: DK_CURVE.panel, stripAvatarScale: 0.9, textShiftPct: 20 },
  /** 7 — the info panel slides in (pushes from 1276 px, covers below) */
  infoPanel: { ms: 300, curve: DK_CURVE.panel },
  /** 8, 9 — the search opens and closes: ☰ turns into the arrow; folders and results zoom-fade */
  search: { iconMs: 250, fadeMs: 150, curve: DK_CURVE.ease, iconTurnDeg: 180, resultsFromScale: 1.1, foldersBackFromScale: 0.95 },
  /** 10, 11 — any popup menu */
  menuOpen: { ms: 150, curve: DK_CURVE.menu, fromScale: 0.85 },
  menuClose: { ms: 200, curve: DK_CURVE.easeIn, toScale: 0.85 },
  /** 12 — the new-message button leaves while the list scrolls and comes back with a small bounce */
  fab: { ms: 250, curve: DK_CURVE.bounce, shiftPx: 100 },
  /** 13 — the press ripple */
  ripple: { ms: 700, curve: DK_CURVE.linear, toScale: 2 },
  /** 14 — the first letter in the composer */
  firstLetter: { placeholderMs: 200, placeholderShiftPx: 20, placeholderCurve: DK_CURVE.easeOut, sideButtonsMs: 450, sideButtonsShiftPct: 15, sideButtonsCurve: DK_CURVE.slide, sendIconMs: 400, sendIconScales: [0.5, 1.1, 1] },
  /** 15 — a message is sent: it appears in place and its chat's row rises to the top FROM BELOW (the prompt says from above; the reference wins) */
  send: { ms: 200, curve: DK_CURVE.easeOut, rowFromPx: 90, micBackMs: 400, rowCurve: DK_CURVE.ease },
  /** 16 — a right click on a message */
  messageMenu: { dimMs: 200, dimOpacity: 0.55, menuMs: 150, menuCurve: DK_CURVE.menu, reactionsAfterMs: 140, reactionMs: 200, reactionFromScale: 0.5, reactionCurve: DK_CURVE.easeOut },
  /** 17, 18 — the reply / edit bar grows the composer, and shrinks it */
  replyBar: { ms: 150, curve: DK_CURVE.easeOut, heightPx: 50 },
  /** 19 — an edit is saved */
  editSaved: { ms: 400, curve: DK_CURVE.easeOut },
  /** 20 — the emoji card */
  emojiPanel: { ms: 200, curve: DK_CURVE.menu, fromScale: 0.85, contentMs: 200 },
  /** 21, 25 — the selection mode comes and goes */
  selection: { ms: 200, curve: DK_CURVE.easeOut },
  /** 22 — a dialog opens: it comes DOWN into place */
  dialogOpen: { dimMs: 150, ms: 200, curve: DK_CURVE.ease, fromPx: -20 },
  /** 23 — a dialog closes: it goes on DOWNWARDS (the prompt says «reverse», which would be upwards; the reference wins) */
  dialogClose: { dimMs: 150, ms: 200, curve: DK_CURVE.ease, toPx: 20 },
  /** 24 — a deleted message shrinks away (the particle dust is the phone's only) */
  remove: { ms: 200, curve: DK_CURVE.easeIn, toScale: 0.3, shiftPct: 50 },
  /** 26 — a message's side buttons, and the day pill while scrolling */
  hoverButtons: { ms: 150, curve: DK_CURVE.ease },
  dayPill: { ms: 300, curve: DK_CURVE.ease },
  /** 27 — a jump to a message: by the distance (the reference took this one from Telegram's behaviour as read, not measured live) */
  jump: { minMs: 300, maxMs: 600 },
  /** 28 — a picture appears over its colour */
  imageIn: { ms: 300, curve: DK_CURVE.ease },
} as const;
