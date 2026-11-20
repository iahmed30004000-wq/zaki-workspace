import { SectionsSkeleton } from "@/components/ui/skeletons";

/**
 * W1.9 — what `/my-work/stale` shows while its page loads: the shape of the page (a head, then sections of rows). It wears the frame of the page's own
 * container (`mx-auto max-w-4xl space-y-6 p-4 md:p-6`, the same one «الطلبات» has), so nothing jumps when the page arrives.
 */
export default function StaleLoading() {
  return <SectionsSkeleton place="tickets" />;
}
