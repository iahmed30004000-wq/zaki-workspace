import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * C2.4 — the seams, and the rules that cannot be seen in a render (the virtual list draws nothing on the server, and there is no browser here): built so that
 * C2.5 (the composer) and C2.6 + C2.7 (the menu, the info panel) never have to touch a file of the pane. Pinned by reading the source — the way
 * `chat-viewport-hook.test.ts` pins the viewport's configuration — because a unit test cannot run the scroll.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}
const paneFiles = [...walk("src/components/chat/v2/pane"), ...walk("src/components/chat/v2/bubble"), "src/components/chat/v2/message-bubble.tsx", ...walk("src/lib/chat/v2/pane")];

describe("the four seams", () => {
  it("one context holds reply, editing, forward, delete, pin, jumpTo, openSearch and the info panel — and its commands never change identity", () => {
    const src = read("src/components/chat/v2/pane/pane-actions.tsx");
    for (const name of ["reply", "editing", "forwarding", "startForward", "remove", "pin", "jumpTo", "openSearch", "openInfo", "closeInfo", "toggleInfo", "infoOpen", "searchOpen", "usePaneActions", "usePaneCommands"]) {
      expect(src, name).toContain(name);
    }
    // the commands are made ONCE (a useMemo with no state in its dependencies), the state is a separate context
    expect(src).toMatch(/const commands = React\.useMemo<PaneCommands>\(/);
    expect(src).toMatch(/\}, \[qc, conversationId\]\);/);
    expect(src).toContain("StateContext");
    expect(src).toContain("CommandsContext");
  });

  it("the composer host renders today's ChatComposer with the optimistic bubble, the outbox, the reply / edit state and the restore", () => {
    const src = read("src/components/chat/v2/pane/seams/composer-host.tsx");
    expect(src).toContain("<ChatComposer");
    expect(src).toContain("optimistic={{ qc }}");
    expect(src).toContain("outbox={outbox}");
    expect(src).toContain("restore={a.restore}");
    expect(src).toContain("editing={a.editing}");
    expect(src).toContain("composerBarOf(");
    expect(src).toContain("useOutbox(header.me.id, outboxOn)");
  });

  it("the menu host renders today's MessageMenu from the registry and takes the context from the same function the old bubble uses", () => {
    const src = read("src/components/chat/v2/pane/seams/menu-host.tsx");
    expect(src).toContain("<MessageMenu");
    expect(src).toContain("messageMenuContext(message, facts)");
    // the registry stays the ONE source: no list of menu ids is written down here
    expect(src).not.toContain("messageMenuItems");
    expect(src).not.toMatch(/\["reply",\s*"pin"/);
  });

  it("the info host renders nothing yet and takes only the header", () => {
    const src = read("src/components/chat/v2/pane/seams/info-host.tsx");
    expect(src).toMatch(/export function InfoHost\(_props: \{ header: ConversationHeaderDto \}\) \{\s*return null;/);
  });

  it("each seam's component is imported by its own host and by nobody else in the pane", () => {
    // a TYPE import (the shape of «عدّل»'s restore) is not a use of the component
    const users = (needle: RegExp) => paneFiles.filter((f) => needle.test(read(f).replace(/^import type .*$/gm, "")) && !f.endsWith("seams/composer-host.tsx") && !f.endsWith("seams/menu-host.tsx"));
    expect(users(/from "@\/components\/chat\/composer\/chat-composer"/)).toEqual([]);
    expect(users(/from "@\/components\/chat\/message\/message-menu"/).filter((f) => !f.endsWith("use-long-press.ts"))).toEqual([]);
    expect(users(/from "@\/components\/chat\/message\/message-dialogs"/)).toEqual([]);
  });

  it("the pane root is `relative` with data-chat-pane-root and lists the composer host as ITS child; the pane never imports the old screen or MessageItem", () => {
    const pane = read("src/components/chat/v2/pane/conversation-pane.tsx");
    expect(pane).toContain("data-chat-pane-root");
    expect(pane).toMatch(/data-pane-state="ready" className="relative flex/);
    expect(pane).toContain("<ComposerHost");
    for (const file of paneFiles) {
      const src = read(file);
      expect(src, file).not.toMatch(/conversation\/conversation-screen/);
      expect(src, file).not.toMatch(/import \{[^}]*\bMessageItem\b[^}]*\} from/);
    }
  });
});

describe("the rules of C1 that the pane keeps and does not copy", () => {
  it("a pending message is drawn through PendingBubble with retry / discard — never through the bubble", () => {
    const row = read("src/components/chat/v2/pane/viewport-row.tsx");
    expect(row).toMatch(/isPendingMessage\(message\)/);
    expect(row).toContain("outboxItemOfPending(");
    expect(row).toContain("<PendingBubble");
    const viewport = read("src/components/chat/v2/pane/message-viewport.tsx");
    expect(viewport).toContain("retryPending(");
    expect(viewport).toContain("discardPending(");
  });

  it("the read mark goes through createReadMarker with the newest CONFIRMED message, silent for oversight, and forgets the conversation on close", () => {
    const hook = read("src/lib/chat/v2/pane/use-read-marking.ts");
    expect(hook).toContain("createReadMarker(");
    expect(hook).toContain("newestToConsider(s)");
    expect(hook).toMatch(/silent: s\.silent/);
    expect(hook).toMatch(/marker\.forget\(id\)/);
    expect(hook).toContain("marker.resume()");
    const viewport = read("src/components/chat/v2/pane/message-viewport.tsx");
    expect(viewport).toContain("silent: header.me.oversight");
    // «at the bottom» for the mark is the REAL geometry (the first report after the landing), not the hook's optimistic first value
    expect(viewport).toContain("atBottom: nearBottom === true");
  });

  it("the viewport and the history are the C1 hooks, the rows fold the calls, and today's onNewest / isAtBottom rules are imported, not rewritten", () => {
    const viewport = read("src/components/chat/v2/pane/message-viewport.tsx");
    expect(viewport).toContain("useMessageViewport(");
    expect(viewport).toContain("foldCalls: true");
    expect(viewport).toMatch(/import \{ isAtBottom \} from "@\/lib\/chat\/conversation\/client"/);
    const pane = read("src/components/chat/v2/pane/conversation-pane.tsx");
    expect(pane).toContain("useConversationHistory(");
    expect(pane).toContain("useChatHeader(");
    for (const file of paneFiles) {
      expect(read(file), file).not.toMatch(/function (?:onNewest|isAtBottom)\b|STICK_PX\s*=/);
    }
  });

  it("the header, the history and the people are asked for at once: the messages do not wait for the header", () => {
    const pane = read("src/components/chat/v2/pane/conversation-pane.tsx");
    const top = pane.slice(pane.indexOf("export function ConversationPane("));
    expect(top.indexOf("useChatHeader(")).toBeLessThan(top.indexOf("useConversationHistory("));
    expect(top.indexOf("useConversationHistory(")).toBeLessThan(top.indexOf("<PaneBody"));
  });

  it("the new screen reads the C1.2 endpoints only through the cache hooks (no fetch of the header, the messages, the list or the sync feed)", () => {
    for (const file of paneFiles) {
      const src = read(file);
      expect(src, file).not.toMatch(/conversationHeaderUrl|conversationMessagesUrl|chatListUrl|chatSyncUrl|\/api\/chat\/list|\/api\/chat\/sync|\/header`|\/messages\?/);
    }
  });
});

describe("what the review of this package found", () => {
  it("«🎫 مشكلة» from the menu or the suggestion chip opens the form as the old screen did (no customer filled in); only the customer-data hint passes one", () => {
    const host = read("src/components/chat/v2/pane/seams/menu-host.tsx");
    expect(host).not.toContain("findCustomerNumbers");
    expect(host).toMatch(/customer: opts\.customer \?\? null/);
    const row = read("src/components/chat/v2/pane/viewport-row.tsx");
    expect(row).toMatch(/dialogs\.problem\(m, \{ customer: findCustomerNumbers/);
    expect(row).toMatch(/dialogs\.problem\(m, \{ kindKey \}\)/);
  });

  it("the call button is the old one's rule (shown for whoever may start a call or join one that is going), and the call bar is not hidden from a person who cannot start", () => {
    const header = read("src/components/chat/v2/pane/pane-header.tsx");
    expect(header).toContain("canStart={header.me.canPost && header.me.canCall !== false}");
    const pane = read("src/components/chat/v2/pane/conversation-pane.tsx");
    expect(pane).toContain("enabled={header.calls !== false}");
  });

  it("the live call is asked for through a latest-only guard (a slow old answer never overwrites a newer one)", () => {
    expect(read("src/components/chat/v2/pane/call-bar.tsx")).toContain("latestGuard()");
  });

  it("the people are asked for once the header says how many there are, and again when that number changes", () => {
    const hook = read("src/lib/chat/v2/pane/use-people.ts");
    expect(hook).toMatch(/export const peopleKey = \(id: string, count: number \| undefined\)/);
    expect(hook).toContain("enabled: !!id && count !== undefined");
    expect(read("src/components/chat/v2/pane/conversation-pane.tsx")).toContain("usePeople(conversationId, headerQuery.data?.memberCount)");
  });

  it("the rows do not hold the messages: the run flags are given per row, so a new message does not draw every row again", () => {
    const env = /export interface RowEnv \{[\s\S]*?\n\}/.exec(read("src/components/chat/v2/pane/viewport-row.tsx"))![0];
    expect(env).not.toMatch(/\bmessages\b/);
    const viewport = read("src/components/chat/v2/pane/message-viewport.tsx");
    expect(viewport).toContain("start={flags.start} end={flags.end}");
    expect(viewport).toContain("stableReaders(");
  });

  it("an attachment that is not on our own address is a plain word, never a link that goes nowhere", () => {
    expect(read("src/components/chat/v2/bubble/bubble-media.tsx")).not.toContain('href="#"');
  });

  it("«لخّصلي» in the menu presses the button the digest package owns by its own mark, and that mark is still there", () => {
    expect(read("src/components/chat/v2/pane/pane-header.tsx")).toContain("[data-topic-summary]");
    expect(read("src/components/digest/topic-summary-button.tsx")).toContain("data-topic-summary");
  });
});

describe("what the pane takes from the server's side and what it records as not there", () => {
  it("nothing in the pane writes a chat cache key directly (the writer and the sync do)", () => {
    for (const file of paneFiles) expect(read(file), file).not.toMatch(/setQuer(?:y|ies)Data/);
  });

  it("no per-person mute is drawn: «اكتم الإشعارات» has no door before C3a", () => {
    // the code, not its comments (a comment may say what is NOT drawn)
    const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const file of paneFiles) expect(code(read(file)), file).not.toMatch(/اكتم الإشعارات|["'`]mute["'`]|menu\.mute/i);
  });
});
