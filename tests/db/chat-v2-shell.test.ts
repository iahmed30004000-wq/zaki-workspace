/**
 * C2.1 + C2.2 + C2.3 — the new chat screen against a real database: the switch `chatLayoutV2` (OFF is today's screen), what the shell is told about the
 * person, and that the rows the list and the forum draw come only from what the server let this person read — so a search of the list can never name a
 * conversation they are outside of — in BOTH shapes of D-N2, with «كل الشركة» exactly where today's home offers it.
 */
import * as React from "react";
import { Fragment, type ReactElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/chat",
}));

import type { Prisma } from "@prisma/client";
import ChatLayout from "@/app/(app)/chat/layout";
import ChatPage from "@/app/(app)/chat/page";
import ChatForumPage from "@/app/(app)/chat/s/[spaceId]/page";
import * as listRoute from "@/app/api/chat/list/route";
import * as topicsRoute from "@/app/api/chat/spaces/[spaceId]/topics/route";
import * as memberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import { ChatHomeClient } from "@/components/chat/home/chat-home-client";
import { EmptyState } from "@/components/chat/v2/empty-state";
import { ChatShell } from "@/components/chat/v2/shell/chat-shell";
import { withFeature } from "@/lib/features";
import { folderKeyOf, foldersOf, forumRows, listRows } from "@/lib/chat/list-folders";
import type { ChatListDto, SpaceTopicsDto } from "@/server/chat/dto";
import { chatHome } from "@/server/chat/home";
import { chatList } from "@/server/chat/list";
import { call, db, loginAs, logout, makeTeam, makeUser, makeWorkspace } from "./helpers";

// the components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React
(globalThis as { React?: typeof React }).React = React;

type Ctx = { orgId: string; userId: string; orgRole: "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST" };

async function setFeatures(orgId: string, on: Record<string, boolean>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let s: unknown = org.settings;
  for (const [k, v] of Object.entries(on)) s = withFeature(s, k as Parameters<typeof withFeature>[1], v);
  await db.organization.update({ where: { id: orgId }, data: { settings: s as Prisma.InputJsonValue } });
}

const SECRET_TITLE = "خطةالرواتبالسرية";

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const bee = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  // the admin becomes a partner (an OWNER who is not the primary owner) with the silent oversight taken away
  await loginAs(t.owner.id);
  const patch = (userId: string, body: Record<string, unknown>) => call(memberRoute.PATCH, { method: "PATCH", params: { id: orgId, userId }, body });
  expect((await patch(t.admin.id, { role: "OWNER" })).status).toBe(200);
  const partner = t.admin;
  const space = await makeWorkspace(orgId, [{ userId: t.member.id }, { userId: bee.id }, { userId: outsider.id }, { userId: t.guest.id, role: "GUEST" }], "Alpha");
  const open = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "الطلبات" } });
  const secret = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: SECRET_TITLE, restricted: true, members: { create: [{ userId: t.member.id }, { userId: bee.id }] } } });
  await db.chatMessage.create({ data: { orgId, conversationId: open.id, authorId: bee.id, body: "وصل الطلب", createdAt: new Date("2026-11-17T09:00:00.000Z") } });
  await db.chatMessage.create({ data: { orgId, conversationId: secret.id, authorId: bee.id, body: "كلام سري", createdAt: new Date("2026-11-17T10:00:00.000Z") } });
  const ctx = (u: { id: string }, orgRole: Ctx["orgRole"]): Ctx => ({ orgId, userId: u.id, orgRole });
  return { t, orgId, bee, outsider, partner, space, open, secret, ctx, patch };
}
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

const children = { type: "p", props: {}, key: null } as unknown as ReactElement;
const props = (el: unknown) => (el as ReactElement<Record<string, unknown>>).props;

beforeAll(async () => {
  await getWorld();
});

describe("the switch: OFF is today's chat, ON is the new shell", () => {
  it("OFF (the default): the layout draws nothing of its own, /chat is the old home, /chat/s/<id> goes back to /chat", async () => {
    const w = await getWorld();
    await loginAs(w.t.member.id);
    const layout = (await ChatLayout({ children })) as ReactElement<{ children: unknown }>;
    expect(layout.type).toBe(Fragment);
    expect(layout.props.children).toBe(children);
    const page = (await ChatPage()) as ReactElement;
    expect(page.type).toBe(ChatHomeClient);
    expect(props(page)).toEqual({ guest: false, canMeet: true });
    await expect(ChatForumPage()).rejects.toThrow("NEXT_REDIRECT:/chat");
  });

  it("ON: the shell around the page with the person's facts; /chat is the empty pane; the forum address opens", async () => {
    const w = await getWorld();
    await setFeatures(w.orgId, { chatLayoutV2: true });
    await loginAs(w.t.member.id);
    const layout = (await ChatLayout({ children })) as ReactElement;
    expect(layout.type).toBe(ChatShell);
    expect(props(layout)).toMatchObject({ userId: w.t.member.id, guest: false, canMeet: true, rowMenu: true, canPurge: false });
    const page = (await ChatPage()) as ReactElement;
    expect(page.type).toBe(EmptyState);
    expect(((await ChatForumPage()) as ReactElement).type).toBe(EmptyState);
  });

  it("ON: «حذف نهائي» is the owner rank's alone, and a guest is told so (no meeting, no private chats)", async () => {
    const w = await getWorld();
    await loginAs(w.t.owner.id);
    expect(props(await ChatLayout({ children }))).toMatchObject({ canPurge: true, canMeet: true, guest: false });
    await loginAs(w.partner.id);
    expect(props(await ChatLayout({ children }))).toMatchObject({ canPurge: true });
    await loginAs(w.t.member.id);
    expect(props(await ChatLayout({ children }))).toMatchObject({ canPurge: false });
    await loginAs(w.t.guest.id);
    expect(props(await ChatLayout({ children }))).toMatchObject({ guest: true, canMeet: false, canPurge: false });
    expect(props(await ChatPage())).toEqual({ guest: true, canMeet: false });
  });

  it("ON, with the company's «قائمة المحادثة» off: no row menu, and no purge either", async () => {
    const w = await getWorld();
    await setFeatures(w.orgId, { chatRowMenu: false });
    await loginAs(w.t.owner.id);
    expect(props(await ChatLayout({ children }))).toMatchObject({ rowMenu: false, canPurge: false });
    await setFeatures(w.orgId, { chatRowMenu: true });
  });

  it("switching it off again brings the old screen back, nothing lost", async () => {
    const w = await getWorld();
    await setFeatures(w.orgId, { chatLayoutV2: false });
    await loginAs(w.t.member.id);
    expect(((await ChatPage()) as ReactElement).type).toBe(ChatHomeClient);
    expect(((await ChatLayout({ children })) as ReactElement).type).toBe(Fragment);
    await setFeatures(w.orgId, { chatLayoutV2: true });
  });

  it("an anonymous visitor is sent to sign in by the layout and by each page", async () => {
    logout();
    await expect(ChatLayout({ children })).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(ChatPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(ChatForumPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("«كل الشركة» is offered exactly where today's home offers it (the capability, never the rank)", () => {
  const offers = (canOversee: boolean, guest = false) => foldersOf({ canOversee, guest }).some((f) => f.key === "company");

  it("the primary owner: yes; the home and the list agree", async () => {
    const w = await getWorld();
    const ctx = w.ctx(w.t.owner, "OWNER");
    const [home, list] = [await chatHome(ctx), await chatList(ctx)];
    expect(home.canOversee).toBe(true);
    expect(list.canOversee).toBe(home.canOversee);
    expect(offers(list.canOversee)).toBe(true);
  });

  it("a partner who still holds archive.view: yes; after the primary owner takes it away: no (an OWNER rank alone reads nothing private)", async () => {
    const w = await getWorld();
    // a request makes its own context object (the list keeps what it read once per request in a WeakMap keyed by it): a fresh one for each
    expect((await chatList(w.ctx(w.partner, "OWNER"))).canOversee).toBe((await chatHome(w.ctx(w.partner, "OWNER"))).canOversee);
    expect((await chatList(w.ctx(w.partner, "OWNER"))).canOversee).toBe(true);
    await loginAs(w.t.owner.id);
    expect((await w.patch(w.partner.id, { revokedCapabilities: ["archive.view"] })).status).toBe(200);
    const [home, list] = [await chatHome(w.ctx(w.partner, "OWNER")), await chatList(w.ctx(w.partner, "OWNER"))];
    expect(home.canOversee).toBe(false);
    expect(list.canOversee).toBe(false);
    expect(offers(list.canOversee)).toBe(false);
  });

  it("a member and a guest: no, and the guest's folders never offer it even if the flag were true", async () => {
    const w = await getWorld();
    for (const [user, role] of [[w.t.member, "MEMBER"], [w.t.guest, "GUEST"]] as const) {
      const ctx = w.ctx(user, role);
      const [home, list] = [await chatHome(ctx), await chatList(ctx)];
      expect(list.canOversee).toBe(home.canOversee);
      expect(offers(list.canOversee, role === "GUEST")).toBe(false);
    }
    expect(offers(true, true)).toBe(false);
  });

  it("a remembered «كل الشركة» that the person no longer holds falls back to «الكل»", async () => {
    const w = await getWorld();
    const list = await chatList(w.ctx(w.t.member, "MEMBER"));
    expect(folderKeyOf("company", foldersOf({ canOversee: list.canOversee }))).toBe("all");
  });
});

describe("the rows the list draws come only from what the server let this person read", () => {
  const shape = (dto: ChatListDto) => ({ scope: dto.scope, spaceId: dto.spaceId });

  it("a private topic is in the row of the people in it; for anybody else a search for its name finds nothing and the row never names it", async () => {
    const w = await getWorld();
    const inside = await chatList(w.ctx(w.t.member, "MEMBER"));
    expect(JSON.stringify(inside.rows)).toContain(SECRET_TITLE);
    expect(listRows(inside.rows, { ...shape(inside), folder: "all", query: SECRET_TITLE }).map((r) => r.title)).toEqual(["Alpha"]);

    const outside = await chatList(w.ctx(w.outsider, "MEMBER"));
    expect(JSON.stringify(outside.rows)).not.toContain(SECRET_TITLE);
    expect(JSON.stringify(outside.rows)).not.toContain(w.secret.id);
    expect(JSON.stringify(outside.rows)).not.toContain("كلام سري");
    for (const folder of ["all", "unread", "dm", "spaces", "mentions"] as const) {
      expect(listRows(outside.rows, { ...shape(outside), folder, query: SECRET_TITLE })).toEqual([]);
      expect(listRows(outside.rows, { ...shape(outside), folder, query: "كلام سري" })).toEqual([]);
    }
    // the space's row exists for them, with the open topic only
    const alpha = outside.rows.find((r) => r.kind === "SPACE")!;
    expect(alpha.topicChips?.map((c) => c.title)).toEqual(["الطلبات"]);
  });

  it("the forum view (the route's rows, then the shell's pure order) has the same rule", async () => {
    const w = await getWorld();
    const forum = async (userId: string) => {
      await loginAs(userId);
      const res = await call(topicsRoute.GET, { url: `http://localhost/api/chat/spaces/${w.space.id}/topics`, params: { spaceId: w.space.id } });
      expect(res.status).toBe(200);
      return res.json as unknown as SpaceTopicsDto;
    };
    const inside = await forum(w.t.member.id);
    expect(forumRows(inside.rows, w.space.id).map((r) => r.title)).toContain(SECRET_TITLE);
    expect(forumRows(inside.rows, w.space.id).find((r) => r.title === SECRET_TITLE)?.restricted).toBe(true);
    const outside = await forum(w.outsider.id);
    expect(JSON.stringify(outside)).not.toContain(SECRET_TITLE);
    expect(forumRows(outside.rows, w.space.id, {}, SECRET_TITLE)).toEqual([]);
    expect(forumRows(outside.rows, w.space.id).map((r) => r.title)).toEqual(["الطلبات"]);
  });

  it("both shapes of D-N2 work: the one list (a forum row per space) and the space the person is in (its topics and chats) — neither is assumed", async () => {
    const w = await getWorld();
    await loginAs(w.t.member.id);
    const one = (await call(listRoute.GET, { url: "http://localhost/api/chat/list" })).json as unknown as ChatListDto;
    expect(one.scope).toBe("all");
    expect(one.rows.some((r) => r.kind === "SPACE")).toBe(true);
    expect(listRows(one.rows, { ...shape(one), folder: "spaces" }).every((r) => r.kind === "SPACE" || r.kind === "TOPIC")).toBe(true);
    const spaceShape = (await call(listRoute.GET, { url: `http://localhost/api/chat/list?spaceId=${w.space.id}` })).json as unknown as ChatListDto;
    expect(spaceShape.scope).toBe("space");
    expect(spaceShape.rows.some((r) => r.kind === "TOPIC")).toBe(true);
    // the same pure functions draw either: every folder answers, «الكل» is everything not archived, the folders are subsets of it
    for (const dto of [one, spaceShape]) {
      const all = listRows(dto.rows, { ...shape(dto), folder: "all" });
      expect(all.length).toBe(dto.rows.length);
      for (const folder of ["unread", "dm", "spaces", "mentions"] as const) {
        const part = listRows(dto.rows, { ...shape(dto), folder });
        expect(part.every((r) => all.some((a) => a.id === r.id))).toBe(true);
      }
    }
    // flipping the company's switch changes the answer's shape, not what the folders do with it
    await setFeatures(w.orgId, { chatOneList: false });
    const off = (await call(listRoute.GET, { url: "http://localhost/api/chat/list" })).json as unknown as ChatListDto;
    expect(["all", "space"]).toContain(off.scope);
    await setFeatures(w.orgId, { chatOneList: true });
  });
});
