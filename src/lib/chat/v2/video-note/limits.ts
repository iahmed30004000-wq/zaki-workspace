/** «رسالة فيديو دائرية» — the numbers the server and the screen both know. Pure. */
export const VIDEO_NOTE_MAX_MS = 60_000;
/** a recorder's clock rounds up: a take this much over the cap is still taken (and written as the cap) */
export const VIDEO_NOTE_SLACK_MS = 1000;
/** a minute at the bitrate the recorder asks for is under 10 MB; this is the chat's plain-file ceiling */
export const VIDEO_NOTE_MAX_BYTES = 25 * 1024 * 1024;
/** shorter than this was a slip of the finger, not a message (the voice recorder's rule) */
export const VIDEO_NOTE_MIN_MS = 500;
/** the circle in a bubble, across */
export const VIDEO_NOTE_PX = 224;
