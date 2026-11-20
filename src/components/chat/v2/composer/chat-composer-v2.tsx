"use client";

import React from "react";
import { PollDialog } from "@/components/chat/composer/poll-dialog";
import { RecallDialog } from "@/components/chat/composer/recall-dialog";
import { ComposerSurface } from "@/components/chat/v2/composer/composer-surface";
import { DropOverlay } from "@/components/chat/v2/composer/drop-overlay";
import { PasteSendDialog } from "@/components/chat/v2/composer/paste-dialog";
import { loadRecentEmoji, rememberEmoji } from "@/lib/chat/v2/composer/recent-emoji";
import { useComposer, type ComposerParams } from "@/lib/chat/v2/composer/use-composer";

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
  const recording = c.voice.mode !== "idle";
  return (
    <>
      <ComposerSurface
        c={c}
        me={detail.me}
        reply={reply}
        editing={editing}
        onCancelReply={onCancelReply}
        onCancelEdit={onCancelEdit}
        recents={recents}
        linkPreviews={detail.linkPreviews !== false}
        zakiEmojis={detail.zakiEmojis !== false}
        onNoPreviewChange={c.setNoPreview}
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
      <PasteSendDialog files={c.pasted} initialCaption={c.body} onSend={c.sendPasted} onCancel={() => c.setPasted(null)} />
      <DropOverlay enabled={!editing && !recording && !c.busy} onDropFiles={(zone, files) => c.addDropped(files, zone === "files")} />
    </>
  );
}
