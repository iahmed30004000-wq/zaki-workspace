import "./scoping-react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

// The page calls redirect(); its client parts call useRouter(). Neither needs a running Next app here.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/share",
  useSearchParams: () => new URLSearchParams(),
}));

import SharePage from "@/app/share/page";
import { ShareEmpty, SharePicker } from "@/components/pwa/share-picker";
import { loginAs, logout, makeTeam } from "./helpers";

/**
 * M1a — `/share` (where the phone's share sheet lands): only for a person who is signed in, and for each of them; the words in the address become the picker's
 * text, cleaned; nothing in the address reaches the page as anything but text.
 */

/** Every element of a tree, depth first (a page returns a small tree: `<main>` around the picker). */
function elements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  out.push(node);
  return elements((node.props as { children?: ReactNode }).children, out);
}
const find = (node: ReactNode, type: unknown) => elements(node).find((el) => el.type === type);

describe("/share", () => {
  it("sends somebody who is not signed in to the sign-in page", async () => {
    logout();
    await expect(SharePage({ searchParams: { text: "مرحبا" } })).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("is open to every rank of the company, an external partner included, and hands the picker the person's own id and the cleaned words", async () => {
    const t = await makeTeam();
    for (const person of [t.owner, t.admin, t.member, t.guest]) {
      await loginAs(person.id);
      const page = await SharePage({ searchParams: { title: "عنوان", text: "كلام", url: "https://example.com/a" } });
      const picker = find(page, SharePicker);
      expect(picker, person.name).toBeTruthy();
      expect(picker!.props).toMatchObject({ userId: person.id, text: "عنوان\nكلام\nhttps://example.com/a" });
      expect(find(page, ShareEmpty)).toBeUndefined();
    }
  });

  it("with nothing to share it draws the empty page, not a picker with nothing to put in the composer", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    for (const searchParams of [{}, { text: "   " }, { url: "javascript:alert(1)" }]) {
      const page = await SharePage({ searchParams });
      expect(find(page, ShareEmpty), JSON.stringify(searchParams)).toBeTruthy();
      expect(find(page, SharePicker)).toBeUndefined();
    }
  });

  it("a repeated parameter counts by its first value; an address that is not http(s) is dropped from the words", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const page = await SharePage({ searchParams: { text: ["الأول", "التاني"], url: "javascript:alert(1)" } });
    expect(find(page, SharePicker)!.props).toMatchObject({ text: "الأول" });
  });

  it("the page owns the one <main> landmark", async () => {
    const t = await makeTeam();
    await loginAs(t.member.id);
    const page = await SharePage({ searchParams: { text: "x" } });
    expect((page as ReactElement).type).toBe("main");
  });
});
