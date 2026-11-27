import Link from "next/link";
import { Avatar } from "@/components/ui/avatar";
import { ProfileMessageButton } from "@/components/profile-message-button";
import { PROFILE_EDIT_HREF } from "@/components/profile/profile-screen";
import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { enumLabel } from "@/lib/i18n/enums";
import { fmtLongDate, fmtNumber } from "@/lib/format";
import { lastSeenText } from "@/lib/last-seen";
import type { PublicProfile } from "@/server/services/users";

const word = (key: string, vars?: Record<string, string | number>) => interpolate(AR[key] ?? key, vars);

/**
 * A person's page, laid out like a social profile (the owner's postponed «بروفايل مثل فيسبوك»): a cover, the
 * picture overlapping it, the name and the job, what the person can be asked (a message), then what is known
 * about them: the bio, since when they are here, the spaces they share with me and the four numbers.
 * The numbers and the spaces come already limited to what the viewer may see (services/users.ts).
 */
export function ProfileCard({ profile, mine }: { profile: PublicProfile; mine: boolean }) {
  const stats: { label: string; value: number }[] = [
    { label: word("stat.ideas"), value: profile.stats.ideasCreated },
    { label: word("stat.votes"), value: profile.stats.ideasVotesReceived },
    { label: word("stat.openTasks"), value: profile.stats.openTasksAssigned },
    { label: word("stat.completedTasks"), value: profile.stats.tasksCompleted },
  ];
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-6">
      <header className="overflow-hidden rounded-xl border border-border bg-surface">
        <div data-cover aria-hidden="true" className="h-28 bg-gradient-to-l from-accent/30 via-info/15 to-cat-3/20 md:h-36" />
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-5">
          <div className="-mt-10 flex min-w-0 items-end gap-3">
            <Avatar name={profile.name} src={profile.avatarUrl} className="size-20 shrink-0 text-xl ring-4 ring-surface" />
            <div className="min-w-0 pb-1">
              <h1 className="truncate text-xl font-bold text-fg">{profile.name}</h1>
              <p className="text-sm font-medium text-accent">{profile.jobTitle ?? word("teams.noTitle")}</p>
              <p className="text-xs text-fg-muted">
                {profile.organizationName} · {enumLabel("OrgRole", profile.organizationRole)}
              </p>
              {/* «آخر ظهور»: the server leaves it out on one's own page, when the switch is off, and for a guest (services/last-seen.ts) */}
              {!mine && profile.lastSeenAt !== undefined ? (
                <p data-last-seen className={profile.online ? "text-xs font-semibold text-ok" : "text-xs text-fg-muted"}>
                  {lastSeenText({ online: profile.online === true, lastSeenAt: profile.lastSeenAt, timeZone: profile.lastSeenTimeZone })}
                </p>
              ) : null}
            </div>
          </div>
          {mine ? (
            <Link
              href={PROFILE_EDIT_HREF}
              data-edit-profile
              className="inline-flex h-11 items-center justify-center rounded-lg border border-border bg-surface px-4 text-sm font-medium text-fg hover:bg-surface-2 md:h-9"
            >
              {word("profilecard.edit")}
            </Link>
          ) : (
            <ProfileMessageButton userId={profile.id} />
          )}
        </div>
      </header>

      {profile.bio ? (
        <section data-bio className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-fg">{word("profilecard.about")}</h2>
          <p className="whitespace-pre-wrap text-sm text-fg-muted">{profile.bio}</p>
          <p className="mt-3 text-xs text-fg-muted">{word("profilecard.since", { date: fmtLongDate(profile.createdAt) })}</p>
        </section>
      ) : (
        <p className="px-1 text-xs text-fg-muted">{word("profilecard.since", { date: fmtLongDate(profile.createdAt) })}</p>
      )}

      {profile.sharedSpaces.length > 0 ? (
        <section data-shared-spaces className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-fg">{word(mine ? "profilecard.my_spaces" : "profilecard.shared_spaces")}</h2>
          <ul className="flex flex-wrap gap-2">
            {profile.sharedSpaces.map((space) => (
              <li key={space.id} className="rounded-full bg-surface-2 px-3 py-1 text-sm text-fg">
                {space.emoji ? <span aria-hidden="true">{space.emoji} </span> : null}
                {space.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-surface p-3 text-center">
            <p className="text-xl font-bold text-fg">{fmtNumber(s.value)}</p>
            <p className="text-xs text-fg-muted">{s.label}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
