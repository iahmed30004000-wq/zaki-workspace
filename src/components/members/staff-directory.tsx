import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { ROLE_KEYS } from "@/lib/i18n/roles";
import type { OrgRoleName, TFn } from "@/lib/members-ui";
import { cn } from "@/lib/utils";
import { PILL, RANK_BADGE } from "./badge-styles";

/**
 * One line of the staff directory. The server fills in only what the viewer may see: a viewer
 * without the capability `directory.view` gets the name and nothing else (`jobTitle`, `role` and
 * `email` are null), so nothing private is ever sent to the page.
 */
export interface DirectoryPerson {
  id: string;
  name: string;
  jobTitle: string | null;
  role: OrgRoleName | null;
  email: string | null;
  /** `/api/avatars/<id>` — the picture they uploaded, or null for their initials. */
  avatarUrl?: string | null;
  /** «إشارة التوثيق» (S5.5): `true` only when the person carries the badge and the company's switch is on */
  verified?: boolean;
}

/**
 * The read-only list for people who may not manage accounts: active people only, no status, no
 * actions. A server component (no hooks), so it takes the translator as a prop.
 */
export function StaffDirectory({ people, t, linkProfiles }: { people: readonly DirectoryPerson[]; t: TFn; linkProfiles: boolean }) {
  if (people.length === 0) {
    return <p className="rounded-xl border border-dashed border-border bg-surface-1 p-6 text-center text-sm text-fg-muted">{t("members.dir_empty")}</p>;
  }
  return (
    <ul className="divide-y divide-border/60 rounded-xl border border-border bg-surface">
      {people.map((p) => {
        const row = (
          <>
            <Avatar name={p.name} src={p.avatarUrl} className="h-11 w-11 text-sm" />
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-medium text-fg">
                {p.name}
                {p.verified ? <VerifiedBadge className="ms-1" /> : null}
              </p>
              {p.jobTitle ? <p className="break-words text-xs text-fg-muted">{p.jobTitle}</p> : null}
              {p.email ? (
                <p className="mt-0.5 text-xs text-muted">
                  <span dir="ltr" className="inline-block max-w-full break-all align-bottom">
                    {p.email}
                  </span>
                </p>
              ) : null}
            </div>
            {p.role ? <span className={cn(PILL, RANK_BADGE[p.role])}>{t(ROLE_KEYS[p.role] ?? "role.member")}</span> : null}
          </>
        );
        const rowClass = "flex min-h-14 items-center gap-3 px-3 py-2.5";
        return (
          <li key={p.id}>
            {linkProfiles ? (
              <Link href={`/u/${p.id}`} className={cn(rowClass, "hover:bg-surface-2")}>
                {row}
              </Link>
            ) : (
              <div className={rowClass}>{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
