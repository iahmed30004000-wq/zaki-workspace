import { ListSkeleton } from "@/components/ui/skeletons";

/** F1.6 — what `/files` shows while its page loads: the shape of the page (see src/components/ui/skeletons.tsx). */
export default function FilesLoading() {
  return <ListSkeleton place="files" />;
}
