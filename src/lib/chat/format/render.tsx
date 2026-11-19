"use client";

import React from "react";
import Link from "next/link";
import { cleanMath } from "@/lib/chat/format/math";
import { parseFormatting, type Block, type Inline } from "@/lib/chat/format/parse";
import { ct } from "@/lib/chat/text";

/**
 * C3b.1 — the parser's tokens drawn as React elements. NEVER HTML: every word is a React text child (so `<script>` and entities are escaped by React), no
 * raw-HTML API anywhere (a test greps for it). A link is `<a href rel="noopener noreferrer" target="_blank">` for the outside and `next/link` for an in-app path
 * (`/chat/…`, `/tasks/…`); the parser already refused every other address, so `href` here is always one it accepted.
 *
 * `renderText` is how a screen composes its own pieces with the formatting: the bubble gives it the mention highlight and the order-number chips, and it is
 * called for every plain run (never for code, never for a link's label). Leftover math markup is drawn as plain characters before `renderText` sees it.
 */
export interface FormatHooks {
  renderText?: (text: string) => React.ReactNode;
}

const LINK_CLASS = "text-accent underline underline-offset-2 [overflow-wrap:anywhere] hover:no-underline";

/** «||…||»: hidden until pressed (a button, so the keyboard reaches it); while hidden its words are not read out and cannot be pressed through the cover. */
function Spoiler({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = React.useState(false);
  // once shown it stays shown (like Telegram) and is then plain words: no button around a link or a mention inside it
  if (shown) {
    return (
      <span data-spoiler="shown" className="rounded bg-surface-2 px-0.5">
        {children}
      </span>
    );
  }
  return (
    <span
      data-spoiler="hidden"
      role="button"
      tabIndex={0}
      aria-label={ct("chatfmt.spoiler")}
      className="cursor-pointer select-none rounded bg-fg-muted px-0.5"
      onClick={() => setShown(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setShown(true);
        }
      }}
    >
      {/* invisible: the words keep their room but nothing of them is drawn (whatever colour a link or a chip inside has), read out or focused */}
      <span aria-hidden="true" className="invisible">
        {children}
      </span>
    </span>
  );
}

function inlineNodes(tokens: readonly Inline[], hooks: FormatHooks): React.ReactNode[] {
  return tokens.map((token, i) => {
    switch (token.t) {
      case "text":
        return <React.Fragment key={i}>{hooks.renderText ? hooks.renderText(cleanMath(token.text)) : cleanMath(token.text)}</React.Fragment>;
      case "bold":
        return <strong key={i}>{inlineNodes(token.children, hooks)}</strong>;
      case "italic":
        return <em key={i}>{inlineNodes(token.children, hooks)}</em>;
      case "strike":
        return <s key={i}>{inlineNodes(token.children, hooks)}</s>;
      case "spoiler":
        return <Spoiler key={i}>{inlineNodes(token.children, hooks)}</Spoiler>;
      case "code":
        return (
          <code key={i} dir="auto" className="rounded bg-surface-2 px-1 font-mono text-[0.9em]">
            {token.text}
          </code>
        );
      case "link": {
        // a link's label is words only: no chip (a button) inside an anchor, no mention highlight
        const label = inlineNodes(token.label, {});
        return token.internal ? (
          <Link key={i} href={token.href} dir="auto" className={LINK_CLASS}>
            {label}
          </Link>
        ) : (
          <a key={i} href={token.href} target="_blank" rel="noopener noreferrer" dir="auto" className={LINK_CLASS}>
            {label}
          </a>
        );
      }
    }
  });
}

function blockNodes(blocks: readonly Block[], hooks: FormatHooks): React.ReactNode[] {
  return blocks.map((block, i) => {
    if (block.t === "pre") {
      return (
        <pre key={i} dir="auto" className="overflow-x-auto rounded-lg bg-surface-2 p-2 text-start font-mono text-xs leading-relaxed">
          <code>{block.text}</code>
        </pre>
      );
    }
    if (block.t === "quote") {
      return (
        <blockquote key={i} dir="auto" className="whitespace-pre-wrap border-s-[3px] border-accent ps-2 text-fg-muted">
          {inlineNodes(block.inline, hooks)}
        </blockquote>
      );
    }
    return (
      <p key={i} className="whitespace-pre-wrap">
        {inlineNodes(block.inline, hooks)}
      </p>
    );
  });
}

/** True when the body is one paragraph (the common case): it is drawn as a single `<p>` and keeps the markup the bubble always had. */
export function isInlineOnly(blocks: readonly Block[]): boolean {
  return blocks.length === 1 && blocks[0]?.t === "text";
}

/** The tokens of a body as elements: nothing for an empty body. */
export function renderBlocks(blocks: readonly Block[], hooks: FormatHooks = {}): React.ReactNode {
  const first = blocks[0];
  if (blocks.length === 0 || !first) return null;
  if (isInlineOnly(blocks) && first.t === "text") return inlineNodes(first.inline, hooks);
  return blockNodes(blocks, hooks);
}

const DEFAULT_CLASS = "whitespace-pre-wrap text-sm leading-relaxed";

/** A body drawn with its formatting: one `<p>` for a plain paragraph, a `<div>` of paragraphs, quotes and code blocks otherwise. */
export function FormattedText({ body, renderText, className = DEFAULT_CLASS }: FormatHooks & { body: string; className?: string }) {
  const blocks = React.useMemo(() => parseFormatting(body), [body]);
  if (blocks.length === 0) return null;
  if (isInlineOnly(blocks)) return <p className={className}>{renderBlocks(blocks, { renderText })}</p>;
  return <div className={`flex flex-col gap-1 ${className.replace("whitespace-pre-wrap", "").trim()}`}>{renderBlocks(blocks, { renderText })}</div>;
}
