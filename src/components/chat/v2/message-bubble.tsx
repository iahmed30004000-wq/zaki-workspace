"use client";

import React from "react";
import { Check } from "lucide-react";
import type { MessageDto, ReaderDto } from "@/server/chat/dto";
import { Avatar } from "@/components/ui/avatar";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { CardBubble } from "@/components/chat/message/card-bubble";
import { OrderCardBubble } from "@/components/chat/message/order-state-card";
import { PollCard } from "@/components/chat/message/poll-card";
import { MessageTranslation, useTranslation } from "@/components/chat/message/message-translation";
import { ReaderRow, customerHintOf, suggestedProblemKind } from "@/components/chat/message/message-item";
import { BubbleBody } from "@/components/chat/v2/bubble/bubble-body";
import { CustomerHint, LinkPreviewCard, MustReadBlock, ProblemSuggestion, WorkChips } from "@/components/chat/v2/bubble/bubble-extras";
import { BubbleMedia } from "@/components/chat/v2/bubble/bubble-media";
import { BubbleFooter, ForwardedHeader, ReactionChips, ReplyBlock } from "@/components/chat/v2/bubble/bubble-parts";
import { useLongPress } from "@/components/chat/v2/bubble/use-long-press";
import { ReactionPop } from "@/components/chat/v2/phone/reaction-pop";
import { ReactorsSheet } from "@/components/chat/v2/menu/reactors-sheet";
import { useBubbleGestures } from "@/components/chat/v2/menu/gesture-context";
import { useOpenForwardSource } from "@/components/chat/v2/forward/use-open-forward-source";
import "@/components/chat/v2/phone/tg-messages.css";
import { flyReaction } from "@/components/chat/v2/phone/message-fx";
import { useTgPhone, useTgPhoneOn } from "@/components/shell/tg-phone";
import { selectionStore, useSelectionEnabled } from "@/lib/chat/selection";
import { ct } from "@/lib/chat/text";
import type { Rect } from "@/lib/chat/v2/menu/phone-menu";
import { longPressDoes, opensMenuOnTap } from "@/lib/chat/v2/phone/message-gestures";
import { withPendingReaction } from "@/lib/chat/v2/phone/reaction-flight";
import { requestSettle } from "@/lib/chat/v2/phone/removals";
import { hapticTick } from "@/lib/chat/v2/phone/swipe-reply";
import { effectOn } from "@/lib/motion/effects";
import { replyOnDoubleClick } from "@/lib/chat/v2/menu/gestures";
import { TG_MOTION, isFreshArrival, tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { touchTap, type TapPoint } from "@/lib/chat/v2/menu/quick-reactions";
import { pressInlineButton, type InlineKind } from "@/lib/chat/v2/menu/inline-press";
import type { BubbleFacts } from "@/lib/chat/v2/pane/bubble-facts";
import { bigEmojiAlone, bubbleClass, bubbleRun, mentionsMeOf, nameTone, showsSender } from "@/lib/chat/v2/pane/bubble-model";
import { cn } from "@/lib/utils";

/** «تيليجرام على التلفون»: what the tap menu asks of the bubble it opens from. */
export interface BubblePhoneApi {
  anchorRect: () => Rect | null;
  openedBy: () => TapPoint | null;
  doubleTap: () => void;
  /** a new reaction of mine is on its way: its pill is drawn at once, the bubble grows and the emoji flies in from `from`; returns the way back (the server refused) */
  expectReaction: (emoji: string, from: Rect | null) => () => void;
}

/** A pill drawn ahead of the server is taken back if no answer shows it. */
const PENDING_REACTION_MS = 8000;
const useBrowserLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export interface MessageMenuSlotApi {
  /** only while «تيليجرام على التلفون» is on and the screen is a phone's */
  phone?: BubblePhoneApi;
  message: MessageDto;
  /** the phone's long press opened the menu as a sheet */
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  /** «ترجم»: the translation shows under the words IN THIS bubble (its state lives here), so the menu asks the bubble */
  translate: () => void;
  /** a right click (computer) opened the menu: the bubble owns the gesture, the menu draws it */
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  /** who read up to this message (a topic or a group): «مين شاف» lists them */
  readers: ReaderDto[];
  /** «اقرأ النص» / «حوّل الصوت لنص»: presses the button the picture or the voice note draws under itself (the doors and the result live there) */
  pressInline: (kind: InlineKind) => void;
}

/** C3b.5 («حدّد»): the selection as ONE bubble sees it — selecting now, this message is picked, and how a press toggles it. */
export interface BubbleSelect {
  on: boolean;
  selected: boolean;
  toggle: (messageId: string) => void;
}

export interface MessageBubbleProps {
  message: MessageDto;
  conversationId: string;
  /** what the conversation says about me and the switches (one object per header, so a bubble that did not change does not draw again) */
  facts: BubbleFacts;
  /** the first / last bubble of a run by one person: the name sits on the first, the picture and the tail on the last */
  start: boolean;
  end: boolean;
  /** the names «@» can point at here, for the highlighted mentions */
  mentionNames: readonly string[];
  readers?: ReaderDto[];
  /** the target of a jump, for two seconds */
  highlighted?: boolean;
  /**
   * SEAM (C2.6's): the message menu. The pane passes the registry's menu from `seams/menu-host.tsx`; the bubble only decides WHERE it sits and whether
   * it may exist (never on a deleted message, a system line, or while the owner reads silently).
   */
  menu?: (api: MessageMenuSlotApi) => React.ReactNode;
  /** SEAM (C2.6's): the small actions that appear on hover (a quick reaction, «↩»). Nothing is drawn when absent. */
  hover?: React.ReactNode;
  /**
   * C3b.5: while the person is selecting messages, a check sits at the start of each one that can be picked, a press anywhere on the row toggles it, and the menu, the
   * hover buttons, the long press and the double-click gestures are off. Absent (or `on: false`): the bubble is as it was.
   */
  select?: BubbleSelect;
  onReact: (message: MessageDto, emoji: string) => void;
  /** a reply block was pressed: jump to the message it answers */
  onJump: (messageId: string) => void;
  onAck?: (message: MessageDto, on: boolean) => void;
  onOpenWork?: (kind: "task" | "ticket", id: string) => void;
  onHintTicket?: (message: MessageDto) => void;
  onSuggestProblem?: (message: MessageDto, kindKey: string) => void;
}

/**
 * C2.4 — ONE MESSAGE of the new screen, built from `message-item.tsx`'s LOGIC (the rules are the same functions: `customerHintOf`, `suggestedProblemKind`,
 * the menu context in `menu-host.tsx`) and drawn the Telegram way:
 *
 *  - mine at the inline end, the others at the start; the sender's picture at the bottom of a run and his name — coloured by `avatarHue` — on the first
 *    bubble of a run, in topics and groups only;
 *  - a tail on the LAST bubble of a run (`rounded-ee-sm` mine, `rounded-es-sm` the others);
 *  - inside, in order: the forwarded header, the reply block, «ذكروك»; the words (mentions highlighted, order numbers as chips) or the deleted line;
 *    the translation; the poll or the card; the files; the Q1 chips, must-read and hints; the reactions; the footer;
 *  - a message that mentions me keeps the warn tint; a jump's target gets a ring.
 *
 * A pending message (the id starts with `pending:`) and a system line are NEVER drawn here: the viewport draws them through `PendingBubble` and
 * `ServiceLine` — a menu on a message the server does not have would act on an id it does not know.
 */
function MessageBubbleView({ message, conversationId, facts, start, end, mentionNames, readers = [], highlighted = false, menu, hover, select, onReact, onJump, onAck, onOpenWork, onHintTicket, onSuggestProblem }: MessageBubbleProps) {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  // S5.6: «مين تفاعل» — the chip that was long-pressed (or right-clicked); the sheet is drawn BESIDE the article, never inside it
  const [who, setWho] = React.useState<{ emoji: string } | null>(null);
  const articleRef = React.useRef<HTMLElement>(null);
  // C2.8: a bubble that mounts within seconds of its message being written has just ARRIVED: it fades up (120 ms). Decided once, at mount: a re-render never
  // replays it, and opening a chat or scrolling up (old messages) draws none. Off under reduced motion (the class below).
  const [fresh] = React.useState(() => isFreshArrival(message.createdAt, Date.now()));
  // what the last press on this bubble was made with: a right click or a double click is the computer's, a finger's long press is the sheet's
  const pointer = React.useRef("");
  // C4.1: the phone's double tap (two quick taps of a finger) is the person's quick reaction; `touchTap` is the pure tracker over the taps of THIS bubble
  const lastTap = React.useRef<TapPoint | null>(null);
  const downAt = React.useRef(0);
  const gestures = useBubbleGestures();
  const translation = useTranslation(message.id);
  // S5.2: the «محوّلة من» header is a button: the server says where the original is (only when I may read it)
  const openForwardSource = useOpenForwardSource(conversationId, onJump);
  const canAct = !facts.oversight && !message.deleted && message.kind !== "SYSTEM";
  // C3b.5: while selecting, a press anywhere on the row picks it: the bubble takes no pointer (so its long press and double-click gestures never start) and draws no menu or hover buttons
  const selecting = select?.on === true && canAct;
  // «تيليجرام على التلفون» (`tgPhone`): `tgLook` is the switch alone (markup the server draws too, paired with `max-md:`), `tg` the switch on a phone (gestures)
  const tgLook = useTgPhoneOn();
  const tg = useTgPhone();
  const canSelect = useSelectionEnabled();
  const longFired = React.useRef(false);
  const downSpot = React.useRef<{ x: number; y: number } | null>(null);
  const openedBy = React.useRef<TapPoint | null>(null);
  const longPress = useLongPress(canAct, () => {
    // the click of the finger lifting after a long press is not a tap
    longFired.current = true;
    openedBy.current = null;
    if (longPressDoes({ phone: tg, canSelect }) === "select") {
      hapticTick();
      selectionStore.begin(message.id);
    } else setSheetOpen(true);
  });
  // a bubble that was on screen when the selection began shows its circle growing in (one that scrolls into view later is simply there)
  const [enteredPlain] = React.useState(() => !selecting);
  // the reaction on its way: its pill is drawn before the server answers, and the bubble grows to hold it
  const [pending, setPending] = React.useState<string | null>(null);
  const grownFrom = React.useRef(0);
  React.useEffect(() => {
    if (pending === null) return;
    if (message.reactions.some((r) => r.mine && r.emoji === pending)) return setPending(null);
    const giveUp = setTimeout(() => setPending(null), PENDING_REACTION_MS);
    return () => clearTimeout(giveUp);
  }, [pending, message.reactions]);
  useBrowserLayoutEffect(() => {
    const article = articleRef.current;
    const from = grownFrom.current;
    grownFrom.current = 0;
    if (!article || !from || pending === null || article.offsetHeight <= from || !effectOn("transitions") || typeof article.animate !== "function") return;
    // never squeezed by more than a little: the words must not look stretched while the bubble grows
    article.animate(
      [
        { transform: `scaleY(${Math.max(from / article.offsetHeight, 0.85)})`, transformOrigin: "50% 0" },
        { transform: "scaleY(1)", transformOrigin: "50% 0" },
      ],
      { duration: TG_MOTION.bubbleGrowMs, easing: "ease-out" },
    );
  }, [pending]);
  const reactions = pending === null || message.deleted ? message.reactions : withPendingReaction(message.reactions, pending);
  const shownMessage = reactions === message.reactions ? message : { ...message, reactions };
  const phone: BubblePhoneApi | undefined = tg
    ? {
        anchorRect: () => articleRef.current?.getBoundingClientRect() ?? null,
        openedBy: () => openedBy.current,
        doubleTap: () => gestures?.quickReact?.(message, facts),
        expectReaction: (emoji, from) => {
          grownFrom.current = articleRef.current?.offsetHeight ?? 0;
          requestSettle(TG_MOTION.bubbleGrowMs);
          setPending(emoji);
          const start = from ?? articleRef.current?.getBoundingClientRect();
          if (start) flyReaction(emoji, start, () => articleRef.current?.querySelector<HTMLElement>(`[data-reaction-chip="${emoji}"]`) ?? null);
          return () => setPending(null);
        },
      }
    : undefined;
  // a single emoji by itself is not put in a bubble on the phone: it stands big, with its time on a small pill
  const bare = tgLook && bigEmojiAlone(message);
  const mine = message.mine;
  const mentionsMe = mentionsMeOf(message, facts.meId);
  const sender = showsSender(mine, facts.conversationKind);
  const chips = facts.canOrderState && message.kind === "TEXT";
  const suggestKind = suggestedProblemKind(message, { canProblem: facts.canProblem, problemRules: facts.problemRules, conversationId });
  const hint = customerHintOf(message, { orderHints: facts.orderHints, canModerate: facts.canModerate, canProblem: facts.canProblem });
  const menuNode = canAct && !selecting && menu ? menu({ message, sheetOpen, setSheetOpen, translate: () => void translation.ask(), menuOpen, setMenuOpen, readers, pressInline: (kind) => pressInlineButton(articleRef.current, kind), ...(phone ? { phone } : {}) }) : null;
  const hoverNode = canAct && !selecting && hover ? hover : null;

  return (
    <div
      className={cn("group relative flex", mine ? "justify-end" : "justify-start", selecting && "cursor-pointer rounded-lg ps-9", selecting && select?.selected && "bg-accent/[0.08]")}
      data-message-row={mine ? "mine" : "other"}
      data-run={bubbleRun(start, end)}
      {...(tg
        ? {
            onPointerDownCapture: () => {
              longFired.current = false;
            },
            onClickCapture: (e: React.MouseEvent) => {
              if (!longFired.current) return;
              longFired.current = false;
              e.preventDefault();
              e.stopPropagation();
            },
          }
        : {})}
      {...(tg && selecting ? { style: tgMotionVars(["selectionCheckMs"]) as React.CSSProperties } : {})}
      {...(selecting ? { onClick: () => select?.toggle(message.id), ...(select?.selected ? { "data-selected": "" } : {}) } : {})}
    >
      {selecting ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={select?.selected === true}
          aria-label={ct("chatsel.check")}
          data-select-check
          className={cn("absolute inset-y-0 start-1.5 my-auto grid size-6 place-items-center rounded-full border-2", select?.selected ? "border-accent bg-accent text-accent-fg" : "border-muted bg-surface", tg && enteredPlain && "zk-tg-check")}
        >
          {select?.selected ? <Check aria-hidden="true" className="size-4" /> : null}
        </button>
      ) : null}
      <div className={cn("flex min-w-0 max-w-full items-end gap-1.5", mine ? "flex-row-reverse" : "flex-row", selecting && "pointer-events-none", tg && selecting && enteredPlain && !mine && "zk-tg-make-room")}>
        {sender ? end ? <Avatar name={message.authorName} src={message.authorAvatar} className="mb-1 size-8 text-xs" /> : <span aria-hidden="true" className="size-8 shrink-0" /> : null}
        <div className={cn("flex min-w-0 flex-col", mine ? "items-end" : "items-start")}>
          <div className={cn("flex min-w-0 max-w-full items-end gap-1", mine ? "flex-row-reverse" : "flex-row")}>
            <article
              dir="rtl"
              ref={articleRef}
              data-message-id={message.id}
              onPointerDown={(e) => {
                pointer.current = e.pointerType;
                downSpot.current = { x: e.clientX, y: e.clientY };
                downAt.current = Date.now();
                longPress.onPointerDown(e);
              }}
              onPointerMove={longPress.onPointerMove}
              onPointerUp={(e) => {
                const tap = touchTap(lastTap.current, { pointerType: e.pointerType, target: e.target, at: Date.now(), x: e.clientX, y: e.clientY, downAt: downAt.current });
                lastTap.current = tap.last;
                if (canAct && gestures && tap.double) gestures.quickReact?.(message, facts);
                longPress.onPointerUp();
              }}
              onPointerCancel={longPress.onPointerCancel}
              {...(tg && menuNode
                ? {
                    // «تيليجرام على التلفون»: a TAP opens the menu (at once: a double tap's second half is caught by the menu's own layer)
                    onClick: (e: React.MouseEvent<HTMLElement>) => {
                      const from = downSpot.current;
                      const open = opensMenuOnTap({
                        inside: e.currentTarget.contains(e.target as Node),
                        target: e.target,
                        movedPx: from ? Math.hypot(e.clientX - from.x, e.clientY - from.y) : 0,
                        hasSelection: window.getSelection()?.isCollapsed === false,
                      });
                      if (!open) return;
                      openedBy.current = { at: Date.now(), x: e.clientX, y: e.clientY };
                      setSheetOpen(true);
                    },
                  }
                : {})}
              onContextMenu={(e) => {
                if (sheetOpen || longPress.pressing() || (tg && longFired.current)) e.preventDefault();
                // the right button on a computer (and the keyboard's menu key) opens the menu where the message is; a finger's long press is the sheet's, and
                // the browser's own menu stays for text that is selected
                else if (menuNode && pointer.current !== "touch" && !window.getSelection()?.toString()) {
                  e.preventDefault();
                  setMenuOpen(true);
                }
              }}
              onDoubleClick={(e) => {
                if (canAct && gestures && replyOnDoubleClick({ pointerType: pointer.current, target: e.target })) gestures.reply(message, facts);
              }}
              {...(bare ? { "data-tg-bare": "" } : {})}
              className={cn(bubbleClass({ mine, mentionsMe, tail: end, highlighted }), fresh && "animate-fade-up motion-reduce:animate-none", bare && "max-md:border-transparent max-md:bg-transparent max-md:px-0 max-md:text-fg max-md:shadow-none", tgLook && "max-md:max-w-[min(82vw,100%)]")}
            >
              {sender && start ? (
                <p data-sender className={cn("mb-0.5 truncate text-xs font-semibold", nameTone(message.authorName))}>
                  {message.authorName}
                  {/* S5.5: «موثّق» after the sender's name (the server sends `authorVerified` only to staff, only while the switch is on) */}
                  {message.authorVerified ? <VerifiedBadge className="ms-1 [&>svg]:size-3.5" /> : null}
                </p>
              ) : null}
              {message.forwardedFrom && !message.deleted ? <ForwardedHeader name={message.forwardedFrom.name} onOpen={() => openForwardSource(message.id)} /> : null}
              {message.replyTo ? <ReplyBlock replyTo={message.replyTo} onJump={onJump} /> : null}
              {mentionsMe ? (
                <span data-mentions-me className="mb-1 block text-xs font-semibold text-warn">
                  {ct("chatc.mention_me")}
                </span>
              ) : null}
              <BubbleBody message={message} mentionNames={mentionNames} conversationId={conversationId} orderChips={chips} formatting={facts.formatting} fresh={fresh} />
              {!message.deleted && <MessageTranslation state={translation.state} onHide={translation.hide} />}
              {!message.deleted ? <LinkPreviewCard preview={message.preview} enabled={facts.linkPreviews} /> : null}
              {message.poll && !message.deleted ? <PollCard messageId={message.id} poll={message.poll} /> : null}
              {message.card && !message.deleted ? message.card.type === "order" ? facts.canOrderState ? <OrderCardBubble number={message.card.number} conversationId={conversationId} /> : null : <CardBubble card={message.card} /> : null}
              {!message.deleted ? <BubbleMedia attachments={message.attachments} kind={message.kind} canTranscribe={facts.canTranscribe} canReadImages={facts.canReadImages} albums={facts.albums} mine={mine} /> : null}
              {message.work?.length ? <WorkChips work={message.work} onOpenWork={onOpenWork} /> : null}
              <MustReadBlock message={message} onAck={onAck} />
              <CustomerHint hint={hint} canProblem={facts.canProblem} onTicket={onHintTicket ? () => onHintTicket(message) : undefined} />
              {suggestKind && onSuggestProblem ? <ProblemSuggestion onSuggest={() => onSuggestProblem(message, suggestKind)} /> : null}
              <ReactionPop reactions={reactions}>
                <ReactionChips message={shownMessage} canAct={canAct} onReact={onReact} onWho={(emoji) => setWho({ emoji })} />
              </ReactionPop>
              <BubbleFooter message={message} singleTick={facts.saved} pill={bare} />
            </article>
            {hoverNode}
            {menuNode}
          </div>
          <ReaderRow readers={readers} />
          {who ? <ReactorsSheet open onOpenChange={(open) => (open ? undefined : setWho(null))} reactions={message.reactions} initial={who.emoji} /> : null}
        </div>
      </div>
    </div>
  );
}

export const MessageBubble = React.memo(MessageBubbleView);
