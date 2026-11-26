import { describe, expect, it } from "vitest";
import { GET as settingsGET } from "@/app/api/me/settings/route";
import { GET as guideGET } from "@/app/api/guide/route";
import { GET as articleGET } from "@/app/api/guide/[slug]/route";
import { call, db, loginAs, makeTeam } from "./helpers";

/**
 * The phone's «إعداداتي» and «دليل زاكي» doors (M2 N6 batch 5). `GET /api/me/settings` hands the facts the site's settings page reads on the
 * server (the same functions): the primary owner's id only to a person of the team who is not that owner, «آخر ظهور» never offered to a
 * partner, the digits as saved. `GET /api/guide` and `/api/guide/[slug]` read the guide the site's pages read, and an article above the
 * reader's level is «not found» exactly as the page is.
 */

type Facts = { external: boolean; usernameManaged: boolean; contactOwnerId: string | null; digits: string; features: Record<string, boolean> };
const facts = async () => {
  const r = await call(settingsGET);
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return r.json as unknown as Facts;
};

describe("GET /api/me/settings — the facts of «إعداداتي»", () => {
  it("a member gets the owner to contact, no username management, the digits they saved", async () => {
    const t = await makeTeam();
    await db.user.update({ where: { id: t.member.id }, data: { digits: "arabic" } });
    await loginAs(t.member.id);
    const f = await facts();
    expect(f.contactOwnerId).toBe(t.owner.id);
    expect(f.usernameManaged).toBe(false);
    expect(f.digits).toBe("arabic");
    expect(f.external).toBe(false);
    expect(f.features["lastSeen"]).toBe(true);
  });

  it("the owner has nobody above to contact, and manages usernames", async () => {
    const t = await makeTeam();
    await loginAs(t.owner.id);
    const f = await facts();
    expect(f.contactOwnerId).toBeNull();
    expect(f.usernameManaged).toBe(true);
    expect(f.digits).toBe("latin");
  });

  it("an external partner never gets the owner's id, nor «آخر ظهور»", async () => {
    const t = await makeTeam();
    await loginAs(t.guest.id);
    const f = await facts();
    expect(f.external).toBe(true);
    expect(f.contactOwnerId).toBeNull();
    expect(f.features["lastSeen"]).toBe(false);
  });

  it("a company switch that is off reads as off", async () => {
    const t = await makeTeam();
    await db.organization.update({ where: { id: t.org.id }, data: { settings: { features: { avatars: false, chatAutomation: false } } } });
    await loginAs(t.member.id);
    const f = await facts();
    expect(f.features["avatars"]).toBe(false);
    expect(f.features["chatAutomation"]).toBe(false);
  });
});

describe("GET /api/guide and /api/guide/[slug] — the guide, by the reader's level", () => {
  it("a member reads the staff articles but not the managers' one, which is «not found» by its link too", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const list = (await call(guideGET)).json as { articles: { slug: string }[] };
    const slugs = list.articles.map((a) => a.slug);
    expect(slugs).toContain("tasks");
    expect(slugs).not.toContain("team");
    expect((await call(articleGET, { params: { slug: "team" } })).status).toBe(404);
    const r = await call(articleGET, { params: { slug: "tasks" } });
    expect(r.status).toBe(200);
    const body = r.json as { article: { slug: string; blocks: unknown[] }; prev: { slug: string } | null; next: { slug: string } | null };
    expect(body.article.slug).toBe("tasks");
    expect(body.article.blocks.length).toBeGreaterThan(0);
    expect(body.prev?.slug).toBeTruthy();
  });

  it("an external partner reads only what is for everyone; an unknown slug is «not found»", async () => {
    const t = await makeTeam();
    await loginAs(t.guest.id);
    const slugs = ((await call(guideGET)).json as { articles: { slug: string }[] }).articles.map((a) => a.slug);
    expect(slugs).toContain("start");
    expect(slugs).not.toContain("tasks");
    expect((await call(articleGET, { params: { slug: "tasks" } })).status).toBe(404);
    expect((await call(articleGET, { params: { slug: "nope" } })).status).toBe(404);
  });

  it("the owner reads the managers' article", async () => {
    const t = await makeTeam();
    await loginAs(t.owner.id);
    expect((await call(articleGET, { params: { slug: "team" } })).status).toBe(200);
  });
});
