import { ListSkeleton } from "@/components/ui/skeletons";

/** F1.6 — what `/ideas` shows while its page loads: the shape of the page (see src/components/ui/skeletons.tsx). */
export default function IdeasLoading() {
  return <ListSkeleton place="ideas" composer toolbar={false} action={false} />;
}
