import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";

/**
 * C4.1 — the old address keeps working: «حسابي» is now the first section of «إعداداتي» (`/settings/me/account`), so a saved link, a bookmark or a link in the
 * guide ends there. The page still asks for the signed-in person first (a signed-out visitor goes to the sign-in, as before).
 */
export default async function ProfilePage() {
  await pageActor();
  redirect("/settings/me/account");
}

export const dynamic = "force-dynamic";
