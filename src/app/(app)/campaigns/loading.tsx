import { SectionsSkeleton } from "@/components/ui/skeletons";

/** F1.6 — what `/campaigns` shows while its page loads: the shape of the page (see src/components/ui/skeletons.tsx). */
export default function CampaignsLoading() {
  return <SectionsSkeleton place="campaigns" />;
}
