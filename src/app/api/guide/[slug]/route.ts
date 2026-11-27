import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { NotFoundError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { neighbors, readableArticle } from "@/lib/guide/articles";
import { audienceOf } from "@/lib/guide/audience";

/**
 * One article of the guide, as the site's page draws it (src/app/(app)/guide/[slug]/page.tsx): an unknown slug, and an article above the
 * reader's level, are «not found» — a typed link cannot read what the guide does not offer them. The two articles on either side are theirs.
 */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const viewer = audienceOf(actor);
    const article = readableArticle(params.slug, viewer);
    if (!article) throw new NotFoundError("guide.not_found");
    const { prev, next } = neighbors(article.slug, viewer);
    const ref = (a: typeof prev) => (a ? { slug: a.slug, title: a.title } : null);
    return NextResponse.json({ article, prev: ref(prev), next: ref(next) });
  });
}
