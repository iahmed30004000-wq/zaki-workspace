import "./scoping-react";
import { describe, expect, it, vi } from "vitest";

// The pages call redirect(); their client parts call useRouter(). Neither needs a running Next app here.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import HomePage from "@/app/(app)/page";
import ChatPage from "@/app/(app)/chat/page";
import CardsPage from "@/app/(app)/cards/page";
import { CardsView } from "@/components/cards/cards-view";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { db, loginAs, logout, makeTeam, makeWorkspace, uid } from "./helpers";

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

type PageElement = { type: unknown; props: Record<string, unknown> };

/** A company with a space of cards and a general one, the member in both. */
async function world() {
  const team = await makeTeam();
  const cardsSpace = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: team.guest.id, role: "GUEST" }], `Cards ${uid()}`);
  await db.workspace.update({ where: { id: cardsSpace.id }, data: { layout: "CARDS" } });
  const general = await makeWorkspace(team.org.id, [{ userId: team.member.id }], `General ${uid()}`);
  return { ...team, cardsSpace, general };
}

describe("a space of cards opens on its cards", () => {
  it("«اليوم» and the chat entry send the person to /cards; a general space is left as it was", async () => {
    const w = await world();
    await loginAs(w.member.id);
    enter(w.cardsSpace.id);
    await expect(HomePage({})).rejects.toThrow("NEXT_REDIRECT:/cards");
    await expect(ChatPage()).rejects.toThrow("NEXT_REDIRECT:/cards");
    enter(w.general.id);
    // the general space still renders «اليوم» and the chat (nothing is removed from anyone)
    await expect(HomePage({})).resolves.toBeTruthy();
    await expect(ChatPage()).resolves.toBeTruthy();
  });

  it("a «تصنيع» space behaves the same: «اليوم» and the chat go to /cards, and the cards page names its layout", async () => {
    const w = await world();
    await db.workspace.update({ where: { id: w.cardsSpace.id }, data: { layout: "MANUFACTURING" } });
    await loginAs(w.member.id);
    enter(w.cardsSpace.id);
    await expect(HomePage({})).rejects.toThrow("NEXT_REDIRECT:/cards");
    await expect(ChatPage()).rejects.toThrow("NEXT_REDIRECT:/cards");
    const page = (await CardsPage()) as PageElement;
    expect(page.props).toMatchObject({ layout: "MANUFACTURING", canWrite: true });
  });

  it("the owner is sent too (he enters the space like anybody) and an external partner as well", async () => {
    const w = await world();
    for (const who of [w.owner, w.guest]) {
      await loginAs(who.id);
      enter(w.cardsSpace.id);
      await expect(HomePage({}), who.email).rejects.toThrow("NEXT_REDIRECT:/cards");
    }
  });
});

describe("/cards", () => {
  it("shows the cards of the space the person is in, with what they may do", async () => {
    const w = await world();
    await db.card.create({ data: { orgId: w.org.id, workspaceId: w.cardsSpace.id, createdById: w.member.id, kind: "NOTE", title: "here", position: 1000 } });
    await db.card.create({ data: { orgId: w.org.id, workspaceId: w.general.id, createdById: w.member.id, kind: "NOTE", title: "elsewhere", position: 1000 } });

    await loginAs(w.member.id);
    enter(w.cardsSpace.id);
    let page = (await CardsPage()) as PageElement;
    expect(page.type).toBe(CardsView);
    expect((page.props.initial as Array<{ title: string }>).map((c) => c.title)).toEqual(["here"]);
    expect(page.props).toMatchObject({ spaceId: w.cardsSpace.id, canWrite: true, owner: false });

    // it also opens in a general space: that space's own cards
    enter(w.general.id);
    page = (await CardsPage()) as PageElement;
    expect((page.props.initial as Array<{ title: string }>).map((c) => c.title)).toEqual(["elsewhere"]);

    // an external partner reads, never writes
    await loginAs(w.guest.id);
    enter(w.cardsSpace.id);
    page = (await CardsPage()) as PageElement;
    expect(page.props).toMatchObject({ canWrite: false, owner: false });
    expect((page.props.initial as Array<{ title: string }>).map((c) => c.title)).toEqual(["here"]);

    // the owner reads silently
    await loginAs(w.owner.id);
    enter(w.cardsSpace.id);
    page = (await CardsPage()) as PageElement;
    expect(page.props).toMatchObject({ canWrite: true, owner: true });
  });

  it("a stale cookie for a space that is not theirs never shows that space's cards", async () => {
    const w = await world();
    const outsiderSpace = await makeWorkspace(w.org.id, [], `Closed ${uid()}`);
    await db.card.create({ data: { orgId: w.org.id, workspaceId: outsiderSpace.id, createdById: w.owner.id, kind: "NOTE", title: "secret", position: 1000 } });
    await loginAs(w.member.id);
    enter(outsiderSpace.id);
    const page = (await CardsPage()) as PageElement;
    expect(JSON.stringify(page.props)).not.toContain("secret");
  });

  it("an anonymous visitor is sent to sign in", async () => {
    logout();
    await expect(CardsPage()).rejects.toThrow(/NEXT_REDIRECT/);
  });
});
