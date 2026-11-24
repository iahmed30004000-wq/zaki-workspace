"use client";

import React from "react";
import { Play } from "lucide-react";
import type { AttachmentDto, MessageKind } from "@/server/chat/dto";
import { ImageText } from "@/components/image-text";
import { VoicePlayer } from "@/components/chat/message/voice-player";
import { VoiceTranscript } from "@/components/chat/message/voice-transcript";
import { MediaViewer, MediaViewerContext, OCR_MIMES, viewerItemsOfAttachments, type ViewerItem } from "@/components/chat/v2/media-viewer";
import { albumMediaOf, layoutAlbum, safeMediaUrl } from "@/lib/chat/album-layout";
import { ct } from "@/lib/chat/text";
import { VOICE_ROW_PX, imageBox } from "@/lib/chat/viewport/sizes";

/** The fixed box of a voice note: the row's height (`VOICE_ROW_PX`) less the bubble's padding and footer, so nothing moves when the player loads. */
const VOICE_BOX_PX = VOICE_ROW_PX - 32;

/** a part of a box as a CSS percentage (four decimals are far below a pixel) */
const pct = (part: number, whole: number) => `${Math.round((part / whole) * 1e6) / 1e4}%`;

/**
 * The files of a message (C2 §5, built from `message-item.tsx`): a picture and a video RESERVE their box from the attachment's own size (`imageBox`: the
 * same function the virtual list's estimate uses, so the estimate and the drawing agree and nothing jumps when the file loads), a voice note has a fixed
 * height, any other file is a download line. The transcript and «اقرا النص» keep their switches.
 *
 * C3b.3 (`albums`, the company's switch `chatAlbums`; absent: ON): two or more pictures / videos are ONE mosaic (`layoutAlbum`, `albumBox` in `sizes.ts`
 * reserves the same box), and a tap on a picture of a mosaic, or on a lone picture, opens the media viewer. OFF: exactly the old rendering, one box per
 * picture and no viewer. A voice note and a file line are the same in both.
 */
export function BubbleMedia({ attachments, kind, canTranscribe, canReadImages, albums = true, mine = false, voiceTg = true }: { attachments: AttachmentDto[]; kind: MessageKind; canTranscribe: boolean; canReadImages: boolean; albums?: boolean; /** «الصوت زي تيليجرام»: the speed button shows on every voice note */ voiceTg?: boolean; /** the bubble is the person's own (the accent colour): a voice note is drawn in its text colour */ mine?: boolean }) {
  const source = React.useContext(MediaViewerContext);
  // With a provider above the conversation the viewer is drawn THERE (a bubble that is deleted or scrolled away must not take it along) and steps through the whole
  // loaded conversation. Without one the viewer is drawn here, over this bubble's own pictures. Either way only the tapped picture is remembered and the list is
  // asked again while the viewer is open (a deleted message's files drop out at once); the viewer finds the picture by its id, so nothing that arrives moves it.
  const [openId, setOpenId] = React.useState<string | null>(null);
  const openViewer = (id: string) => {
    if (source?.open) source.open({ startId: id, fallback: viewerItemsOfAttachments(attachments), canReadImages });
    else setOpenId(id);
  };
  const viewerItems = (id: string): ViewerItem[] => {
    const loaded = source?.items() ?? [];
    return loaded.some((item) => item.id === id) ? loaded : viewerItemsOfAttachments(attachments);
  };
  const closeViewer = React.useCallback(() => setOpenId(null), []);

  const album = albums && kind !== "VOICE" ? albumMediaOf(attachments) : [];
  const inAlbum = album.length >= 2;

  const one = (file: AttachmentDto) => {
    const url = safeMediaUrl(file.url);
    if (!url) {
      return (
        <span key={file.id} aria-disabled="true" className="block text-xs text-fg-muted">
          {file.name}
        </span>
      );
    }
    if (kind === "VOICE" && file.mime.startsWith("audio/")) {
      return (
        <div key={file.id} data-voice-box>
          <div className="flex items-center" style={{ height: VOICE_BOX_PX }}>
            <VoicePlayer src={url} peaks={file.peaks} durationMs={file.durationMs} mine={mine} speedAlways={voiceTg} />
          </div>
          {canTranscribe && <VoiceTranscript attachmentId={file.id} />}
        </div>
      );
    }
    const box = imageBox(file);
    const reserved = { width: box.width, maxWidth: "100%", aspectRatio: `${box.width} / ${box.height}` };
    // eslint-disable-next-line @next/next/no-img-element -- our own attachment address (checked above), already boxed from its own size: next/image would need a loader for a private route
    const picture = <img src={url} alt={file.name} loading="lazy" width={box.width} height={box.height} className="size-full object-cover" />;
    return (
      <div key={file.id} className="my-1.5">
        {file.kind === "IMAGE" && file.mime.startsWith("image/") ? (
          <span data-image-box className="block overflow-hidden rounded-lg bg-surface-2" style={reserved}>
            {albums ? (
              <button type="button" className="block size-full" aria-label={ct("chatalb.open", { name: file.name })} onClick={() => openViewer(file.id)}>
                {picture}
              </button>
            ) : (
              picture
            )}
          </span>
        ) : null}
        <a href={url} download={file.name} className="mt-0.5 block text-xs underline">
          {ct("chatc.download", { name: file.name })}
        </a>
        {canReadImages && file.kind === "IMAGE" && OCR_MIMES.has(file.mime) && <ImageText endpoint={`/api/chat/attachments/${encodeURIComponent(file.id)}/text`} />}
        {file.kind === "VIDEO" && file.mime.startsWith("video/") && <video src={url} controls preload="metadata" className="mt-1 rounded-lg bg-surface-2" style={reserved} />}
        {file.kind === "AUDIO" && file.mime.startsWith("audio/") && <audio src={url} controls preload="metadata" className="mt-1 w-full" />}
      </div>
    );
  };

  const layout = inAlbum ? layoutAlbum(album) : null;
  return (
    <>
      {layout ? (
        <div
          data-album
          data-album-count={album.length}
          className="relative my-1.5 overflow-hidden rounded-lg"
          style={{ width: layout.width, maxWidth: "100%", aspectRatio: `${layout.width} / ${layout.height}` }}
        >
          {layout.cells.map((cell) => {
            const file = album[cell.index]!;
            const url = safeMediaUrl(file.url);
            const video = file.kind === "VIDEO";
            return (
              <button
                key={file.id}
                type="button"
                data-album-cell
                aria-label={ct(video ? "chatalb.play" : "chatalb.open", { name: file.name })}
                onClick={() => openViewer(file.id)}
                className="absolute overflow-hidden bg-surface-2"
                style={{ insetInlineStart: pct(cell.x, layout.width), top: pct(cell.y, layout.height), width: pct(cell.width, layout.width), height: pct(cell.height, layout.height) }}
              >
                {video ? (
                  <>
                    <video src={url} muted playsInline preload="metadata" aria-hidden="true" className="pointer-events-none size-full object-cover" />
                    <span data-album-play className="absolute inset-0 flex items-center justify-center">
                      <span className="flex size-10 items-center justify-center rounded-full bg-scrim/60 text-on-photo">
                        <Play className="size-5" aria-hidden="true" />
                      </span>
                    </span>
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- our own attachment address (checked above), already boxed by the album's layout
                  <img src={url} alt={file.name} loading="lazy" draggable={false} className="size-full object-cover" />
                )}
              </button>
            );
          })}
        </div>
      ) : null}
      {attachments.filter((file) => !inAlbum || !album.includes(file)).map(one)}
      {openId ? <MediaViewer items={viewerItems(openId)} startId={openId} onClose={closeViewer} onShowInChat={source?.onShowInChat} canReadImages={canReadImages} /> : null}
    </>
  );
}
