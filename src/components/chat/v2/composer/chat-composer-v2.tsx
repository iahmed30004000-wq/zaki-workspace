"use client";

import React from "react";
import { PollDialog } from "@/components/chat/composer/poll-dialog";
import { RecallDialog } from "@/components/chat/composer/recall-dialog";
import { FeedbackDialog } from "@/components/chat/v2/feedback/feedback-dialog";
import { ComposerSurface } from "@/components/chat/v2/composer/composer-surface";
import { BotFatherBar } from "@/components/chat/v2/composer/botfather-bar";
import { DropOverlay } from "@/components/chat/v2/composer/drop-overlay";
import { PasteSendDialog } from "@/components/chat/v2/composer/paste-dialog";
import { ReplyOptions } from "@/components/chat/v2/composer/reply-options";
import { StickerStrip } from "@/components/chat/v2/composer/sticker-strip";
import { useTgPhone } from "@/components/shell/tg-phone";
import { suggestedStickers } from "@/lib/chat/v2/composer/sticker-suggest";
import { replyQuoteStore } from "@/lib/chat/v2/phone/reply-quote";
import { zakiCode } from "@/lib/chat/zaki-emoji";
import { loadRecentEmoji, rememberEmoji } from "@/lib/chat/v2/composer/recent-emoji";
import { useComposer, type ComposerParams } from "@/lib/chat/v2/composer/use-composer";
import { useReplyQuote } from "@/lib/chat/v2/phone/reply-quote";

/**
 * C2.5 — THE COMPOSER OF THE NEW PANE (`chatLayoutV2`). It takes what `ChatComposer` takes (plus «↑»'s `editLast`) and wraps the same logic in `useComposer`:
 * the old component stays as it is for the old screen and the quick chat. It draws the surface, the dialogs it opens (the «/» menu with its «⚡», the poll, the
 * paste dialog) and the drop zones. The dialogs sit OUTSIDE the box's form: a dialog's own submit never reaches the composer's.
 */
export function ChatComposerV2(props: ComposerParams) {
  const c = useComposer(props);
  const { detail, conversationId, onMessage, editing, reply, onCancelReply, onCancelEdit } = props;
  const [recents, setRecents] = React.useState<string[]>([]);
  React.useEffect(() => setRecents(loadRecentEmoji()), []);
  // S5.7 «رد بالاقتباس»: the piece picked for the reply being written (the send takes it from the same store)
  const replyQuote = useReplyQuote(conversationId, reply?.id);
  const recording = c.voice.mode !== "idle";
  // «تيليجرام على التلفون»: our stickers over a box that holds one emoji, and «خيارات الرد» of the reply bar
  const tg = useTgPhone();
  const suggested = tg && detail.zakiEmojis !== false && !editing && !recording && c.files.length === 0 ? suggestedStickers(c.body) : [];
  const [replyOptions, setReplyOptions] = React.useState(false);
  React.useEffect(() => setReplyOptions(false), [reply?.id]);
  return (
    <>
      {detail.botFather && !editing ? <BotFatherBar text={c.body} started={detail.botFather.started} busy={c.busy} onSend={c.sendText} onType={c.onTextChange} /> : null}
      <StickerStrip ids={suggested} onPick={(id) => c.sendText(zakiCode(id))} />
      <ComposerSurface
        c={c}
        me={detail.me}
        reply={reply}
        replyQuote={replyQuote}
        editing={editing}
        onCancelReply={onCancelReply}
        onCancelEdit={onCancelEdit}
        recents={recents}
        formatting={detail.chatFormatting !== false}
        linkPreviews={detail.linkPreviews !== false}
        zakiEmojis={detail.zakiEmojis !== false}
        attachSheet={detail.tgLook !== false}
        onNoPreviewChange={c.setNoPreview}
        onEmojiUsed={(emoji) => setRecents(rememberEmoji(emoji))}
        onStickerSend={c.sendText}
        onReplyOptions={() => setReplyOptions(true)}
        onEmoji={(emoji) => {
          // a Zaki sticker goes in as its text code like an emoji, but it is not a recent emoji (`rememberEmoji` keeps it out)
          setRecents(rememberEmoji(emoji));
          c.insertAtCaret(emoji);
        }}
      />
      {detail.me.canRecall ? (
        <RecallDialog
          open={c.recall !== null}
          conversationId={conversationId}
          kinds={detail.me.recallKinds ?? []}
          initialKind={c.recall?.kind ?? null}
          initialQuery={c.recall?.q ?? ""}
          onClose={() => c.setRecall(null)}
          onSent={(message) => {
            c.setRecall(null);
            onMessage(message);
          }}
          onInsert={c.insertWords}
        />
      ) : null}
      {detail.me.canRecall ? (
        <FeedbackDialog
          open={c.feedback !== null}
          conversationId={conversationId}
          initialQuery={c.feedback?.q ?? ""}
          onClose={() => c.setFeedback(null)}
          onSent={(messages) => messages.forEach((message) => onMessage(message))}
        />
      ) : null}
      {detail.me.canPoll ? (
        <PollDialog
          open={c.pollOpen}
          conversationId={conversationId}
          onClose={() => c.setPollOpen(false)}
          onCreated={(message) => {
            c.setPollOpen(false);
            onMessage(message);
          }}
        />
      ) : null}
      {tg && reply ? (
        <ReplyOptions
          open={replyOptions}
          onOpenChange={setReplyOptions}
          message={reply}
          quote={replyQuote}
          onApply={(quote) => (quote ? replyQuoteStore.set(conversationId, reply.id, quote) : replyQuoteStore.clear())}
          onCancelReply={onCancelReply}
        />
      ) : null}
      <PasteSendDialog files={c.pasted} initialCaption={c.body} onSend={c.sendPasted} onCancel={() => c.setPasted(null)} />
      <DropOverlay enabled={!editing && !recording && !c.busy} onDropFiles={(zone, files) => c.addDropped(files, zone === "files")} />
    </>
  );
}
