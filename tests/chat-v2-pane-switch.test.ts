import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

const state = vi.hoisted(() => ({
  features: {} as Record<string, boolean>,
  caps: new Set<string>(["watch.view"]),
  external: false,
  spaceId: "s1" as string | null,
  entered: [] as unknown[][],
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/c1",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock("@/app/(app)/_access", () => ({
  pageActor: async () => ({ user: { id: "u1" }, actor: { userId: "u1", orgId: "o1", role: "MEMBER", caps: state.caps, isOwner: false, isExternal: state.external } }),
}));
vi.mock("@/server/services/features", () => ({ isFeatureOn: async (_org: string, key: string) => state.features[key] ?? false }));
vi.mock("@/server/db", () => ({ db: { conversation: { findFirst: async () => (state.spaceId ? { spaceId: state.spaceId } : null) } } }));
vi.mock("@/server/services/current-space", () => ({
  keepInSpace: async (...args: unknown[]) => {
    state.entered.push(args);
  },
}));

import ChatConversationPage from "@/app/(app)/chat/[id]/page";
import { ConversationPageClient } from "@/components/chat/conversation/conversation-page-client";
import { ConversationPane } from "@/components/chat/v2/pane/conversation-pane";
import { paneSwitch } from "@/lib/chat/v2/pane/switch";
import { I18nProvider } from "@/lib/i18n";

/**
 * C2.4 — the switch of `/chat/[id]`. OFF (as merged) the page is TODAY's `ConversationPageClient` with the same props and draws the old screen; ON it is
 * the new pane, told by the server whether «نتفرّج سوا» may be offered. `keepInSpace` runs first either way (a topic of another space still enters it).
 */
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
type PageElement = ReactElement<Record<string, unknown>>;
const reset = (over: Partial<typeof state> = {}) => {
  state.features = {};
  state.caps = new Set(["watch.view"]);
  state.external = false;
  state.spaceId = "s1";
  state.entered = [];
  Object.assign(state, over);
};

describe("/chat/[id] with chatLayoutV2 OFF: today's page, untouched", () => {
  it("is the old ConversationPageClient with the same two props, and it draws the old log", async () => {
    reset();
    const element = (await ChatConversationPage({ params: { id: "c1" }, searchParams: { m: "m9" } })) as PageElement;
    expect(element.type).toBe(ConversationPageClient);
    expect(element.props).toEqual({ conversationId: "c1", focusMessageId: "m9" });
    const html = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, element)));
    // the OLD screen's marks: the log of the old screen carries the conversation id, and its head has the word «رجوع»
    expect(html).toContain('data-conversation-id="c1"');
    expect(html).toContain("رجوع");
    expect(html).not.toContain("data-chat-pane-root");
  });

  it("keepInSpace still runs first, with the address to come back to", async () => {
    reset();
    await ChatConversationPage({ params: { id: "c1" }, searchParams: { m: "m 9" } });
    expect(state.entered).toHaveLength(1);
    expect(state.entered[0]![1]).toBe("s1");
    expect(state.entered[0]![2]).toBe("/chat/c1?m=m%209");
    reset({ spaceId: null });
    await ChatConversationPage({ params: { id: "c1" } });
    expect(state.entered).toHaveLength(0);
  });
});

describe("/chat/[id] with chatLayoutV2 ON: the new pane", () => {
  it("is the ConversationPane for the id, with the link's message, and keepInSpace has run", async () => {
    reset({ features: { chatLayoutV2: true } });
    const element = (await ChatConversationPage({ params: { id: "c1" }, searchParams: { m: "m9" } })) as PageElement;
    expect(element.type).toBe(ConversationPane);
    expect(element.props).toMatchObject({ conversationId: "c1", focusMessageId: "m9" });
    expect(state.entered).toHaveLength(1);
  });

  it("«نتفرّج سوا» is offered only when the company's switch is on, the person's box allows it, and the person is not an external partner", async () => {
    reset({ features: { chatLayoutV2: true, watch: true } });
    expect(await paneSwitch({ orgId: "o1", isExternal: false, caps: state.caps as never })).toEqual({ watch: true });
    reset({ features: { chatLayoutV2: true, watch: false } });
    expect(await paneSwitch({ orgId: "o1", isExternal: false, caps: state.caps as never })).toEqual({ watch: false });
    reset({ features: { chatLayoutV2: true, watch: true }, caps: new Set() });
    expect(await paneSwitch({ orgId: "o1", isExternal: false, caps: state.caps as never })).toEqual({ watch: false });
    reset({ features: { chatLayoutV2: true, watch: true } });
    expect(await paneSwitch({ orgId: "o1", isExternal: true, caps: state.caps as never })).toEqual({ watch: false });
  });

  it("the page passes that answer on", async () => {
    reset({ features: { chatLayoutV2: true, watch: true } });
    expect(((await ChatConversationPage({ params: { id: "c1" } })) as PageElement).props["watch"]).toBe(true);
    reset({ features: { chatLayoutV2: true, watch: true }, external: true });
    expect(((await ChatConversationPage({ params: { id: "c1" } })) as PageElement).props["watch"]).toBe(false);
  });

  it("OFF is null: nothing is told to a pane that is not drawn", async () => {
    reset();
    expect(await paneSwitch({ orgId: "o1", isExternal: false, caps: state.caps as never })).toBeNull();
  });
});
