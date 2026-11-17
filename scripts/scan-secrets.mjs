/**
 * A secret that reaches a commit is a secret that has to be changed.
 *
 * This repository is PUBLIC. A password written into a file here is not "in the
 * code" - it is published, and it stays published in the history after somebody
 * deletes the line. The demo owner login that sat in `lg.json`, in the README
 * and in `prisma/seed.ts` got out exactly that way: one literal, in a few files,
 * that nobody looked at again.
 *
 * So this runs in CI (`npm run scan:secrets`) and fails the build. It has no
 * dependencies and reads only files git knows about (tracked, plus new files
 * that are not ignored), so `.env`, `node_modules` and build output are never
 * read and no skip-list has to be kept up to date.
 *
 *   node scripts/scan-secrets.mjs              scan the repository (git ls-files)
 *   node scripts/scan-secrets.mjs <path>...    scan these files / directories instead
 *
 * Exit code: 0 clean, 1 at least one finding.
 *
 * A finding prints the RULE and the PLACE (`file:line`) and never the value:
 * the CI log is public too, and a secret printed there would live there forever.
 *
 * ── Rules, in three tiers ──
 *
 * 1. Shaped like a vendor credential (private key block, AWS key id, GitHub /
 *    Slack / Google / Telegram / OpenAI / Anthropic tokens, a connection string
 *    that carries its own password) or the known demo password. Nobody types
 *    those by accident, so they run on EVERY file, tests included.
 * 2. A committed `.env` file, whatever it holds.
 * 3. Shape guesses - "something named SECRET / TOKEN / PASSWORD / KEY holds a
 *    real-looking value". Good signal in source, config and docs; in tests they
 *    match hashes and fixtures, so they skip test files. What that costs, said
 *    plainly: a real password hidden in a test file under the name `password` is
 *    not caught here - tier 1 still catches every vendor-shaped credential there.
 *
 * ── Making a false positive go away ──
 *
 * Make the value look like what it is: the allow-list reads test, dummy, fake,
 * example, placeholder, changeme, not-used, xxxx, <NAMED>, ${VAR} and
 * process.env. If a line really must stay as it is, end it with the comment
 * `scan-secrets:ignore` - one line, reviewed in the pull request like any other.
 * `.env.example` is scanned like everything else: it passes because its values
 * are empty or obviously placeholders, and a real value typed into it fails.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The demo owner password that used to be published here. Assembled from two
 * halves so that this very file (and the hygiene test) never contain it
 * contiguously - the scan would otherwise report itself.
 */
const KNOWN_DEMO_PASSWORDS = [["owner", "1234"].join("")];

// ---------------------------------------------------------------- tier 1

/** Vendor-shaped values. A hit is a near-certainty wherever it is. */
const VENDOR_RULES = [
  { name: "Private key block", re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/ },
  { name: "AWS access key id", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "GitHub fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: "Slack token", re: /\bxox[abeoprs]-[A-Za-z0-9-]{10,}/ },
  { name: "Slack webhook URL", re: /hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]{16,}/ },
  { name: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI-style API key", re: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "Google OAuth client secret", re: /\bGOCSPX-[0-9A-Za-z_-]{20,}/ },
  { name: "Telegram bot token", re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/ },
  { name: "Stripe live key", re: /\b[sr]k_live_[0-9A-Za-z]{16,}/ },
  { name: "npm access token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  // three base64url parts; header and payload both start with eyJ (the base64 of `{"`)
  { name: "JSON Web Token", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/ },
  // Laravel Sanctum shape `<id>|<40 characters>`: what Coolify's API tokens look like.
  { name: "Coolify / Sanctum API token", re: /\b\d{1,4}\|[A-Za-z0-9]{36,}\b/ },
  // A header with its value written out. `value: true` = the captured value must not look fake either
  // (a template, a reference, a fixture): `Bearer ${token}` and `Bearer $TOKEN` never match at all.
  { name: "Bearer token", re: /\bBearer\s+([A-Za-z0-9._~+/=-]{20,})/, value: true },
  { name: "Basic authorization header", re: /\bAuthorization\s*[:=]\s*["'`]?Basic\s+([A-Za-z0-9+/=]{16,})/i, value: true },
];

/** A vendor-shaped token that says what it is (the AWS docs' own sample key ends in EXAMPLE). */
const OBVIOUSLY_FAKE_TOKEN = /example|fake|dummy|placeholder|sample|redacted|xxxx|0000/i;

const CONNECTION_STRING =
  /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?):\/\/([^\s:@/'"`<>]+):([^\s@/'"`<>]+)@(\[[^\]]+\]|[^\s/:'"`?#<>]+)/i;

/** The canonical placeholder credentials of a documentation URL: user:password@host. */
const PLACEHOLDER_CREDENTIAL = /^(?:pass(?:word|wd)?|pwd|secret|user(?:name)?|host(?:name)?|changeme|your[-_]?password)$/i;

/** Hosts where a password in a URL is a local-development default, not a leak. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0", "host.docker.internal", "db", "postgres", "redis"]);

// ---------------------------------------------------------------- tier 3

const SECRET_WORDS =
  "SECRET_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|AUTH_?KEY|ENCRYPTION_?KEY|SIGNING_?KEY|CREDENTIALS?";

/**
 * A name starts HERE: not in the middle of a longer run of letters, digits and underscores. Without
 * this anchor every start position inside one long run (a base64 data URI, a minified bundle) re-reads
 * the whole run - quadratic: 50 KB took 8 seconds and 200 KB never finished, in a CI gate.
 */
const NAME_START = "(?<![A-Za-z0-9_])";

/**
 * Shape guesses read lines up to this long. A longer line is a minified bundle or a data URI, not an
 * assignment somebody typed; the vendor-shaped rules (linear, anchored on a literal prefix) still read it.
 */
const MAX_SHAPE_LINE = 4000;

/**
 * `pass` and `pwd`, as a name. They need care the long words do not: `bypass`, `compass` and
 * `passport` are not passwords. So the name must START at pass/pwd (or follow a `_` or `-`, or sit
 * at the end of a camelCase name) - `pass`, `DB_PASS`, `db-pwd`, `dbPass`, `adminPwd`. Case
 * sensitive on purpose: the camelCase half depends on it, and so does telling `Pass` from `pass`.
 */
const PASS_NAME = String.raw`(?<![A-Za-z0-9])(?:[A-Za-z0-9]*[_-])?(?:pass|pwd|PASS|PWD)|(?<![A-Za-z0-9])[a-z][a-z0-9]*(?:Pass|Pwd)`;
const QUOTED_PASS = new RegExp(String.raw`(?:${PASS_NAME})["'\`]?\s*(?::|=>|=)\s*["'\`]([^"'\`\s]{8,})["'\`]`);
const UNQUOTED_PASS = new RegExp(
  String.raw`^\s*(?:-\s*|(?:ENV|ARG|export)\s+)?(?:${PASS_NAME})\s*[:=]\s*(?!["'\`$<#\s])([^\s#]{8,})\s*(?:#.*)?$`,
);

/**
 * A login and its password written as prose: `login: a@b / Gh7Kq9Zx2Lm4`, ``Demo: `a@b` / `Gh7...` ``,
 * `| a@b.co | Gh7... |`. This is how the demo password reached the README. The separator needs spaces
 * around a slash (so `user@host/path123` and git remotes are not it), and the second half may not
 * contain a slash or an `@` (so a list of addresses is not it).
 */
const PROSE_PAIR = /(?<![\w.+@-])[\w.+-]+@[\w.-]+[`'"]?(?:\s+\/\s+|\s*\|\s*)[`'"]?([^\s`'"|)\]/@,]{6,})/;

/**
 * `name = "value"` / `name: 'value'` / `"name": "value"` in source, config or docs,
 * where the NAME ends at a secret word - so `tokenUrl` and `SECRET_NAME` are not it.
 */
const QUOTED_ASSIGNMENT = new RegExp(
  `${NAME_START}[A-Za-z0-9_]*(?:${SECRET_WORDS})["'\`]?\\s*(?::|=>|=)\\s*["'\`]([^"'\`\\s]{8,})["'\`]`,
  "i",
);

/**
 * `process.env.X ?? "value"` / `process.env.X || "value"` - the line READS the environment,
 * but a hard-coded fallback beside it is a secret in the repository all the same.
 */
const FALLBACK_LITERAL = new RegExp(
  `${NAME_START}[A-Za-z0-9_]*(?:${SECRET_WORDS})["'\`]?\\s*(?::|=)[^\\n]*?(?:\\?\\?|\\|\\|)\\s*["'\`]([^"'\`\\s]{8,})["'\`]`,
  "i",
);

/**
 * `NAME=value` / `NAME: value` with no quotes - the grammar of .env, ini, yaml and compose
 * files, and of `ENV NAME=value` / `ARG NAME=value` in a Dockerfile and `export NAME=value`.
 */
const UNQUOTED_ASSIGNMENT = new RegExp(
  `^\\s*(?:-\\s*|(?:ENV|ARG|export)\\s+)?[A-Za-z0-9_]*(?:${SECRET_WORDS})\\s*[:=]\\s*(?!["'\`$<#\\s])([^\\s#]{8,})\\s*(?:#.*)?$`,
  "i",
);

/** The line READS a secret (or says how to make one); it does not define one. */
const LINE_READS_SECRET = /process\.env|import\.meta\.env|\$\{[A-Za-z_]|\$\([A-Za-z_]|\$[A-Z_]{3,}\b|\bopenssl rand\b|\bos\.environ\b|\bgetenv\b|secrets\.[A-Z_]+|\{\{\s*[\w.]+\s*\}\}/;

/** A value that says it is not real. */
const FAKE_VALUE =
  /(^|[^a-z])(test|dummy|fake|sample|example|demo|mock)([^a-z]|$)|placeholder|changeme|change-me|change_me|replace[-_ ]?me|your[-_ ]|redacted|not[-_]?(used|real|secret)|insecure|xxxx|0000|todo|<[^>]*>|\*{3,}|^\.{3}$/i;

/** Where `NAME=value` and `NAME: value` are the file's own grammar. */
const IS_ENV_LIKE =
  /(^|\/)\.env(\.[^/]*)?$|\.(env|ini|conf|cfg|properties|toml|sh|ya?ml)$|(^|\/)(docker-)?compose[^/]*\.ya?ml$|(^|\/)Dockerfile[^/]*$/i;
const IS_TEST = /(^|\/)(tests?|__tests__|fixtures?)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
/** Where prose lives, and credentials get written as sentences. */
const IS_DOC = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
/** `.env`, `.env.production`, `.env.local` ... but not `.env.example` / `.env.local.sample` and friends. */
const IS_ENV_FILE = /(^|\/)\.env(\.[^/]+)?$/i;
const IS_ENV_TEMPLATE = /\.(example|sample|template|dist)$/i;

/** Lock files are full of integrity hashes: read them for vendor-shaped secrets only, never for shape guesses. */
const IS_LOCKFILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|[^/]+\.lock)$/i;

const SKIP_EXT = /\.(png|jpe?g|gif|ico|webp|avif|svg|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|bz2|7z|mp[34]|mov|webm|wasm|map|tsbuildinfo)$/i;
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".turbo", ".data", "storage"]);
const MAX_BYTES = 2 * 1024 * 1024;

// ---------------------------------------------------------------- helpers

function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** True when the value is plainly a placeholder, a template or a reference. */
function looksFake(value) {
  if (!value) return true;
  if (FAKE_VALUE.test(value)) return true;
  if (/^(.)\1+$/.test(value)) return true; // aaaaaaaa
  if (/^(?:0123456789|1234567890|abcdefghijklmnopqrstuvwxyz)/i.test(value)) return true;
  if (/^[A-Z][A-Z0-9_]{4,}$/.test(value)) return true; // an ENV_VAR_NAME, not its value
  if (/^[a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+$/.test(value)) return true; // a translation / error / event key: password.min8, auth.required
  if (/^https?:\/\//i.test(value)) return true; // a URL is not a credential literal
  if (/^[./~]/.test(value) || /[\\/]\w+\.\w+$/.test(value)) return true; // a path
  if (/\$\{|\$\(|\{\{|%\(|<%/.test(value)) return true; // interpolation
  return false;
}

/** A long value with the texture of a generated key (hex, base64, base64url). */
function looksGenerated(value) {
  if (value.length < 20) return false;
  if (/^[0-9a-f]{32,}$/i.test(value)) return true;
  if (!/^[A-Za-z0-9+/_=.~-]+$/.test(value)) return false;
  return /[A-Za-z]/.test(value) && /\d/.test(value) && entropy(value) >= 3.2;
}

/** A human-chosen secret: eight or more characters, letters AND digits, no spaces. */
function looksLikePassword(value) {
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value) && !/\s/.test(value);
}

/**
 * A host that is this machine, or that cannot be a real server: RFC 2606 reserves
 * example.com / .net / .org and the .example, .test and .invalid names for documentation.
 */
function isLocalHostName(host) {
  const h = host.toLowerCase();
  return (
    LOCAL_HOSTS.has(h) ||
    /\.(localhost|local|test|invalid|example)$/.test(h) ||
    /(^|\.)example\.(com|net|org)$/.test(h)
  );
}

// ---------------------------------------------------------------- scanning

/**
 * A signing password written into a Gradle file (`storePassword 'x'`, `keyPassword = "x"`, or a literal after `?:`).
 * The key's password is a secret of the repository (the workflow passes it from the environment), never a line of the file,
 * so ANY non-empty literal is a finding, however harmless it looks: the generic rules miss it because the word the
 * password is made of reads like a placeholder. An environment read (`System.getenv("NAME")`) is the right shape and passes.
 */
const IS_GRADLE = /\.gradle(?:\.kts)?$/i;
const GRADLE_SIGNING_LITERAL = /(?:store|key)Password\b(?:\s*[=(]?\s*|[^\n]*\?:\s*)(['"])([^'"\r\n]+)\1/i;

/**
 * Scan one file's text. Returns `[{ rule, line }]` - never the matched value.
 * `file` is a repository-relative path with forward slashes.
 */
export function scanText(text, file) {
  const findings = [];
  const unix = file.replace(/\\/g, "/");

  if (IS_ENV_FILE.test(unix) && !IS_ENV_TEMPLATE.test(unix)) {
    findings.push({ rule: "Committed .env file", line: 1 });
  }

  // Shape guesses are noise in tests and lock files; the vendor-shaped rules still run there.
  const shapeGuesses = !IS_TEST.test(unix) && !IS_LOCKFILE.test(unix);
  const isEnvLike = IS_ENV_LIKE.test(unix);
  const isDoc = IS_DOC.test(unix);
  const isGradle = IS_GRADLE.test(unix);
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line.includes("scan-secrets:ignore")) continue;
    const hit = (isGradle && GRADLE_SIGNING_LITERAL.test(line) ? "Signing password in a Gradle file" : null) ?? scanLine(line, { shapeGuesses, isEnvLike, isDoc });
    if (hit) findings.push({ rule: hit, line: i + 1 });
  }
  return findings;
}

function scanLine(line, { shapeGuesses, isEnvLike, isDoc }) {
  // Tier 1 - the demo password, wherever it is.
  for (const pw of KNOWN_DEMO_PASSWORDS) {
    if (line.includes(pw)) return "Known demo password";
  }

  // Tier 1 - vendor-shaped values.
  for (const rule of VENDOR_RULES) {
    const m = rule.re.exec(line);
    if (!m || OBVIOUSLY_FAKE_TOKEN.test(m[0])) continue;
    if (rule.value && looksFake(m[1] ?? "")) continue;
    return rule.name;
  }

  // Tier 1 - a connection string that carries its own password.
  const cs = CONNECTION_STRING.exec(line);
  if (cs) {
    const [, , password, host] = cs;
    if (
      password &&
      password.length >= 3 && // `u:p@host` is a placeholder; `root:root@host` and `app:abc@host` are credentials
      host &&
      !isLocalHostName(host) &&
      !looksFake(password) &&
      !PLACEHOLDER_CREDENTIAL.test(password) &&
      !LINE_READS_SECRET.test(cs[0])
    ) {
      return "Connection string with credentials";
    }
  }

  // Tier 3 - shape guesses. Not in tests.
  if (!shapeGuesses || line.length > MAX_SHAPE_LINE) return null;

  // A login and its password written as a sentence, in a document.
  if (isDoc) {
    const pair = PROSE_PAIR.exec(line);
    const token = pair?.[1];
    if (token && !looksFake(token) && !PLACEHOLDER_CREDENTIAL.test(token) && (looksLikePassword(token) || looksGenerated(token))) {
      return "Login and password in prose";
    }
  }

  // A hard-coded fallback next to an environment read: `process.env.X ?? "value"`.
  const fallback = FALLBACK_LITERAL.exec(line);
  if (fallback) {
    const value = fallback[1];
    if (value && !looksFake(value) && (looksGenerated(value) || looksLikePassword(value))) {
      return "Hard-coded fallback for a secret";
    }
  }

  // Not on lines that merely read a secret.
  if (LINE_READS_SECRET.test(line)) return null;

  for (const re of [QUOTED_ASSIGNMENT, QUOTED_PASS]) {
    const value = re.exec(line)?.[1];
    if (value && !looksFake(value) && !PLACEHOLDER_CREDENTIAL.test(value)) {
      if (looksGenerated(value)) return "High-entropy secret assignment";
      if (looksLikePassword(value)) return "Hard-coded secret literal";
    }
  }

  // `NAME=value` and `NAME: value` are the grammar of env-like files. In a document they are the
  // grammar of a code block - where a real value typed in to show how it works is the likeliest accident.
  if (isEnvLike || isDoc) {
    for (const re of [UNQUOTED_ASSIGNMENT, UNQUOTED_PASS]) {
      const value = re.exec(line)?.[1];
      if (!value || looksFake(value) || PLACEHOLDER_CREDENTIAL.test(value)) continue;
      // A long unexplained word in a config file is suspect; in prose it is just a word.
      if (looksGenerated(value) || looksLikePassword(value) || (isEnvLike && value.length >= 12)) {
        return "Unquoted secret assignment";
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- collecting files

function gitFiles(cwd) {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return [...new Set(out.split("\0").filter(Boolean))].map((f) => ({ path: f, abs: resolve(cwd, f) }));
}

function walk(dir, root, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), root, out);
    } else if (entry.isFile()) {
      const abs = join(dir, entry.name);
      out.push({ path: relative(root, abs).replace(/\\/g, "/"), abs });
    }
  }
}

/** Explicit arguments: files are taken as they are, directories are walked. */
function argFiles(args, cwd) {
  const out = [];
  for (const arg of args) {
    const abs = resolve(cwd, arg);
    let st;
    try {
      st = statSync(abs);
    } catch {
      console.error(`scan-secrets: cannot read ${arg}`);
      process.exitCode = 1;
      continue;
    }
    if (st.isDirectory()) walk(abs, abs, out);
    else out.push({ path: relative(cwd, abs).replace(/\\/g, "/") || basename(abs), abs });
  }
  return out;
}

function shouldRead({ path }) {
  return !SKIP_EXT.test(path);
}

export function scanFiles(files) {
  const results = [];
  let scanned = 0;
  for (const file of files.filter(shouldRead)) {
    let buf;
    try {
      if (statSync(file.abs).size > MAX_BYTES) continue;
      buf = readFileSync(file.abs);
    } catch {
      continue; // listed by git but gone from the working tree
    }
    if (buf.includes(0)) continue; // binary
    scanned += 1;
    // A UTF-8 BOM would otherwise glue itself to the first line's first token.
    const text = buf.toString("utf8").replace(/^﻿/, "");
    for (const f of scanText(text, file.path)) results.push({ file: file.path, ...f });
  }
  return { results, scanned };
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    console.log("usage: node scripts/scan-secrets.mjs [file-or-directory ...]\nWith no arguments, scans every file git tracks (plus new, non-ignored files).");
    return;
  }
  const cwd = process.cwd();
  let files;
  if (args.length > 0) {
    files = argFiles(args, cwd);
  } else {
    try {
      files = gitFiles(cwd);
    } catch {
      console.error("scan-secrets: not a git repository - scanning the working directory instead.");
      files = [];
      walk(cwd, cwd, files);
    }
  }

  const { results, scanned } = scanFiles(files);
  for (const r of results) {
    // The place, never the value: the CI log is public and permanent.
    console.error(`SECRET?? ${r.rule} at ${r.file}:${r.line}`);
  }
  if (results.length > 0) {
    console.error(
      `\n${results.length} potential secret(s) in ${new Set(results.map((r) => r.file)).size} file(s).\n` +
        "If it is real: change it at the provider first - deleting the line does not remove it from the\n" +
        "git history. If it is fake: make it look fake (test, dummy, example, placeholder, <NAMED>,\n" +
        "${VAR}, process.env), or end that one line with the comment  scan-secrets:ignore\n",
    );
    process.exitCode = 1;
    return;
  }
  if (process.exitCode !== 1) console.log(`Secret scan clean - ${scanned} files.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
