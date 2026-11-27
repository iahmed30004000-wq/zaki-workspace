"use client";

import React from "react";
import { Newspaper } from "lucide-react";
import type { AttachmentDto, MessageDto } from "@/server/chat/dto";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArticleBody, type ArticlePicture } from "@/components/chat/v2/article/article-body";
import { safeMediaUrl } from "@/lib/chat/album-layout";
import { articleExcerpt, splitArticle } from "@/lib/chat/article";
import { fmtDateTime } from "@/lib/format";
import { ct } from "@/lib/chat/text";

/** The message's pictures as the article numbers them (the order they were sent in). Only our own attachment address is ever drawn. */
export function picturesOf(attachments: readonly AttachmentDto[]): (ArticlePicture | null)[] {
  return attachments.map((file) => {
    const src = file.kind === "IMAGE" ? safeMediaUrl(file.url) : undefined;
    return src ? { src, name: file.name } : null;
  });
}

/** The reading page: a clean full screen on a phone, a wide window on a computer; the title, who wrote it and when, the words. */
export function ArticleReader({ message, onClose, portal = true }: { message: MessageDto; onClose: () => void; portal?: boolean }) {
  const { title, content } = splitArticle(message.body ?? "");
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent portal={portal} size="xl" aria-describedby={undefined} data-article-reader="" className="max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:w-full max-md:max-w-full max-md:rounded-none max-md:border-0">
        <DialogHeader>
          <DialogTitle dir="auto" className="text-xl font-bold leading-8">
            {title}
          </DialogTitle>
          <p className="text-xs text-fg-muted">
            {message.authorName} · <time dateTime={message.createdAt}>{fmtDateTime(message.createdAt)}</time>
            {message.edited ? ` · ${ct("chatc.edited")}` : ""}
          </p>
        </DialogHeader>
        <DialogBody className="select-text">
          <ArticleBody content={content} pictures={picturesOf(message.attachments)} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

const keep = (event: React.SyntheticEvent) => event.stopPropagation();

/** What an article looks like in the log: its first picture, the title, the first words and «اقرأ المقال». */
export function ArticleCard({ message }: { message: MessageDto }) {
  const [reading, setReading] = React.useState(false);
  const { title, content } = splitArticle(message.body ?? "");
  const cover = picturesOf(message.attachments).find((p) => p !== null) ?? null;
  const excerpt = articleExcerpt(content);
  return (
    <div data-article-card="" className="w-72 max-w-full">
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element -- our own attachment address (picturesOf)
        <img src={cover.src} alt="" loading="lazy" className="mb-2 h-36 w-full rounded-lg bg-surface-2 object-cover" />
      ) : null}
      <p className="flex items-center gap-1 text-xs text-fg-muted">
        <Newspaper aria-hidden="true" className="size-3.5 shrink-0" />
        {ct("tgx.article.label")}
      </p>
      <p dir="auto" data-article-title="" className="line-clamp-3 text-base font-bold leading-6 [overflow-wrap:anywhere]">
        {title}
      </p>
      {excerpt ? (
        <p dir="auto" className="mt-1 line-clamp-3 text-sm leading-6 text-fg-muted [overflow-wrap:anywhere]">
          {excerpt}
        </p>
      ) : null}
      <button type="button" data-article-open="" aria-haspopup="dialog" onClick={() => setReading(true)} className="mt-2 flex min-h-11 w-full items-center justify-center rounded-lg bg-accent/10 text-sm font-semibold text-accent hover:bg-accent/15">
        {ct("tgx.article.read")}
      </button>
      {reading ? (
        // the reading page is drawn on <body> but is still inside the bubble for React: its presses must not become the bubble's (the long press, the tap menu, the double click, the swipe)
        <div className="contents" onPointerDown={keep} onPointerUp={keep} onClick={keep} onDoubleClick={keep} onContextMenu={keep} onTouchStart={keep} onTouchMove={keep} onTouchEnd={keep}>
          <ArticleReader message={message} onClose={() => setReading(false)} />
        </div>
      ) : null}
    </div>
  );
}
