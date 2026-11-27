"use client";

import React from "react";
import { parseArticle, unplacedImages } from "@/lib/chat/article";
import { parseFormatting } from "@/lib/chat/format/parse";
import { FormattedText, renderBlocks } from "@/lib/chat/format/render";

/**
 * «المقالات» — the words of an article as they are read. NEVER HTML: the blocks come from `parseArticle` (headings, lists, picture lines) and every piece of words is
 * drawn by the chat's own formatter as React text (`src/lib/chat/format/render.tsx`), so markup a person typed stays the characters they typed and a link is only one
 * the formatter accepts. `pictures` are addresses the CALLER has already judged safe (our own attachment doors, or the editor's local previews).
 */
export interface ArticlePicture {
  src: string;
  name: string;
}

/** One line of words with the inline formatting (a heading, a list's item). */
const line = (text: string) => renderBlocks(parseFormatting(text));

function Picture({ picture }: { picture: ArticlePicture }) {
  return (
    <figure data-article-picture="" className="overflow-hidden rounded-xl bg-surface-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- our own attachment address or a local preview, judged by the caller */}
      <img src={picture.src} alt={picture.name} loading="lazy" className="mx-auto max-h-[70dvh] w-auto max-w-full object-contain" />
    </figure>
  );
}

export function ArticleBody({ content, pictures }: { content: string; pictures: readonly (ArticlePicture | null)[] }) {
  const blocks = React.useMemo(() => parseArticle(content, pictures.length), [content, pictures.length]);
  const rest = unplacedImages(blocks, pictures.length);
  return (
    <div data-article-body="" dir="auto" className="flex flex-col gap-3 text-base leading-8 [overflow-wrap:anywhere]">
      {blocks.map((block, i) => {
        if (block.t === "heading") {
          return block.level === 2 ? (
            <h3 key={i} dir="auto" className="pt-2 text-lg font-bold leading-7">
              {line(block.text)}
            </h3>
          ) : (
            <h4 key={i} dir="auto" className="pt-1 text-base font-bold leading-7">
              {line(block.text)}
            </h4>
          );
        }
        if (block.t === "list") {
          const items = block.items.map((item, n) => (
            <li key={n} dir="auto">
              {line(item)}
            </li>
          ));
          return block.ordered ? (
            <ol key={i} className="list-decimal space-y-1 ps-6">
              {items}
            </ol>
          ) : (
            <ul key={i} className="list-disc space-y-1 ps-6">
              {items}
            </ul>
          );
        }
        if (block.t === "image") {
          const picture = pictures[block.index];
          return picture ? <Picture key={i} picture={picture} /> : null;
        }
        return <FormattedText key={i} body={block.text} className="whitespace-pre-wrap text-base leading-8" />;
      })}
      {rest.map((index) => {
        const picture = pictures[index];
        return picture ? <Picture key={`rest-${index}`} picture={picture} /> : null;
      })}
    </div>
  );
}
