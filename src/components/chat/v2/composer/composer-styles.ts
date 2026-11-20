/**
 * The look of the composer's buttons, in one place (Telegram's): a muted 24 px outline icon on a round target inside the pill, and the ONE round accent
 * button at the end of the row. Theme tokens only.
 */

/** A quiet icon button inside the pill: 44 px for a thumb, 40 px with a mouse. */
export const COMPOSER_ICON_BUTTON =
  "flex size-11 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 md:size-10";

/** The round accent button at the end of the row (the microphone ⇄ send; the record bar's send): 46 px. */
export const ROUND_BUTTON =
  "flex size-[46px] shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg shadow-card transition-colors hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50";
