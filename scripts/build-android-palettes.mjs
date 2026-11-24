/**
 * Writes the Android app's Palettes.kt from the site's palettes (src/lib/themes/android.ts). Run it after changing a palette:
 *
 *   npx tsx scripts/build-android-palettes.mjs           write the file
 *   npx tsx scripts/build-android-palettes.mjs --check   write nothing; exit 1 if the file is stale
 *
 * UTF-8 without a byte-order mark, LF line endings. tests/android-palettes.test.ts fails while the committed file differs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ANDROID_PALETTES_FILE, renderAndroidPalettes } from "../src/lib/themes/android.ts";
import { AR } from "../src/lib/i18n/dict.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, ANDROID_PALETTES_FILE);
const source = renderAndroidPalettes(AR);

let current = null;
try {
  current = readFileSync(target, "utf8").replace(/\r\n/g, "\n");
} catch {
  current = null;
}

if (process.argv.includes("--check")) {
  if (current === source) {
    console.log(`${ANDROID_PALETTES_FILE} is up to date.`);
    process.exit(0);
  }
  console.error(`${ANDROID_PALETTES_FILE} is stale: run  npx tsx scripts/build-android-palettes.mjs`);
  process.exit(1);
}

if (current === source) {
  console.log(`${ANDROID_PALETTES_FILE} already up to date.`);
} else {
  writeFileSync(target, source, { encoding: "utf8" });
  console.log(`wrote ${ANDROID_PALETTES_FILE} (${Buffer.byteLength(source)} bytes)`);
}
