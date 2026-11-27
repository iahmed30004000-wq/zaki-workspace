// A small driver for the mobile picture test: a hidden Chromium (Edge or Chrome) with its own throwaway profile, spoken to over the DevTools protocol.
// No new dependency: Node's own WebSocket and fetch. It only ever opens the LOCAL server (guardLocal).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const BASE = process.env.QA_BASE_URL ?? "http://localhost:3105";
/** The moment the browser believes it is. The seed's own times are weeks before it, so every date label reads the same on any day. */
export const QA_NOW = Date.parse("2026-03-02T09:00:00Z");
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function guardLocal() {
  const host = new URL(BASE).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") throw new Error(`the mobile picture test runs against a local server only, not ${host}`);
}

function browserPath() {
  const candidates = [
    process.env.QA_BROWSER,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("no Chromium found: set QA_BROWSER to its path");
  return found;
}

// The page's clock starts at QA_NOW and then runs, so timers and the query cache behave while every «today» is the same day.
const CLOCK = `(() => {
  const Real = Date, offset = ${QA_NOW} - Real.now();
  class QaDate extends Real {
    constructor(...args) { if (args.length === 0) super(Real.now() + offset); else super(...args); }
    static now() { return Real.now() + offset; }
  }
  window.Date = QaDate;
})();`;

// Nothing may move or blink while a picture is taken.
const STILL = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}::-webkit-scrollbar{display:none!important}`;

export async function openBrowser({ port = 9391 } = {}) {
  guardLocal();
  const profile = mkdtempSync(path.join(tmpdir(), "zaki-qa-"));
  const child = spawn(browserPath(), ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-extensions", "--force-color-profile=srgb", "--font-render-hinting=none", "--disable-gpu", "--hide-scrollbars", "--lang=ar", "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    } catch {
      /* not up yet */
    }
  }
  if (!target) throw new Error("the browser did not start");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let serial = 0;
  const waiting = new Map();
  const errors = [];
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && waiting.has(data.id)) {
      waiting.get(data.id)(data);
      waiting.delete(data.id);
    } else if (data.method === "Runtime.exceptionThrown") {
      errors.push(data.params.exceptionDetails.exception?.description?.slice(0, 300));
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      waiting.set(id, (data) => (data.error ? reject(new Error(`${method}: ${data.error.message}`)) : resolve(data.result)));
      socket.send(JSON.stringify({ id, method, params }));
    });
  const js = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ""}`);
    return result.result.value;
  };
  const until = async (expression, ms = 60_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        if (await js(expression)) return true;
      } catch {
        /* the page is changing */
      }
      await sleep(250);
    }
    throw new Error(`waited too long for: ${expression}`);
  };
  const size = async (width, height, mobile) => {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    await send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  };
  /** Pictures, fonts and requests are done, and two looks at the page in a row are the same. */
  const settle = async () => {
    await until(`document.readyState === 'complete' && [...document.images].every((i) => i.complete)`);
    await js(`document.fonts.ready.then(() => true)`);
    await until(`!document.querySelector('[data-qa-busy], .animate-pulse, .animate-spin')`, 20_000).catch(() => undefined);
    let last = "";
    for (let i = 0; i < 20; i++) {
      await sleep(450);
      const now = (await send("Page.captureScreenshot", { format: "png" })).data;
      if (now === last) return Buffer.from(now, "base64");
      last = now;
    }
    return Buffer.from(last, "base64");
  };
  const go = async (url, ready = "true") => {
    await send("Page.navigate", { url: BASE + url });
    await sleep(600);
    await until(`document.readyState === 'complete' && (${ready})`, 90_000);
    await sleep(900);
  };
  const api = (url, method = "GET", body) =>
    js(`fetch(${JSON.stringify(url)},{method:${JSON.stringify(method)},credentials:'same-origin',headers:{'content-type':'application/json'},body:${body ? JSON.stringify(JSON.stringify(body)) : "undefined"}}).then(async r=>({status:r.status, json: await r.json().catch(()=>null)}))`);
  /** Signs in with the LOCAL seed's own test account (its password comes from QA_PASSWORD, never from this file). */
  const login = async () => {
    const password = process.env.QA_PASSWORD;
    if (!password) throw new Error("set QA_PASSWORD to the local seed's test password");
    await go("/login", `!!document.querySelector('input[type=password]') || location.pathname !== '/login'`);
    if ((await js("location.pathname")) !== "/login") return;
    await sleep(2500);
    await js(`(()=>{const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}))};const i=document.querySelectorAll('input');set(i[0],'owner');set(i[1],${JSON.stringify(password)});document.querySelector('button[type=submit]').click();return true})()`);
    await until(`location.pathname !== '/login'`);
    await sleep(2000);
  };
  const close = () => {
    try {
      socket.close();
    } catch {
      /* already closed */
    }
    child.kill();
    setTimeout(() => {
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* the browser may still hold a file; the system's temp folder is cleared anyway */
      }
    }, 1500);
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setBypassServiceWorker", { bypass: true });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "prefers-color-scheme", value: "light" }] });
  await send("Emulation.setTimezoneOverride", { timezoneId: "Asia/Damascus" });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: CLOCK });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.id='qa-still';s.textContent=${JSON.stringify(STILL)};document.head.appendChild(s)})` });
  return { send, js, until, size, settle, go, api, login, close, errors };
}
