/**
 * The headers every response carries (security review D3).
 *
 * Nothing set them before: the app could be framed by any site (a fake sign-in laid over ours, or
 * «offboard this person» clicked under a finger), a browser guessed a type it was not told, and the
 * address of a page — ids, `?next=`, a registration token — travelled to every site a link led to.
 *
 * Deliberately NOT a full Content-Security-Policy: a strict one needs a nonce on every inline script
 * Next writes, and a wrong one blanks the app. These directives are the ones that cannot break it:
 *  - `frame-ancestors 'self'` (with X-Frame-Options SAMEORIGIN for older browsers): the file preview
 *    frames its OWN PDF, so 'self' — never 'none' — and no other site may frame us;
 *  - `base-uri 'self'`: an injected <base> cannot move every relative address to another site;
 *  - `form-action 'self'`: a form cannot post a password elsewhere.
 * Camera and microphone stay allowed for this site only: calls need them.
 * Geolocation is allowed for this site only too (the owner, 2026-11-27, «إرسال الموقع», src/lib/chat/location.ts): the browser still asks the person, and the
 * page asks the browser only when they tap «الموقع». A frame from another site gets nothing.
 */
export const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "SAMEORIGIN"],
  ["referrer-policy", "same-origin"],
  ["content-security-policy", "frame-ancestors 'self'; base-uri 'self'; form-action 'self'"],
  ["permissions-policy", "camera=(self), microphone=(self), display-capture=(self), geolocation=(self)"],
];

/** The headers above, plus HSTS only when the visitor is actually on https (it is ignored over http). */
export function securityHeaders(opts: { https: boolean }): Array<readonly [string, string]> {
  return opts.https ? [...SECURITY_HEADERS, ["strict-transport-security", "max-age=31536000"] as const] : [...SECURITY_HEADERS];
}
