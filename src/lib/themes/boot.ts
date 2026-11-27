import { DEVICE_PREFS_KEY } from "@/lib/device-prefs";
import { FONT_SCALES } from "@/lib/chat/prefs";
import { themeColorOf } from "@/lib/themes/palettes";
import { THEME_COOKIE, isDarkTheme, systemTheme, type ThemeKey } from "@/lib/themes/registry";

/**
 * C4.1 — «تلقائي حسب الجهاز» and the text size, applied BEFORE the first paint.
 *
 * The server paints the theme from the cookie (`zaki_theme`) and cannot know whether the device is light or dark. This one small script, the first thing in the
 * body, finishes the job in the browser with `prefers-color-scheme` through `systemTheme()` (D1):
 *
 *   - the cookie says `system` (the person chose «تلقائي حسب الجهاز» in «إعداداتي»), or
 *   - there is NO cookie (they never chose a theme on this device) and either their account says «تلقائي» or the company's switch `themeV2Default` is ON
 *     (both are read from the copy of their choices this device keeps in `zk-device-prefs`, written by the settings screen and the chat shell).
 *
 * With the switch OFF a person who never chose is left on «ليل» exactly as before (`DEFAULT_THEME` does not change); the pair the device chooses from is the old
 * one («ليل» / «نهار») unless the switch is ON, when it is the flat pair («ليل أزرق» / «سماء»). A concrete cookie (a theme the person picked) always wins. The
 * script follows the device live (`change` of the media query) and is also exposed as `window.__zkThemeBoot()` so the settings screen can re-run it at once.
 *
 * It also sets `--chat-font-scale` from the text size (the device's own override, else the person's) so a chosen size is right on the first paint, and
 * `data-fx-off` from «التأثيرات الحركية», so an effect switched off never plays once before the page is awake.
 * Everything is in try/catch: a browser that refuses any of it simply keeps what the server painted.
 */
export const BOOT_GLOBAL = "__zkThemeBoot";

interface Pick {
  key: ThemeKey;
  dark: boolean;
  color: string;
}
const pick = (opts: { dark: boolean; v2: boolean }): Pick => {
  const key = systemTheme(opts);
  return { key, dark: isDarkTheme(key), color: themeColorOf(key) };
};

/** The data the script needs, computed from the registry so the script never holds a second copy of the pairs. */
export function bootData() {
  return {
    cookie: THEME_COOKIE,
    prefs: DEVICE_PREFS_KEY,
    scales: [...FONT_SCALES],
    v1: { dark: pick({ dark: true, v2: false }), light: pick({ dark: false, v2: false }) },
    v2: { dark: pick({ dark: true, v2: true }), light: pick({ dark: false, v2: true }) },
  };
}

export function bootScript(): string {
  const data = JSON.stringify(bootData());
  return `(function(){try{var D=${data};var d=document,h=d.documentElement;
function prefs(){try{return JSON.parse(localStorage.getItem(D.prefs)||"null")||{}}catch(e){return {}}}
function cookie(){var m=d.cookie.match(new RegExp("(?:^|; )"+D.cookie+"=([^;]*)"));return m?m[1]:null}
function boot(){try{
var p=prefs(),m=p.mirror||{},c=cookie(),v2=m.themeV2===true;
var step=typeof p.textSize==="number"?p.textSize:m.fontStep;
if(typeof step==="number"&&D.scales[step]){h.style.setProperty("--chat-font-scale",String(D.scales[step]))}else{h.style.removeProperty("--chat-font-scale")}
if(typeof m.fontPx==="number"&&m.fontPx>=12&&m.fontPx<=30){h.style.setProperty("--tg-font-px",m.fontPx+"px")}
if(typeof m.bubbleRadius==="number"&&m.bubbleRadius>=0&&m.bubbleRadius<=17){h.style.setProperty("--tg-bubble-radius",m.bubbleRadius+"px")}
if(m.wallpaper){h.setAttribute("data-chat-wallpaper-chosen","")}
var off=p.effectsOff;if(off&&off.length&&off.join){h.setAttribute("data-fx-off",off.join(" "))}
if(c==="system"||(c===null&&(m.themeAuto===true||v2))){
var dark=!!(window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches);
var t=(v2?D.v2:D.v1)[dark?"dark":"light"];
h.setAttribute("data-theme",t.key);h.classList.toggle("dark",t.dark);
var meta=d.querySelector('meta[name="theme-color"]');if(meta)meta.setAttribute("content",t.color)}
}catch(e){}}
window.${BOOT_GLOBAL}=boot;boot();
try{if(window.matchMedia){var q=matchMedia("(prefers-color-scheme: dark)");if(q.addEventListener)q.addEventListener("change",boot)}}catch(e){}
}catch(e){}})();`;
}
