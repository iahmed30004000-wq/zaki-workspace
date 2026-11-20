import { notFound } from "next/navigation";
import { FeatureSwitches } from "@/components/feature-switches";
import { SectionHeader } from "@/components/control-panel/frame";
import { listFeatures } from "@/server/services/features";
import { embedServer } from "@/server/services/search-embeddings";
import type { SectionCtx } from "./board-sections";

/**
 * «الميزات» — the company's switches, grouped (A1.4) with the chat group of C4.3: `FeatureSwitches`, MOVED from /settings (the same list, the same door
 * `PATCH /api/settings/features`, the same owner-only rule: who flips the company's switches does not change here, D-A4). The OWNER rank alone.
 */
export async function FeaturesSection({ ctx }: { ctx: SectionCtx }) {
  const { actor, t } = ctx;
  if (!actor.isOwner) return notFound();
  const features = await listFeatures(actor.orgId);
  return (
    <div className="space-y-4" data-testid="cp-features">
      <SectionHeader t={t} section="features" hint={t("features.subtitle")} />
      <FeatureSwitches initial={features} notReady={embedServer() ? [] : ["semanticSearch"]} />
    </div>
  );
}
