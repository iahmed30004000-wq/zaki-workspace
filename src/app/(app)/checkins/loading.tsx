import { ListSkeleton } from "@/components/ui/skeletons";

/** F1.6 — what `/checkins` shows while its page loads: the shape of the page (see src/components/ui/skeletons.tsx). */
export default function CheckinsLoading() {
  return <ListSkeleton place="checkins" />;
}
