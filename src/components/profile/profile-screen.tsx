import Link from "next/link";
import { Camera, Pencil, Settings, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";

/**
 * «الملف الشخصي» as a page of its own (the owner, 2026-11-27: not inside the settings), drawn the way his pictures draw a profile: the picture and the name in
 * the middle, three round-cornered buttons under them, then a white card with the person's own facts. It shows and leads; the changing is done by the same
 * form as before (`/settings/me/account`), which stays under this tab of the bottom bar and goes back here.
 */
export interface ProfileScreenWords {
  title: string;
  photo: string;
  edit: string;
  settings: string;
  username: string;
  job: string;
  bio: string;
  email: string;
}

export interface ProfileScreenPerson {
  name: string;
  username: string | null;
  jobTitle: string | null;
  bio: string | null;
  email: string | null;
  avatarUrl: string | null;
}

export const PROFILE_EDIT_HREF = "/settings/me/account";

function Action({ href, icon: Icon, label, id }: { href: string; icon: LucideIcon; label: string; id: string }) {
  return (
    <li className="min-w-0 flex-1">
      <Link href={href} data-profile-action={id} data-tg-ripple="" className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-2xl bg-surface-1 px-1 py-2 text-xs font-medium text-fg shadow-card hover:bg-surface-2">
        <Icon aria-hidden="true" className="size-5 text-accent" />
        <span className="max-w-full truncate leading-5">{label}</span>
      </Link>
    </li>
  );
}

export function ProfileScreen({ person, words, withPicture }: { person: ProfileScreenPerson; words: ProfileScreenWords; /** the company's switch «الصورة الشخصية»: off, no picture is offered */ withPicture: boolean }) {
  // a fact nobody wrote is not drawn: no empty rows
  const facts: { id: string; label: string; value: string; ltr?: boolean }[] = [
    ...(person.bio?.trim() ? [{ id: "bio", label: words.bio, value: person.bio.trim() }] : []),
    ...(person.username ? [{ id: "username", label: words.username, value: `@${person.username}`, ltr: true }] : []),
    ...(person.jobTitle?.trim() ? [{ id: "job", label: words.job, value: person.jobTitle.trim() }] : []),
    ...(person.email ? [{ id: "email", label: words.email, value: person.email, ltr: true }] : []),
  ];
  return (
    <div data-profile-screen="" className="mx-auto flex min-h-full w-full max-w-md flex-col gap-3 bg-surface px-3 pb-8 pt-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar name={person.name} src={person.avatarUrl} className="size-28 text-3xl" />
        <h1 className="max-w-full truncate text-xl font-bold leading-8 text-fg">
          <bdi>{person.name}</bdi>
        </h1>
        <span className="sr-only">{words.title}</span>
      </div>
      <ul className="flex gap-2">
        {withPicture ? <Action id="photo" href={PROFILE_EDIT_HREF} icon={Camera} label={words.photo} /> : null}
        <Action id="edit" href={PROFILE_EDIT_HREF} icon={Pencil} label={words.edit} />
        <Action id="settings" href="/settings/me" icon={Settings} label={words.settings} />
      </ul>
      {facts.length ? (
        <dl data-profile-facts="" className="overflow-hidden rounded-2xl bg-surface-1 shadow-card">
          {facts.map((fact) => (
            <div key={fact.id} data-profile-fact={fact.id} className="flex flex-col-reverse border-b border-border/60 px-4 py-2.5 last:border-b-0">
              <dt className="text-xs leading-5 text-fg-muted">{fact.label}</dt>
              <dd className="break-words text-[15px] leading-6 text-fg">{fact.ltr ? <bdi dir="ltr">{fact.value}</bdi> : fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
