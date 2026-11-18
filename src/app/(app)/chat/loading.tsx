/**
 * C2.1 — what `/chat/**` shows while one of its pages loads: the SAME skeleton the rest of the app shows (`src/app/(app)/loading.tsx`), so with the switch
 * `chatLayoutV2` OFF nothing looks different. Having a `loading.tsx` of its own matters for the ON screen: it puts the loading boundary INSIDE the chat's
 * layout, so while the next conversation loads only the pane shows the skeleton and the list column beside it is never taken away.
 */
export { default } from "@/app/(app)/loading";
