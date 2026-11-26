/**
 * Writes the Android app's copies of the site's words (src/lib/android-strings.ts `ANDROID_STRINGS`). Run it after changing one of those
 * dictionary fragments:
 *
 *   npx tsx scripts/build-android-strings.mjs           write the files
 *   npx tsx scripts/build-android-strings.mjs --check   write nothing; exit 1 if a file is stale
 *
 * UTF-8 without a byte-order mark, LF line endings. tests/android-strings.test.ts fails while a committed file differs.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ANDROID_STRINGS, renderAndroidStrings } from "../src/lib/android-strings.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
let stale = 0;
for (const file of ANDROID_STRINGS) {
  const words = JSON.parse(readFileSync(path.join(root, "src/lib/i18n", file.source), "utf8"));
  const text = renderAndroidStrings(file, words);
  const target = path.join(root, file.target);
  const now = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (now === text) continue;
  stale++;
  if (check) console.error(`stale: ${file.target}`);
  else writeFileSync(target, text, "utf8");
}
if (check && stale) process.exit(1);
