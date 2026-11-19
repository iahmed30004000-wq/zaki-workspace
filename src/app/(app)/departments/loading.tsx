import { GridSkeleton } from "@/components/ui/skeletons";

/** F1.6 — what `/departments` shows while its page loads: the shape of the page (see src/components/ui/skeletons.tsx). */
export default function DepartmentsLoading() {
  return <GridSkeleton place="departments" />;
}
