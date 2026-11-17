import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * scripts/scan-secrets.mjs, run as a real process over throw-away directories.
 *
 * Every secret below is assembled at run time ("AKIA" + "...") so this file
 * contains no contiguous credential: the repository scan runs over it too.
 */

vi.setConfig({ testTimeout: 30_000 });

const SCRIPT = resolve(__dirname, "../scripts/scan-secrets.mjs");

function scan(files: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "zaki-scan-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
    }
    // A scan that does not finish is a failure of its own, not a hung test run.
    const r = spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8", timeout: 20_000, killSignal: "SIGKILL" });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DEMO_PASSWORD = ["owner", "1234"].join("");
const REAL_LOOKING = "k3Jd9sLq0Zx8vB2nM5tR7yU1wE4pA6hG"; // 32 mixed characters, nothing fake about it

const vendorSecrets: Array<{ rule: string; value: string }> = [
  { rule: "Private key block", value: "-----BEGIN " + "RSA PRIVATE KEY-----" },
  { rule: "AWS access key id", value: "AKIA" + "QWERTYUIOPASDFGH" },
  { rule: "GitHub token", value: "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8" },
  { rule: "GitHub fine-grained token", value: "github_pat_" + "11ABCDEFG0aBcDeFgHiJkL_mNoPqRsTuVwXyZ0123456789abcd" },
  { rule: "Slack token", value: "xoxb-" + "123456789012-abcdefghijklmnop" },
  { rule: "Telegram bot token", value: "123456789:" + "AAH8x3Kq9Z0aBcDeFgHiJkLmNoPqRsTuVwX" },
  { rule: "Known demo password", value: DEMO_PASSWORD },
  // a JWT is three base64url parts: header and payload both start with eyJ (the base64 of `{"`)
  { rule: "JSON Web Token", value: ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJ1c2VyIiwiaWF0IjoxfQ", "c2lnbmF0dXJlLXZhbHVl"].join(".") },
  { rule: "Bearer token", value: "Authorization: Bearer " + REAL_LOOKING },
  // Laravel Sanctum shape (`<id>|<40 characters>`): what Coolify's API tokens look like
  { rule: "Coolify / Sanctum API token", value: "1|" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0" },
];

const PROSE_PASSWORD = "Gh7Kq9Zx2Lm4"; // twelve characters, letters and digits, nothing fake about it

describe("scan-secrets: what it catches", () => {
  it.each(vendorSecrets)("catches $rule, names file:line and never prints the value", ({ rule, value }) => {
    const r = scan({ "src/config.ts": `// line one\nconst thing = "${value}";\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`SECRET?? ${rule} at src/config.ts:2`);
    expect(r.stderr).not.toContain(value);
    expect(r.stdout).not.toContain(value);
  });

  it("catches vendor-shaped secrets in test files too (they run on every file)", () => {
    const r = scan({ "tests/aws.test.ts": `const key = "${"AKIA" + "QWERTYUIOPASDFGH"}";\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("AWS access key id at tests/aws.test.ts:1");
  });

  it("catches the known demo password in prose (README, docs)", () => {
    const r = scan({ "README.md": `# App\n\nLogin: someone@example.org / ${DEMO_PASSWORD}\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Known demo password at README.md:3");
  });

  it("catches a long generated value assigned to a secret-like name in source", () => {
    const r = scan({ "src/server/keys.ts": `export const authSecret = "${REAL_LOOKING}";\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("High-entropy secret assignment at src/server/keys.ts:1");
    expect(r.stderr).not.toContain(REAL_LOOKING);
  });

  it("catches a human-chosen password literal in source", () => {
    const r = scan({ "src/seed.ts": `const adminPassword = "Summer2026!x";\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Hard-coded secret literal at src/seed.ts:1");
  });

  it("catches a real value typed into .env.example (the file is scanned, not exempt)", () => {
    const r = scan({ ".env.example": `DATABASE_URL=""\nAUTH_SECRET=${REAL_LOOKING}\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unquoted secret assignment at .env.example:2");
    expect(r.stderr).not.toContain(REAL_LOOKING);
  });

  it("catches an unquoted secret in compose / yaml files", () => {
    const r = scan({ "deploy/stack.yml": `services:\n  db:\n    environment:\n      POSTGRES_PASSWORD: ${REAL_LOOKING}\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unquoted secret assignment at deploy/stack.yml:4");
  });

  it("catches a hard-coded fallback next to an environment read", () => {
    const r = scan({ "src/server/keys.ts": `export const authSecret = process.env.AUTH_SECRET ?? "${REAL_LOOKING}";\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Hard-coded fallback for a secret at src/server/keys.ts:1");
    expect(r.stderr).not.toContain(REAL_LOOKING);
  });

  it("catches a secret baked into a Dockerfile or a shell script", () => {
    const docker = scan({ Dockerfile: `FROM node:22\nENV SESSION_SECRET=${REAL_LOOKING}\nENV UPLOAD_DIR=/app/storage/uploads\n` });
    expect(docker.status).toBe(1);
    expect(docker.stderr).toContain("Unquoted secret assignment at Dockerfile:2");
    expect(docker.stderr).not.toContain("Dockerfile:3");
    const sh = scan({ "scripts/deploy.sh": `#!/bin/sh\nexport API_TOKEN=${REAL_LOOKING}\n` });
    expect(sh.status).toBe(1);
    expect(sh.stderr).toContain("Unquoted secret assignment at scripts/deploy.sh:2");
  });

  it("flags any committed .env file, whatever it holds", () => {
    const r = scan({ ".env": "FOO=bar\n" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Committed .env file at .env:1");
    const nested = scan({ "apps/web/.env.production": "FOO=bar\n" });
    expect(nested.status).toBe(1);
    expect(nested.stderr).toContain("Committed .env file at apps/web/.env.production:1");
  });

  it("catches a connection string that carries a real password to a remote host", () => {
    const url = "postgresql://app:" + "s3cr3tValue99" + "@pg.internal-company-hosting.net:5432/app";
    const r = scan({ "src/db.ts": `const url = "${url}";\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Connection string with credentials at src/db.ts:1");
    expect(r.stderr).not.toContain("s3cr3tValue99");
  });

  describe("a login and its password written as prose (the way the demo one reached the README)", () => {
    it.each([
      ["a plain pair", `login: a@b / ${PROSE_PASSWORD}`],
      ["backticks around both", `Demo login: \`someone@zaki.local\` / \`${PROSE_PASSWORD}\``],
      ["quotes", `Sign in as "admin@zaki.local" / "${PROSE_PASSWORD}" after the seed.`],
      ["a table row", `| a@b.co | ${PROSE_PASSWORD} |`],
      ["a bar instead of a slash", `credentials: a@b.co | ${PROSE_PASSWORD}`],
    ])("catches %s in a document, names file:line, never prints it", (_what, line) => {
      const r = scan({ "README.md": `# App\n\n${line}\n` });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Login and password in prose at README.md:3");
      expect(r.stderr).not.toContain(PROSE_PASSWORD);
      expect(r.stdout).not.toContain(PROSE_PASSWORD);
    });

    it("also in a .txt or .rst note", () => {
      expect(scan({ "NOTES.txt": `login: a@b / ${PROSE_PASSWORD}\n` }).status).toBe(1);
      expect(scan({ "docs/setup.rst": `login: a@b / ${PROSE_PASSWORD}\n` }).status).toBe(1);
    });
  });

  it("catches a Coolify token typed into a Markdown file, in a code block", () => {
    const token = "1|" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0";
    const r = scan({ "docs/deploy.md": "```sh\nCOOLIFY_TOKEN=" + token + "\n```\n" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Coolify / Sanctum API token at docs/deploy.md:2");
    expect(r.stderr).not.toContain(token);
  });

  it("catches an unquoted secret in a Markdown code block even when it is not a vendor shape", () => {
    const r = scan({ "docs/setup.md": `Run it like this:\n\n    export SESSION_SECRET=${REAL_LOOKING}\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Unquoted secret assignment at docs/setup.md:3");
  });

  it("catches a Basic authorization header", () => {
    const basic = "dXNlcjpwYXNzd29yZDEyMzQ1Njc4";
    const r = scan({ "docs/curl.md": `curl -H "Authorization: Basic ${basic}" https://api.company-hosting.net/\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Basic authorization header at docs/curl.md:1");
  });

  describe("variable names the first version did not know", () => {
    it.each([
      ["pass", `const pass = "${PROSE_PASSWORD}";`, "Hard-coded secret literal"],
      ["pwd", `const pwd = "${PROSE_PASSWORD}";`, "Hard-coded secret literal"],
      ["dbPass (camel case)", `const dbPass = "${PROSE_PASSWORD}";`, "Hard-coded secret literal"],
      ["DB_PASS", `const DB_PASS = "${PROSE_PASSWORD}";`, "Hard-coded secret literal"],
      ["adminPwd: in an object", `export const admin = { adminPwd: "${PROSE_PASSWORD}" };`, "Hard-coded secret literal"],
      ["secretKey", `export const secretKey = "${REAL_LOOKING}";`, "High-entropy secret assignment"],
      ["SECRET_KEY", `export const SECRET_KEY = "${REAL_LOOKING}";`, "High-entropy secret assignment"],
      ["a JSON key", `{ "secretKey": "${REAL_LOOKING}" }`, "High-entropy secret assignment"],
    ])("catches %s", (_what, line, rule) => {
      const r = scan({ "src/keys.ts": `${line}\n` });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`${rule} at src/keys.ts:1`);
      expect(r.stderr).not.toContain(PROSE_PASSWORD);
      expect(r.stderr).not.toContain(REAL_LOOKING);
    });

    it("catches DB_PASS=value and DB_PWD: value in env-like files", () => {
      expect(scan({ ".env.example": `DB_PASS=${PROSE_PASSWORD}\n` }).stderr).toContain("Unquoted secret assignment at .env.example:1");
      expect(scan({ "deploy/stack.yml": `    DB_PWD: ${PROSE_PASSWORD}\n` }).stderr).toContain("Unquoted secret assignment at deploy/stack.yml:1");
      expect(scan({ Dockerfile: `ENV DB_PASS=${PROSE_PASSWORD}\n` }).stderr).toContain("Unquoted secret assignment at Dockerfile:1");
    });
  });

  describe("a password inside a connection string, however short and whatever it is made of", () => {
    it.each([
      ["five letters, no digit", "root", "root"],
      ["a username used as the password", "admin", "admin"],
      ["seven characters with a digit", "app", "hunter2"],
      ["a long one without a digit", "app", "correcthorse"],
      ["three characters", "app", "abc"],
    ])("%s", (_what, user, password) => {
      const url = `postgres://${user}:` + password + "@pg.prod-hosting.net:5432/app";
      const r = scan({ "src/db.ts": `const url = "${url}";\n` });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Connection string with credentials at src/db.ts:1");
      expect(r.stdout).not.toContain(password);
    });
  });

  it("reads files with a UTF-8 byte-order mark and CRLF line endings", () => {
    const r = scan({ "src/win.ts": `﻿const a = 1;\r\nconst authSecret = "${REAL_LOOKING}";\r\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("src/win.ts:2");
  });

  it("scans lock files for vendor-shaped secrets but not for shape guesses", () => {
    const lock = scan({
      "package-lock.json": `{"integrity": "sha512-${"A1b2C3d4E5f6".repeat(8)}==", "password": "${REAL_LOOKING}"}\n`,
    });
    expect(lock.status).toBe(0);
    const leaked = scan({ "package-lock.json": `{"resolved": "https://x:${"ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"}@registry.example.org/a.tgz"}\n` });
    expect(leaked.status).toBe(1);
    expect(leaked.stderr).toContain("GitHub token at package-lock.json:1");
  });

  it("reports every file with a finding, one line each, and the total", () => {
    const r = scan({
      "a.ts": `const x = "${"AKIA" + "QWERTYUIOPASDFGH"}";\n`,
      "docs/b.md": `${DEMO_PASSWORD}\n`,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("a.ts:1");
    expect(r.stderr).toContain("docs/b.md:1");
    expect(r.stderr).toMatch(/2 potential secret\(s\) in 2 file\(s\)/);
  });
});

describe("scan-secrets: what it leaves alone", () => {
  it("passes a clean tree and says how many files it read", () => {
    const r = scan({
      "src/a.ts": "export const answer = 42;\n",
      "docs/readme.md": "Nothing to see here.\n",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Secret scan clean - 2 files");
    expect(r.stderr).toBe("");
  });

  it("passes a .env.example made of empty values and obvious placeholders", () => {
    const r = scan({
      ".env.example": [
        '# Zaki Workspace - copy to .env and fill in',
        'DATABASE_URL="postgresql://user:password@host:5432/database"',
        'AUTH_SECRET=""',
        'ENCRYPTION_KEY=',
        "SESSION_TTL_HOURS=168",
        'APP_URL="https://your-domain.com"',
        "# GOOGLE_CLIENT_SECRET=",
        'TELEGRAM_BOT_TOKEN="<paste the token from BotFather>"',
        "",
      ].join("\n"),
    });
    expect(r.status).toBe(0);
  });

  it("lets .env templates through whatever they are called, but not the real files", () => {
    expect(scan({ ".env.local.example": "FOO=bar\n", ".env.production.sample": "FOO=bar\n" }).status).toBe(0);
    expect(scan({ ".env.local": "FOO=bar\n" }).status).toBe(1);
  });

  it("does not take an error key or a translation key for a secret fallback", () => {
    const r = scan({
      "src/google.ts": [
        'const message = json?.error_description ?? json?.error ?? "google.token_failed";',
        'const secret = process.env.AUTH_SECRET ?? "";',
        'const tokenLabel = row.token ?? "settings.integrations.token_missing";',
        'const rule = { password: "password.min8", token: "auth.token_expired2" };',
        "",
      ].join("\n"),
    });
    expect(r.status).toBe(0);
  });

  it("passes code and config that READ secrets instead of defining them", () => {
    const r = scan({
      "src/env.ts": 'export const authSecret = process.env.AUTH_SECRET ?? "";\nconst k = process.env["ENCRYPTION_KEY"];\n',
      "docker-compose.yml": [
        "services:",
        "  db:",
        "    environment:",
        "      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-zaki_local}",
        "  app:",
        "    environment:",
        "      AUTH_SECRET: ${AUTH_SECRET:?set AUTH_SECRET in .env}",
        "      ENCRYPTION_KEY: ${ENCRYPTION_KEY:-}",
        "",
      ].join("\n"),
      "scripts/gen.sh": "AUTH_SECRET=$(openssl rand -hex 32)\n",
    });
    expect(r.status).toBe(0);
  });

  it("passes values that say they are fake, and local development URLs", () => {
    const r = scan({
      "src/seed.ts": [
        'const demoPassword = "test-password-123";',
        'const apiKey = "dummy-api-key-for-the-build";',
        'const token = "placeholder-token-value";',
        'const url = "postgresql://zaki:zaki_local@localhost:5433/postgres";',
        'const compose = "postgresql://zaki:zaki_local@db:5432/zaki_workspace";',
        "",
      ].join("\n"),
      ".github/workflows/ci.yml": ["env:", "  POSTGRES_PASSWORD: ci-test-password-not-used-anywhere", ""].join("\n"),
    });
    expect(r.status).toBe(0);
  });

  it("passes connection strings to documentation hosts (RFC 2606) and with placeholder passwords", () => {
    const r = scan({
      "docs/db.md": [
        "postgresql://app:" + "Sup3rSecret99" + "@db.internal.example.net:5432/app",
        "postgresql://u:p@10.0.0.5:5432/app",
        "postgresql://user:password@prod-db.company-hosting.net:5432/app",
        "",
      ].join("\n"),
    });
    expect(r.status).toBe(0);
  });

  it("passes bearer tokens that are templates, references or fixtures", () => {
    const r = scan({
      "src/api.ts": [
        "const header = `Bearer ${token}`;",
        'const other = "Bearer " + token;',
        'headers: { Authorization: "Bearer test-token-abcdefghijklmnop" },',
        'headers: { Authorization: "Bearer " + "x".repeat(40) },',
        "",
      ].join("\n"),
      "docs/curl.md": [
        'curl -H "Authorization: Bearer $TOKEN" https://x.company-hosting.net/',
        'curl -H "Authorization: Bearer <your token>" https://x.company-hosting.net/',
        'curl -H "Authorization: Bearer YOUR_TOKEN_HERE_1234567890abcdef" https://x.company-hosting.net/',
        "",
      ].join("\n"),
    });
    expect(r.status).toBe(0);
  });

  it("passes JWT-shaped values that say they are fake", () => {
    const fake = ["eyJ" + "xxxxxxxxxxxx", "eyJ" + "xxxxxxxxxxxx", "xxxx"].join(".");
    expect(scan({ "docs/jwt.md": `Example: ${fake}\n` }).status).toBe(0);
  });

  it("passes names that only END in the letters p-a-s-s, and values that are not secrets", () => {
    const r = scan({
      "src/names.ts": [
        'const bypass = "something123456";',
        'const compass = "abcdefg12345";',
        'const passport = "ABCD1234efgh5678";',
        'const pwd = "/app";',
        'const pass = "p";',
        'const pass2 = "x";',
        'const secretKeyName = "SESSION_SECRET";',
        "export const secretKey = process.env.SECRET_KEY ?? '';",
        "",
      ].join("\n"),
    });
    expect(r.status).toBe(0);
  });

  it("passes prose that names an address and a word, but no password", () => {
    const r = scan({
      "README.md": [
        "Contact: support@zaki.local / replies within a day.",
        "| Email | Password |",
        "login: a@b.co / hunter",
        "See a@b.co / README for details.",
        "login: a@b / test-password-123",
        "",
      ].join("\n"),
    });
    expect(r.status).toBe(0);
  });

  it("passes connection strings with placeholder passwords, and to this machine", () => {
    const r = scan({
      "docs/db.md": [
        "postgres://user:password@pg.prod-hosting.net:5432/app",
        "postgres://app:secret@pg.prod-hosting.net/app",
        "postgres://app:changeme@pg.prod-hosting.net/app",
        "postgres://app:<password>@pg.prod-hosting.net/app",
        "postgres://app:${DB_PASSWORD}@pg.prod-hosting.net/app",
        "postgres://root:root@localhost:5432/app",
        "postgres://app:hunter2@127.0.0.1/app",
        "postgres://app:hunter2@db:5432/app",
        "",
      ].join("\n"),
    });
    expect(r.status).toBe(0);
  });

  it("passes the AWS documentation's own sample key (it says EXAMPLE)", () => {
    const r = scan({ "docs/aws.md": `The docs use ${"AKIAIOSFODNN7" + "EXAMPLE"} as a sample.\n` });
    expect(r.status).toBe(0);
  });

  it("does not judge test files by shape guesses (hashes, fixture passwords)", () => {
    const r = scan({
      "tests/auth.test.ts": [
        'const secret = "test-secret-at-least-16-chars";',
        `const password = "Passw0rd-test";`,
        `const token = "${REAL_LOOKING}";`,
        "",
      ].join("\n"),
    });
    expect(r.status).toBe(0);
  });

  it("honours the scan-secrets:ignore marker on one line, and only on that line", () => {
    const r = scan({
      "src/a.ts": `export const sample = "${REAL_LOOKING}"; // scan-secrets:ignore\n`,
      "src/b.ts": `export const authSecret = "${REAL_LOOKING}";\n`,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("src/b.ts:1");
    expect(r.stderr).not.toContain("src/a.ts");
  });

  it("skips node_modules, .git and binary files when walking a directory", () => {
    const r = scan({
      "node_modules/pkg/index.js": `const authSecret = "${REAL_LOOKING}";\n`,
      ".git/config": `${DEMO_PASSWORD}\n`,
      "logo.png": `${DEMO_PASSWORD}\n`,
      "src/ok.ts": "export {};\n",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("1 files");
  });
});

describe("scan-secrets: a long line cannot stall the scan", () => {
  // The first version of the name rules had no anchor, so on one long run of letters and digits (a data URI
  // in a stylesheet, a minified bundle) every start position re-read the whole run: 50 KB took 8 seconds
  // and 200 KB did not finish. The scan is a gate in CI, so a committed blob must not be able to hang it.
  it.each([
    ["a 300 KB base64 run in a stylesheet", ".x{background:url(data:font/woff2;base64," + "aB3xK9".repeat(50_000) + ")}\n", "assets/font.css"],
    ["a 300 KB base64 run on its own line in a document", "aB3xK9".repeat(50_000) + "\n", "docs/blob.md"],
    ["a 400 KB run of letters and underscores", "a_".repeat(200_000) + "\n", "src/bundle.js"],
    ["a 560 KB minified line full of secret-looking names", "token=1;secret=2;password=3;pass=4;".repeat(16_000) + "\n", "src/min.js"],
    ["a 300 KB run that looks like the start of an address", "user.name+tag".repeat(25_000) + "\n", "docs/addresses.md"],
  ])("%s is read in seconds, not minutes", (_what, content, file) => {
    const started = Date.now();
    const r = scan({ [file]: content });
    expect(r.status, "the scan must finish (a timeout gives null)").toBe(0);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("still finds a secret on a long line that is not a blob (under the limit for shape guesses)", () => {
    const line = "x".repeat(1500) + ` const authSecret = "${REAL_LOOKING}";`;
    const r = scan({ "src/long.ts": `${line}\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("High-entropy secret assignment at src/long.ts:1");
  });

  it("a vendor-shaped secret is found even in a line far over that limit", () => {
    const line = "x".repeat(60_000) + " " + "AKIA" + "QWERTYUIOPASDFGH" + " " + "y".repeat(60_000);
    const r = scan({ "src/blob.js": `${line}\n` });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("AWS access key id at src/blob.js:1");
  });
});

describe("scan-secrets: inside the real repository", () => {
  it("runs over git's file list without crashing on a deleted-but-tracked file", () => {
    // No arguments = git ls-files. The exit code depends on the tree (CI is the judge);
    // what must hold here is that it terminates normally and reports in its own format.
    const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", cwd: resolve(__dirname, "..") });
    expect([0, 1]).toContain(r.status);
    expect(`${r.stdout}${r.stderr}`).toMatch(/Secret scan clean|potential secret/);
  });
});

describe("scan-secrets: a signing password written in a Gradle file (P0.6)", () => {
  const PASSWORD = "Qm4Zx8Lp2Vn6"; // twelve characters, nothing fake about it
  const gradle = (line: string) => `android {\n    signingConfigs {\n        zaki {\n            ${line}\n        }\n    }\n}\n`;

  it.each([
    ["Groovy, single quotes", `storePassword '${PASSWORD}'`],
    ["Groovy, double quotes", `keyPassword "${PASSWORD}"`],
    ["an assignment", `storePassword = "${PASSWORD}"`],
    ["a fallback next to an environment read", `keyPassword System.getenv("ANDROID_KEY_PASSWORD") ?: "${PASSWORD}"`],
  ])("catches %s, names file:line and never prints the value", (_what, line) => {
    const r = scan({ "android/app/build.gradle": gradle(line) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("SECRET?? Signing password in a Gradle file at android/app/build.gradle:4");
    expect(r.stderr).not.toContain(PASSWORD);
    expect(r.stdout).not.toContain(PASSWORD);
  });

  it("also in a Kotlin script", () => {
    const r = scan({ "android/app/build.gradle.kts": gradle(`storePassword = "${PASSWORD}"`) });
    expect(r.status).toBe(1);
  });

  it("lets the environment read through: the value is a secret of the repository, not a line of the file", () => {
    expect(scan({ "android/app/build.gradle": gradle(`storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")`) }).status).toBe(0);
    expect(scan({ "android/app/build.gradle": gradle(`keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: ""`) }).status).toBe(0);
  });

  it("the Android project of THIS repository passes: no signing password is written in it", () => {
    const real = resolve(__dirname, "../android");
    const r = spawnSync(process.execPath, [SCRIPT, real], { encoding: "utf8", timeout: 20_000 });
    expect(`${r.stdout}${r.stderr}`).toMatch(/Secret scan clean/);
    expect(r.status).toBe(0);
  });
});
