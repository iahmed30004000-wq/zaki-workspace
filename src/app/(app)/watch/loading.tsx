import { RoomSkeleton } from "@/components/ui/skeletons";

/** F1.6 — what `/watch` shows while its page loads: the shape of the page (see src/components/ui/skeletons.tsx). */
export default function WatchLoading() {
  return <RoomSkeleton place="watch" />;
}
