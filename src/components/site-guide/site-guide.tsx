"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Compass, Mic, PhoneCall, PhoneOff, Send, Square, X } from "lucide-react";
import { ApiError, apiPost } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { MAX_HISTORY_TURNS, MAX_STEPS_PER_ASK, type GuideAction } from "@/lib/site-guide/rules";
import { GUIDE_ATTR, readPage } from "@/components/site-guide/page-reader";
import { clearHighlight, highlight, judge, nameOfControl, typeInto, type Verdict } from "@/components/site-guide/executor";
import { canListen, listenOnce, speak, stopSpeaking, type Listener } from "@/components/site-guide/voice";

/**
 * «المرشد» — the owner's guide, as a floating button and a small panel (src/server/services/site-guide.ts is the other half).
 *
 * One ask is a short loop: read the page → ask the server for the next step → do it here → read the page again, at most 8 steps. Going to a
 * page and pointing at something happen by themselves; a CLICK or a TYPING waits for the owner's «نفّذ» (and a sensitive control is refused
 * outright). «وقّف» ends the loop and the voice at once. The call button turns the microphone on and speaks the answers (the browser's own
 * voice): it listens, answers aloud, listens again, until «أنهِ المكالمة».
 */

type Line = { role: "user" | "assistant" | "note"; text: string };
interface StepResult {
  say: string;
  actions: GuideAction[];
  done: boolean;
}
interface Pending {
  action: GuideAction;
  question: string;
  decide: (yes: boolean) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function SiteGuide({ enabled }: { enabled: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [calling, setCalling] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [interim, setInterim] = useState("");
  const stopRef = useRef(false);
  const callingRef = useRef(false);
  const listenerRef = useRef<Listener | null>(null);
  const registryRef = useRef<Map<string, HTMLElement>>(new Map());
  const historyRef = useRef<{ role: "user" | "assistant"; text: string }[]>([]);
  const pathRef = useRef(pathname);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const listenCanStart = typeof window !== "undefined" && canListen();

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines, pending, interim]);
  useEffect(
    () => () => {
      stopRef.current = true;
      listenerRef.current?.stop();
      stopSpeaking();
      clearHighlight();
    },
    [],
  );

  const push = useCallback((line: Line) => setLines((old) => [...old, line].slice(-40)), []);

  const refusal = (v: Extract<Verdict, { ok: false }>) => t(`siteGuide.refused.${v.reason}`);

  /** Asks the owner before a click or a typing; resolves with his answer. */
  const confirm = useCallback(
    (action: GuideAction, question: string) =>
      new Promise<boolean>((resolve) => {
        setPending({ action, question, decide: (yes) => { setPending(null); resolve(yes); } });
      }),
    [],
  );

  /** Notes and boxes on the whiteboard page the owner is on: only where the board is open and he may draw, and only after his «نفّذ». */
  const writeBoard = async (action: Extract<GuideAction, { type: "board" }>): Promise<string> => {
    const bridge = window.__zakiBoard;
    if (!bridge || !bridge.canDraw) {
      push({ role: "note", text: t("siteGuide.refused.board") });
      return "board refused (no board)";
    }
    const question = t("siteGuide.ask_board", { count: action.items.length });
    if (callingRef.current) void speak(question);
    if (!(await confirm(action, question)) || stopRef.current) {
      push({ role: "note", text: t("siteGuide.did_skip") });
      return "board skipped by the owner";
    }
    const n = await bridge.write(action.items);
    push({ role: "note", text: t("siteGuide.did_board", { count: n }) });
    return `board written (${n})`;
  };

  const perform = useCallback(
    async (action: GuideAction): Promise<string> => {
      if (action.type === "navigate") {
        const verdict = judge(action, undefined);
        if (!verdict.ok) {
          push({ role: "note", text: refusal(verdict) });
          return `navigate refused (${verdict.reason})`;
        }
        const before = pathRef.current;
        router.push(action.path);
        for (let i = 0; i < 20 && pathRef.current === before; i += 1) await sleep(150);
        await sleep(500);
        push({ role: "note", text: t("siteGuide.moved", { path: action.path }) });
        return `moved to ${action.path}`;
      }
      if (action.type === "board") return writeBoard(action);
      const el = registryRef.current.get(action.ref);
      const verdict = judge(action, el);
      if (!verdict.ok || !el) {
        push({ role: "note", text: verdict.ok ? t("siteGuide.refused.gone") : refusal(verdict) });
        return `${action.ref} refused (${verdict.ok ? "gone" : verdict.reason})`;
      }
      if (action.type === "highlight") {
        highlight(el, action.note);
        await sleep(1200);
        return `${action.ref} pointed`;
      }
      const name = nameOfControl(el) || action.ref;
      highlight(el, "");
      const question = action.type === "click" ? t("siteGuide.ask_click", { name }) : t("siteGuide.ask_type", { name, text: action.text });
      if (callingRef.current) void speak(question);
      const yes = await confirm(action, question);
      clearHighlight();
      if (!yes || stopRef.current) {
        push({ role: "note", text: t("siteGuide.did_skip") });
        return `${action.ref} skipped by the owner`;
      }
      // the control may have changed while he was deciding: judge again
      const again = judge(action, el);
      if (!again.ok) {
        push({ role: "note", text: refusal(again) });
        return `${action.ref} refused (${again.reason})`;
      }
      if (action.type === "click") {
        el.click();
        push({ role: "note", text: t("siteGuide.did_click", { name }) });
        await sleep(700);
        return `${action.ref} clicked`;
      }
      typeInto(el, action.text);
      push({ role: "note", text: t("siteGuide.did_type", { name }) });
      return `${action.ref} typed`;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [confirm, push, router, t],
  );

  const errorText = (err: unknown): string => {
    if (err instanceof ApiError) {
      if (err.messageKey === "assistant.no_key" || err.messageKey === "assistant.no_local") return t("siteGuide.err.no_key");
      if (err.status === 429) return err.messageKey === "siteguide.rate_limited" ? t("siteGuide.err.rate_limited") : t("siteGuide.err.limit");
    }
    return t("siteGuide.error");
  };

  const ask = useCallback(
    async (message: string) => {
      setBusy(true);
      stopRef.current = false;
      push({ role: "user", text: message });
      let results: string[] = [];
      let first: string | undefined = message;
      try {
        for (let step = 0; step < MAX_STEPS_PER_ASK && !stopRef.current; step += 1) {
          await sleep(step === 0 ? 0 : 350);
          const page = readPage();
          registryRef.current = page.registry;
          const res = await apiPost<StepResult>("/api/site-guide/step", {
            ...(first ? { message: first } : {}),
            history: historyRef.current.slice(-MAX_HISTORY_TURNS),
            snapshot: page.snapshot,
            ...(results.length > 0 ? { results } : {}),
            step,
          });
          if (first) historyRef.current.push({ role: "user", text: first });
          first = undefined;
          if (res.say) {
            push({ role: "assistant", text: res.say });
            historyRef.current.push({ role: "assistant", text: res.say });
            if (callingRef.current) await speak(res.say);
            else void speak("");
          }
          if (res.actions.length === 0 || res.done) break;
          results = [];
          for (const action of res.actions) {
            if (stopRef.current) break;
            results.push(await perform(action));
            if (action.type === "navigate") break;
          }
        }
      } catch (err) {
        const msg = errorText(err);
        push({ role: "note", text: msg });
        if (callingRef.current) await speak(msg);
      } finally {
        historyRef.current = historyRef.current.slice(-MAX_HISTORY_TURNS);
        // the last pointing stays on screen for its few seconds (it clears itself): that is what the answer was about
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perform, push, t],
  );

  const listenNext = useCallback(() => {
    if (!callingRef.current) return;
    setHearing(true);
    const listener = listenOnce({
      onInterim: setInterim,
      onText: (said) => {
        setInterim("");
        void ask(said).then(() => {
          if (callingRef.current && !stopRef.current) listenNext();
        });
      },
      onEnd: (reason) => {
        setHearing(false);
        setInterim("");
        // a silence ends one listening: start again while the call lasts and nothing is being answered
        if (callingRef.current && !stopRef.current && reason !== "not-allowed" && reason !== "service-not-allowed") window.setTimeout(() => { if (callingRef.current && !busyRef.current) listenNext(); }, 400);
        else if (reason === "not-allowed" || reason === "service-not-allowed") endCall();
      },
    });
    listenerRef.current = listener;
    if (!listener) endCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const endCall = useCallback(() => {
    callingRef.current = false;
    setCalling(false);
    setHearing(false);
    setInterim("");
    listenerRef.current?.stop();
    stopSpeaking();
  }, []);

  const startCall = () => {
    if (!listenCanStart) {
      push({ role: "note", text: t("siteGuide.voice_unsupported") });
      return;
    }
    callingRef.current = true;
    stopRef.current = false;
    setCalling(true);
    listenNext();
  };

  const stopAll = () => {
    stopRef.current = true;
    pending?.decide(false);
    endCall();
    clearHighlight();
    push({ role: "note", text: t("siteGuide.stopped") });
  };

  const submit = () => {
    const message = text.trim();
    if (!message || busy) return;
    setText("");
    void ask(message);
  };

  if (!enabled) return null;

  return (
    <div {...{ [GUIDE_ATTR]: "root" }} dir="rtl">
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("siteGuide.open")}
          className="fixed bottom-[calc(3.5rem+0.75rem+env(safe-area-inset-bottom))] start-3 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-fg shadow-card hover:bg-surface-2 md:bottom-5"
        >
          <Compass className="h-6 w-6 text-info" aria-hidden="true" />
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-label={t("siteGuide.title")}
          className="fixed bottom-[calc(3.5rem+0.5rem+env(safe-area-inset-bottom))] start-2 z-50 flex max-h-[70vh] w-[min(24rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-card md:bottom-4"
        >
          <header className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Compass className="h-5 w-5 text-info" aria-hidden="true" />
            <h2 className="text-sm font-semibold">{t("siteGuide.title")}</h2>
            <span className="ms-auto flex items-center gap-1">
              {listenCanStart && (
                <button
                  type="button"
                  onClick={calling ? endCall : startCall}
                  aria-label={calling ? t("siteGuide.call_stop") : t("siteGuide.call_start")}
                  title={calling ? t("siteGuide.call_stop") : t("siteGuide.call_start")}
                  className={`flex h-8 w-8 items-center justify-center rounded-full ${calling ? "bg-danger/15 text-danger" : "text-fg hover:bg-surface-2"}`}
                >
                  {calling ? <PhoneOff className="h-4 w-4" aria-hidden="true" /> : <PhoneCall className="h-4 w-4" aria-hidden="true" />}
                </button>
              )}
              <button type="button" onClick={() => { endCall(); clearHighlight(); setOpen(false); }} aria-label={t("siteGuide.close")} className="flex h-8 w-8 items-center justify-center rounded-full text-fg hover:bg-surface-2">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </span>
          </header>
          <div className="min-h-[8rem] flex-1 space-y-2 overflow-y-auto px-3 py-2 text-sm" aria-live="polite">
            {lines.length === 0 && <p className="text-fg-muted">{t("siteGuide.empty")}</p>}
            {lines.map((l, i) => (
              <p key={i} className={l.role === "user" ? "rounded-xl bg-info/10 px-3 py-1.5" : l.role === "assistant" ? "rounded-xl bg-surface-2 px-3 py-1.5" : "text-xs text-fg-muted"}>
                {l.text}
              </p>
            ))}
            {interim && <p className="text-xs text-fg-muted">{interim}</p>}
            {busy && !pending && <p className="text-xs text-fg-muted">{t("siteGuide.thinking")}</p>}
            {hearing && !busy && <p className="text-xs text-info">{t("siteGuide.listening")}</p>}
            {pending && (
              <div className="rounded-xl border border-warn/40 bg-warn/10 p-2">
                <p>{pending.question}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => pending.decide(true)} className="rounded-lg bg-accent px-3 py-1 text-sm text-accent-fg">{t("siteGuide.run")}</button>
                  <button type="button" onClick={() => pending.decide(false)} className="rounded-lg border border-border px-3 py-1 text-sm">{t("siteGuide.skip")}</button>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <p className="border-t border-border px-3 py-1 text-xs text-fg-muted">{t("siteGuide.note")}</p>
          <form
            className="flex items-center gap-2 border-t border-border p-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("siteGuide.placeholder")}
              maxLength={1500}
              className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm"
            />
            {busy || calling ? (
              <button type="button" onClick={stopAll} aria-label={t("siteGuide.stop")} className="flex h-9 w-9 items-center justify-center rounded-full bg-danger/15 text-danger">
                <Square className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : (
              <>
                {listenCanStart && (
                  <button
                    type="button"
                    onClick={() => {
                      const l = listenOnce({ onText: (said) => void ask(said), onEnd: () => setHearing(false) });
                      listenerRef.current = l;
                      setHearing(l !== null);
                    }}
                    aria-label={t("siteGuide.mic")}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-fg hover:bg-surface-2"
                  >
                    <Mic className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
                <button type="submit" disabled={!text.trim()} aria-label={t("siteGuide.send")} className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-40">
                  <Send className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
          </form>
        </section>
      )}
    </div>
  );
}
