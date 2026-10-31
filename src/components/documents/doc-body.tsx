import * as React from "react";
import { cn } from "@/lib/utils";
import { parseDoc, type Block, type Inline } from "@/lib/docs/markup";

/**
 * «المستندات» — draws a document. The text is parsed into plain nodes (src/lib/docs/markup.ts) and every node becomes one of
 * OUR elements: nothing here ever writes HTML from the text, so a document that says `<script>` shows the words and runs
 * nothing, and a link is drawn only when its address is https, http or mailto.
 */

function Inlines({ nodes }: { nodes: readonly Inline[] }) {
  return (
    <>
      {nodes.map((node, i) => {
        if (node.kind === "text") return <React.Fragment key={i}>{node.text}</React.Fragment>;
        if (node.kind === "bold") return <strong key={i} className="font-semibold"><Inlines nodes={node.children} /></strong>;
        if (node.kind === "mention") return <span key={i} className="rounded bg-accent/10 px-1 text-accent">{node.text}</span>;
        return (
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer nofollow" className="text-info underline underline-offset-2 hover:opacity-80">
            {node.text}
          </a>
        );
      })}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === "h1") return <h2 className="mb-2 mt-5 text-xl font-bold text-fg"><Inlines nodes={block.inline} /></h2>;
  if (block.kind === "h2") return <h3 className="mb-2 mt-4 text-lg font-semibold text-fg"><Inlines nodes={block.inline} /></h3>;
  if (block.kind === "h3") return <h4 className="mb-1.5 mt-3 text-base font-semibold text-fg"><Inlines nodes={block.inline} /></h4>;
  if ("items" in block) {
    const List = block.kind === "ul" ? "ul" : "ol";
    return (
      <List className={cn("my-2 ms-0 ps-6 text-sm leading-7 text-fg", block.kind === "ul" ? "list-disc" : "list-decimal")}>
        {block.items.map((item, i) => (
          <li key={i}><Inlines nodes={item} /></li>
        ))}
      </List>
    );
  }
  return <p className="my-2 whitespace-pre-wrap break-words text-sm leading-7 text-fg"><Inlines nodes={block.inline} /></p>;
}

/** `names`: the people of the space, so an `@name` of theirs is drawn as a mention. */
export function DocBody({ content, names = [], emptyText, className }: { content: string; names?: readonly string[]; emptyText?: string; className?: string }) {
  const blocks = parseDoc(content, names);
  return (
    <div dir="rtl" className={cn("min-w-0 break-words", className)}>
      {blocks.length === 0 && emptyText ? <p className="text-sm text-fg-muted">{emptyText}</p> : null}
      {blocks.map((block, i) => (
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}
