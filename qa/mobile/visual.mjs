// THE MOBILE FREEZE: pictures of every phone screen at 360 / 390 / 430, compared pixel by pixel with the committed ones (qa/mobile-baseline/).
//   QA_PASSWORD=… node qa/mobile/visual.mjs check              fails on a single different pixel; the differences are drawn into qa/mobile/out/
//   QA_PASSWORD=… node qa/mobile/visual.mjs capture            writes the committed pictures again (only after the owner approved a phone change)
//   add --only 04,11 to take some screens
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { BASE, openBrowser } from "./driver.mjs";
import { BLOCKED, HEIGHT, LOOKS, SCREENS, THEME_COOKIE, WIDTHS } from "./screens.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.resolve(here, "../mobile-baseline");
const OUT = path.join(here, "out");

const mode = process.argv[2];
if (mode !== "check" && mode !== "capture") throw new Error("usage: node qa/mobile/visual.mjs check|capture [--only 01,04]");
const onlyAt = process.argv.indexOf("--only");
const only = onlyAt > 0 ? process.argv[onlyAt + 1].split(",") : null;
const screens = only ? SCREENS.filter((s) => only.some((o) => s.name.startsWith(o))) : SCREENS;

/** How many pixels differ between two pictures, and a picture that marks them in red over a faded copy of the first. */
export function compare(a, b) {
  const one = PNG.sync.read(a);
  const two = PNG.sync.read(b);
  if (one.width !== two.width || one.height !== two.height) return { pixels: one.width * one.height, diff: null };
  const diff = new PNG({ width: one.width, height: one.height });
  let pixels = 0;
  for (let i = 0; i < one.data.length; i += 4) {
    const same = one.data[i] === two.data[i] && one.data[i + 1] === two.data[i + 1] && one.data[i + 2] === two.data[i + 2] && one.data[i + 3] === two.data[i + 3];
    if (!same) pixels++;
    for (let c = 0; c < 3; c++) diff.data[i + c] = same ? 255 - Math.round((255 - one.data[i + c]) * 0.25) : [255, 0, 0][c];
    diff.data[i + 3] = 255;
  }
  return { pixels, diff: pixels ? PNG.sync.write(diff) : null };
}

if (mode === "check") rmSync(OUT, { recursive: true, force: true });
const browser = await openBrowser({ port: 9393 });
const failures = [];
let taken = 0;
try {
  await browser.size(390, HEIGHT, true);
  await browser.login();
  await browser.send("Network.setBlockedURLs", { urls: BLOCKED });
  for (const [look, theme, width] of Object.entries(LOOKS).flatMap(([l, th]) => WIDTHS.map((w) => [l, th, w]))) {
    await browser.size(width, HEIGHT, true);
    await browser.send("Network.setCookie", { name: THEME_COOKIE, value: theme, url: BASE, path: "/" });
    for (const screen of screens) {
      const name = `${look}/${width}/${screen.name}.png`;
      try {
        // every screen starts from the same empty memory of the device (drafts, folds, last folder)
        await browser.js("try{localStorage.clear();sessionStorage.clear()}catch(e){}");
        await screen.run(browser);
        const picture = await browser.settle();
        if (screen.after) await screen.after(browser);
        taken++;
        const target = path.join(BASELINE, name);
        if (mode === "capture") {
          mkdirSync(path.dirname(target), { recursive: true });
          writeFileSync(target, picture);
          continue;
        }
        if (!existsSync(target)) {
          failures.push(`${name}: no committed picture`);
          continue;
        }
        const { pixels, diff } = compare(readFileSync(target), picture);
        if (pixels) {
          failures.push(`${name}: ${pixels} different pixels`);
          mkdirSync(path.join(OUT, look, String(width)), { recursive: true });
          writeFileSync(path.join(OUT, name), picture);
          if (diff) writeFileSync(path.join(OUT, name.replace(".png", ".diff.png")), diff);
        }
      } catch (error) {
        failures.push(`${name}: ${error.message.slice(0, 200)}`);
      }
    }
    console.log(`${look} ${width}: done (${failures.length} problems so far)`);
  }
} finally {
  browser.close();
}
console.log(`${mode}: ${taken} pictures taken, ${failures.length} problems, ${browser.errors.length} page errors`);
for (const failure of failures) console.log("  " + failure);
process.exitCode = failures.length ? 1 : 0;
