import "./scoping-react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/cards",
  useSearchParams: () => new URLSearchParams(),
}));

import AppLayout from "@/app/(app)/layout";
import type { AppShellProps } from "@/components/app-shell";
import * as route from "@/app/api/me/nav-order/route";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { requireActor } from "@/server/policy/actor";
import { visibleNavFor } from "@/server/services/nav-order";
import { call, db, loginAs, logout, makeTeam, makeWorkspace, uid } from "./helpers";

/**
 * «فقط لوحات», on the server (the owner, 2026-10-30): the layout of the space the person is in reaches the map the (app)
 * layout draws. A space of «لوحات» or «تصنيع» offers «اللوحات» then «الإدارة»; a general space keeps its six places; the
 * order a person saves is checked against the map of the space they are in; the pages of the hidden places still answer.
 */

type Shell = ReactElement<AppShellProps>;
const frame = async () => (await AppLayout({ children: null })) as Shell;
const places = (shell: Shell) => shell.props.nav.places.map((p) => p.key as string);
const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);
const URL = "http://localhost/api/me/nav-order";
const put = (body: unknown) => call(route.PUT, { method: "PUT", url: URL, body });

/** A company with a space of cards, a general one, and the member (and a guest, in the cards space) in them. */
async function world() {
  const team = await makeTeam();
  const cardsSpace = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: team.guest.id, role: "GUEST" }], `Cards ${uid()}`);
  await db.workspace.update({ where: { id: cardsSpace.id }, data: { layout: "CARDS" } });
  const general = await makeWorkspace(team.org.id, [{ userId: team.member.id }], `General ${uid()}`);
  return { ...team, cardsSpace, general };
}

beforeEach(() => logout());

describe("the layout draws the map of the space the person is in", () => {
  it("a space of «لوحات»: «اللوحات» then «الإدارة» (the plain member's «الفريق» and «لوحتي»), and nothing else", async () => {
    const w = await world();
    await loginAs(w.member.id);
    enter(w.cardsSpace.id);
    const shell = await frame();
    expect(places(shell)).toEqual(["cards", "admin"]);
    expect(shell.props.nav.places[0]).toMatchObject({ href: "/cards", labelKey: "nav.place.cards", tabs: [] });
    expect(shell.props.nav.places[1]).toMatchObject({ labelKey: "nav.place.admin", href: "/members" });
    expect(shell.props.nav.places[1]?.tabs.map((t) => t.key)).toEqual(["team", "board"]);
  });

  it("a space of «تصنيع» is the same", async () => {
    const w = await world();
    await db.workspace.update({ where: { id: w.cardsSpace.id }, data: { layout: "MANUFACTURING" } });
    await loginAs(w.member.id);
    enter(w.cardsSpace.id);
    expect(places(await frame())).toEqual(["cards", "admin"]);
  });

  it("the owner (he enters the space like anybody, without a row in it): «اللوحات» then «الإدارة» with its tabs", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    enter(w.cardsSpace.id);
    const shell = await frame();
    expect(places(shell)).toEqual(["cards", "admin"]);
    expect(shell.props.nav.places[1]?.tabs.map((t) => t.key)).toEqual(["team", "space", "board", "structure", "development", "automation", "telegram", "settings", "archive"]);
  });

  it("an external partner in the space sees «اللوحات» alone", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    enter(w.cardsSpace.id);
    expect(places(await frame())).toEqual(["cards"]);
  });

  it("a general space is untouched: the six places, in order, and «اللوحات» nowhere", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    enter(w.general.id);
    expect(places(await frame())).toEqual(["today", "chat", "work", "library", "watch", "admin"]);
    await loginAs(w.member.id);
    enter(w.general.id);
    expect(places(await frame())).toEqual(["today", "chat", "work", "library", "watch", "admin"]);
  });

  it("moving between the two spaces moves the menu with the person, read from the database on every request", async () => {
    const w = await world();
    await loginAs(w.member.id);
    enter(w.general.id);
    expect(places(await frame())).toContain("today");
    enter(w.cardsSpace.id);
    expect(places(await frame())).toEqual(["cards", "admin"]);
    // the layout is changed in the database: the next request draws the new map
    await db.workspace.update({ where: { id: w.cardsSpace.id }, data: { layout: "STANDARD" } });
    expect(places(await frame())).toContain("today");
  });

  it("a saved order composes: an order saved in a general space leaves «اللوحات» first, and the shell is handed it as it is", async () => {
    const w = await world();
    const order = { places: ["library", "chat", "today", "work", "watch", "admin"], tabs: {} };
    await db.user.update({ where: { id: w.member.id }, data: { navOrder: order } });
    await loginAs(w.member.id);
    enter(w.cardsSpace.id);
    const shell = await frame();
    // the server hands the shell the code's map and the person's order; the shell applies it over what is offered
    expect(places(shell)).toEqual(["cards", "admin"]);
    expect(shell.props.navOrder).toEqual(order);
  });
});

describe("a saved order is checked against the map of the space the person is in", () => {
  it("in a cards space the person may order «اللوحات» and «الإدارة»; a place that space does not offer is refused", async () => {
    const w = await world();
    await loginAs(w.member.id);
    enter(w.cardsSpace.id);
    expect((await put({ places: ["admin", "cards"], tabs: {} })).status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: w.member.id }, select: { navOrder: true } })).navOrder).toEqual({ places: ["admin", "cards"], tabs: {} });
    const refused = await put({ places: ["chat", "cards"], tabs: {} });
    expect(refused.status).toBe(403);
  });

  it("in a general space «اللوحات» is not offered, so an order naming it is refused there", async () => {
    const w = await world();
    await loginAs(w.member.id);
    enter(w.general.id);
    expect((await put({ places: ["cards"], tabs: {} })).status).toBe(403);
    expect((await put({ places: ["chat", "today"], tabs: {} })).status).toBe(200);
  });

  it("the map the save is checked against is the layout's (visibleNavFor)", async () => {
    const w = await world();
    await loginAs(w.member.id);
    enter(w.cardsSpace.id);
    expect((await visibleNavFor(await requireActor())).places.map((p) => p.key)).toEqual(["cards", "admin"]);
  });
});
