import { ListSkeleton } from "@/components/ui/skeletons";

/** F1.6 — what `/goals` shows while its page loads: the shape of the page (see src/components/ui/skeletons.tsx). */
export default function GoalsLoading() {
  return <ListSkeleton place="goals" />;
}
