import "./scoping-react";
import { describe, expect, it, vi } from "vitest";

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

import CardsPage from "@/app/(app)/cards/page";
import ManufacturingPage from "@/app/(app)/manufacturing/page";
import MaterialRoute from "@/app/(app)/manufacturing/materials/[id]/page";
import { CardsView } from "@/components/cards/cards-view";
import { MfgView } from "@/components/manufacturing/mfg-view";
import { MaterialPage } from "@/components/manufacturing/material-page";
import { EmptyState } from "@/components/ui/card";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { db, loginAs, makeWorkspace, uid } from "./helpers";
import { featureOff, makeMaterial, mfgWorld } from "./mfg-helpers";

/**
 * «مخزون التصنيع»: the pages. A partner, a person without the capability and a switched-off feature all get «not found» from the page itself
 * (the layout's menu is only discoverability); the tab beside «اللوحات» is offered exactly to the people who may open it, in a manufacturing space only.
 */

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);
type PageElement = { type: unknown; props: Record<string, unknown> };

describe("/manufacturing", () => {
  it("a partner and a person without the capability get «not found»; a keeper reads and may record, a buyer sees the cost too", async () => {
    const w = await mfgWorld();
    for (const person of [w.guest, w.plain, w.member]) {
      await loginAs(person.id);
      enter(w.space.id);
      await expect(ManufacturingPage(), person.name).rejects.toThrow("NEXT_NOT_FOUND");
    }
    await loginAs(w.keeper.id);
    enter(w.space.id);
    let page = (await ManufacturingPage()) as PageElement;
    expect(page.type).toBe(MfgView);
    expect(page.props["initial"]).toMatchObject({ spaceId: w.space.id, canEdit: true, canCost: false });
    await loginAs(w.buyer.id);
    page = (await ManufacturingPage()) as PageElement;
    expect(page.props["initial"]).toMatchObject({ canEdit: true, canCost: true });
    await loginAs(w.owner.id);
    page = (await ManufacturingPage()) as PageElement;
    expect(page.props["initial"]).toMatchObject({ canEdit: true, canCost: true });
  });

  it("a space that is not a manufacturing space says so (to a person who may use the feature), and the switch off is «not found» for everybody", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    enter(w.general.id);
    const page = (await ManufacturingPage()) as PageElement;
    expect(page.type).toBe(EmptyState);
    enter(w.space.id);
    await featureOff(w.org.id);
    await expect(ManufacturingPage()).rejects.toThrow("NEXT_NOT_FOUND");
    await loginAs(w.owner.id);
    await expect(ManufacturingPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a material page: the people who may read it get it; a partner, another company and a switched-off feature get «not found»", async () => {
    const w = await mfgWorld();
    await loginAs(w.buyer.id);
    const id = await makeMaterial(w.space.id);
    const route = (userId: string) => loginAs(userId).then(() => MaterialRoute({ params: { id } }));
    const ok = (await route(w.viewer.id)) as PageElement;
    expect(ok.type).toBe(MaterialPage);
    expect(ok.props["initial"]).toMatchObject({ id, canEdit: false, canCost: false, cost: null });
    await expect(route(w.guest.id)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(route(w.plain.id)).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(route(w.outsider.id)).rejects.toThrow("NEXT_NOT_FOUND");
    const other = await mfgWorld();
    await expect(route(other.owner.id)).rejects.toThrow("NEXT_NOT_FOUND");
    await featureOff(w.org.id);
    await expect(route(w.buyer.id)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("the tab beside «اللوحات»", () => {
  const stockTab = async (userId: string, spaceId: string) => {
    await loginAs(userId);
    enter(spaceId);
    const page = (await CardsPage()) as PageElement;
    expect(page.type).toBe(CardsView);
    return page.props["stockTab"];
  };

  it("is offered to the people who may open the ledger, in a manufacturing space only", async () => {
    const w = await mfgWorld();
    expect(await stockTab(w.keeper.id, w.space.id)).toBe(true);
    expect(await stockTab(w.viewer.id, w.space.id)).toBe(true);
    expect(await stockTab(w.owner.id, w.space.id)).toBe(true);
    expect(await stockTab(w.plain.id, w.space.id)).toBe(false);
    expect(await stockTab(w.guest.id, w.space.id)).toBe(false);
    // a space of cards, or a general one, never has it
    const cards = await makeWorkspace(w.org.id, [{ userId: w.keeper.id }], `Cards ${uid()}`);
    await db.workspace.update({ where: { id: cards.id }, data: { layout: "CARDS" } });
    expect(await stockTab(w.keeper.id, cards.id)).toBe(false);
    expect(await stockTab(w.keeper.id, w.general.id)).toBe(false);
  });

  it("is gone with the switch", async () => {
    const w = await mfgWorld();
    await featureOff(w.org.id);
    expect(await stockTab(w.keeper.id, w.space.id)).toBe(false);
    expect(await stockTab(w.owner.id, w.space.id)).toBe(false);
  });
});
