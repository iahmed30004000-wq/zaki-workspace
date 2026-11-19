import { TableSkeleton } from "@/components/ui/skeletons";

/** F1.6 — what `/crm` shows while its page loads: the shape of the page (see src/components/ui/skeletons.tsx). */
export default function CrmLoading() {
  return <TableSkeleton place="crm" />;
}
