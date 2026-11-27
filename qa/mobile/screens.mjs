// The mobile screens that are frozen. Each one: how to reach it from a fresh load. Nothing here sends or saves anything.
import { sleep } from "./driver.mjs";

/** Fixed ids the seed gives its made-up space and conversations (zod's cuid() accepts them). */
export const IDS = {
  space: "cqamobilespace0000000001",
  topicDesign: "cqamobiletopic0000000001",
  topicConfirm: "cqamobiletopic0000000002",
  topicClips: "cqamobiletopic0000000003",
  dmSalma: "cqamobiledm0000000000001",
  dmMohammad: "cqamobiledm0000000000002",
  saved: "cqamobilesaved0000000001",
};

export const WIDTHS = [360, 390, 430];
export const HEIGHT = 844;
/** The phone's two looks, by the cookie the app reads its theme from. */
export const THEME_COOKIE = "zaki_theme";
export const LOOKS = { dark: "tg-night", light: "tg-day" };

/** Opening a screen must not change what the next picture shows: reading, delivery, presence and the live line are held back. */
export const BLOCKED = ["*/api/chat/conversations/*/read", "*/api/chat/conversations/*/delivered", "*/api/presence*", "*/api/realtime*", "*/api/client-errors*"];

const centreOf = (selector) => `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();return [Math.round(r.left+r.width/2),Math.round(r.top+r.height/2)]})()`;

/** A real finger on the middle of the first element the selector names. */
async function tap(page, selector, holdMs = 70) {
  const at = await page.js(centreOf(selector));
  if (!at) throw new Error(`nothing to tap: ${selector}`);
  await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at[0], y: at[1] }] });
  await sleep(holdMs);
  await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(700);
}

/** Clicks the first visible element that matches and, when words are given, carries one of them (its text or its label). */
async function press(page, selector, words) {
  const done = await page.js(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.getClientRects().length&&(${JSON.stringify(words ?? null)}===null||${JSON.stringify(words ?? [])}.some(w=>((b.innerText||'')+' '+(b.getAttribute('aria-label')||'')).includes(w))));if(!el)return false;el.click();return true})()`);
  if (!done) throw new Error(`nothing to press: ${selector} ${words ? words.join("/") : ""}`);
  await sleep(700);
}

const has = (selector) => `!!document.querySelector(${JSON.stringify(selector)})`;
const LIST = has("[data-chat-phone-bar]");
const CHAT = `${has("[data-composer-row]")} && ${has("[data-message-id]")}`;

async function openChat(page, id) {
  await page.go(`/chat/${id}`, CHAT);
}

const type = (page, selector, text) =>
  page.js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;el.focus();Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(text)});el.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);

export const SCREENS = [
  { name: "01-chat-list", run: (p) => p.go("/chat", LIST) },
  {
    name: "02-chat-list-folder",
    run: async (p) => {
      await p.go("/chat", LIST);
      await p.js(`(()=>{const tabs=[...document.querySelectorAll('[data-folder]')].filter(t=>t.getClientRects().length);if(tabs[1])tabs[1].click();return tabs.length})()`);
      await sleep(900);
    },
  },
  {
    name: "03-chat-search",
    run: async (p) => {
      await p.go("/chat", LIST);
      await press(p, "[data-tg-search-pill]");
      await p.until(has("[data-chat-phone-search=open] input"), 15_000);
      await sleep(1500);
    },
  },
  {
    name: "03b-chat-search-results",
    run: async (p) => {
      await p.go("/chat", LIST);
      await press(p, "[data-tg-search-pill]");
      await p.until(has("[data-chat-phone-search=open] input"), 15_000);
      await type(p, "[data-chat-phone-search=open] input", "التصميم");
      await p.until(has("[data-list-search-panel]"), 20_000);
      await sleep(2500);
    },
  },
  { name: "04-private-chat", run: (p) => openChat(p, IDS.dmSalma) },
  {
    name: "05-composer-typing",
    run: async (p) => {
      await openChat(p, IDS.dmSalma);
      await type(p, "[data-composer-row] textarea", "رح أكون هناك قبل الموعد");
      await sleep(900);
    },
    after: async (p) => {
      await type(p, "[data-composer-row] textarea", "");
      await sleep(900);
    },
  },
  {
    name: "06-message-menu",
    run: async (p) => {
      await openChat(p, IDS.dmSalma);
      await tap(p, "[data-message-id]:last-of-type [data-bubble-footer]");
      await sleep(900);
    },
  },
  {
    name: "06b-reply-bar",
    run: async (p) => {
      await openChat(p, IDS.dmSalma);
      await tap(p, "[data-message-id]:last-of-type [data-bubble-footer]");
      await sleep(900);
      await press(p, "button, [role=menuitem]", ["رد"]);
      await p.until(has("[data-reply-bar]"), 15_000);
      await sleep(900);
    },
  },
  {
    name: "07-emoji-panel",
    run: async (p) => {
      await openChat(p, IDS.dmSalma);
      await press(p, "[data-emoji-toggle]");
      await sleep(1500);
    },
  },
  {
    name: "08-attach-sheet",
    run: async (p) => {
      await openChat(p, IDS.dmSalma);
      await press(p, "[data-composer-row] button", ["أرفق", "إرفاق", "مرفق"]);
      await p.until(has("[data-attach-tab]"), 20_000);
      await sleep(1200);
    },
  },
  { name: "09-chat-info", run: (p) => p.go(`/chat/${IDS.dmSalma}/info`, has("[data-info-tab]")) },
  { name: "10-topic-chat", run: (p) => openChat(p, IDS.topicDesign) },
  { name: "11-space-topics", run: (p) => p.go(`/chat/s/${IDS.space}`, has("[data-chat-forum]")) },
  {
    // the group-open flow as it is today (it changes with the topics screen): a tap on the space's row in the list
    name: "11b-space-row-open",
    run: async (p) => {
      await p.go("/chat", LIST);
      await press(p, `a[href="/chat/s/${IDS.space}"]`);
      await sleep(2500);
    },
  },
  { name: "12-saved-messages", run: (p) => openChat(p, IDS.saved) },
  { name: "13-settings", run: (p) => p.go("/settings/me", has("[data-settings-sections]")) },
  { name: "14-settings-account", run: (p) => p.go("/settings/me/account", has("[data-own-username]")) },
  { name: "15-settings-notifications", run: (p) => p.go("/settings/me/notifications") },
  { name: "16-settings-chat", run: (p) => p.go("/settings/me/chat") },
  { name: "17-settings-appearance", run: (p) => p.go("/settings/me/language") },
  { name: "18-settings-effects", run: (p) => p.go("/settings/me/effects") },
  { name: "19-profile", run: (p) => p.go("/profile") },
  { name: "20-contacts", run: (p) => p.go("/contacts") },
  { name: "21-my-work", run: (p) => p.go("/my-work") },
];
