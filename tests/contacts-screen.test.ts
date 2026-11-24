import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

(globalThis as { React?: typeof React }).React = React;

import { ContactsScreen } from "@/components/contacts/contacts-screen";
import { filterContacts, sortContacts, type ContactPerson } from "@/lib/contacts";
import { TG_TABS, tgTabOf } from "@/components/shell/telegram-tab-bar";
import { AR } from "@/lib/i18n/dict";
import { render, textOf } from "./ui-render";

/** «جهات الاتصال» (S6.3): Telegram's contacts screen, the company's people sorted by when they were last seen. */
const NOW = new Date("2026-11-24T12:00:00Z");
const person = (id: string, name: string, lastSeenAt?: string | null, over: Partial<ContactPerson> = {}): ContactPerson => ({ userId: id, name, jobTitle: null, role: "MEMBER", avatarUrl: null, ...(lastSeenAt === undefined ? {} : { lastSeenAt }), ...over });
const people = [
  person("a", "علي", "2026-11-24T08:00:00Z"),
  person("b", "باسل", "2026-11-24T11:50:00Z"),
  person("c", "جميل", null),
  person("d", "دانة", "2026-11-23T09:00:00Z"),
  person("e", "أحمد"),
];

describe("sortContacts", () => {
  it("puts the most recently seen first, the unknown after them by name", () => {
    expect(sortContacts(people).map((p) => p.userId)).toEqual(["b", "a", "d", "e", "c"]);
  });
  it("sorts by name when nobody's time is known (the company's switch is off)", () => {
    expect(sortContacts([person("x", "نور"), person("y", "أمل")]).map((p) => p.userId)).toEqual(["y", "x"]);
  });
  it("never changes the list it was given", () => {
    const copy = [...people];
    sortContacts(people);
    expect(people).toEqual(copy);
  });
});

describe("filterContacts", () => {
  it("keeps the people whose name or job title has the words, ignoring case and extra spaces", () => {
    const list = [person("a", "Sara Ali"), person("b", "باسل", undefined, { jobTitle: "مصمم" })];
    expect(filterContacts(list, "  SARA ").map((p) => p.userId)).toEqual(["a"]);
    expect(filterContacts(list, "مصمم").map((p) => p.userId)).toEqual(["b"]);
    expect(filterContacts(list, "").length).toBe(2);
    expect(filterContacts(list, "zzz")).toEqual([]);
  });
});

describe("the screen", () => {
  const html = render(React.createElement(ContactsScreen, { people, now: NOW.toISOString() }));
  const text = textOf(html);
  it("lists every person once with the page of that person behind the row", () => {
    for (const p of people) expect(text).toContain(p.name);
    for (const p of people) expect(html).toContain(`href="/u/${p.userId}"`);
    expect(html.match(/data-contact-row=/g)).toHaveLength(people.length);
  });
  it("says what the list is sorted by, and shows each person's last seen (or nothing when unknown)", () => {
    expect(text).toContain(AR["contacts.sorted_seen"]!);
    expect(text).toContain("آخر ظهور");
    expect(html).toContain("data-contact-search");
  });
  it("with no one to show says so, instead of an empty card", () => {
    const empty = render(React.createElement(ContactsScreen, { people: [], now: NOW.toISOString() }));
    expect(textOf(empty)).toContain(AR["contacts.empty"]!);
    expect(empty).not.toContain("data-contact-row");
  });
});

describe("the bar's contacts tab", () => {
  it("leads to the contacts screen, and that screen and a person's page both light it", () => {
    expect(TG_TABS.find((t) => t.key === "contacts")?.href).toBe("/contacts");
    expect(tgTabOf("/contacts")).toBe("contacts");
    expect(tgTabOf("/u/someone")).toBe("contacts");
  });
  it("the page keeps the staff-directory rules: no partner, no one without the directory", () => {
    const src = readFileSync(join(__dirname, "..", "src", "app", "(app)", "contacts", "page.tsx"), "utf8");
    expect(src).toContain("actor.isExternal");
    expect(src).toContain('actorCan(actor, "directory.view")');
    expect(src).toContain("chatDirectory(");
  });
});
