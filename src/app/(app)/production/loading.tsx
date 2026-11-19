import { ScheduleSkeleton } from "@/components/ui/skeletons";

/** F1.6 — what `/production` shows while its page loads: the shape of the page (see src/components/ui/skeletons.tsx). */
export default function ProductionLoading() {
  return <ScheduleSkeleton place="production" />;
}
