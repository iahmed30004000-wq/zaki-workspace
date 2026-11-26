"use client";

import { ChevronLeft } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { VerifiedBadge } from "@/components/ui/verified-badge";
import { useI18n } from "@/lib/i18n";
import { lastLoginLine, spacesSummary, type ContractMember } from "@/lib/members-ui";
import { cn } from "@/lib/utils";
import { PendingPasswordBadge, RankBadge, StatusBadge } from "./badges";

/**
 * One person as a card that works at 375px: name, @username, job title, rank, status, the warning
 * that the temporary password was never changed, the last sign-in, the manager and the spaces.
 * The whole card is the button that opens the person's panel (a 44px+ target by construction), and a
 * suspended or offboarded person is shown dimmed but still readable.
 */
export function MemberCard({
  member,
  isSelf,
  now,
  onOpen,
}: {
  member: ContractMember;
  isSelf: boolean;
  now: number;
  onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  const dimmed = member.status !== "ACTIVE";
  const identity = member.username ? `@${member.username}` : member.email;
  // S5.5: «موثّق» next to the name; the roster sends `verified` only while the company's switch is on
  const verified = member.verified === true;

  return (
    <li>
      <button
        type="button"
        aria-haspopup="dialog"
        data-status={member.status}
        onClick={() => onOpen(member.id)}
        className={cn(
          "flex w-full items-start gap-3 rounded-[14px] bg-surface-1 p-3 text-start transition-colors",
          "hover:bg-surface-2",
          dimmed && "opacity-70",
        )}
      >
        <Avatar name={member.name} src={member.avatarUrl} className="h-11 w-11 text-sm" />
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="break-words text-sm font-semibold text-fg">{member.name}</span>
            {verified ? <VerifiedBadge /> : null}
            {isSelf ? (
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">{t("members.you")}</span>
            ) : null}
          </span>
          {identity || member.jobTitle ? (
            <span className="block break-words text-xs text-fg-muted">
              {identity ? (
                <span dir="ltr" className="inline-block max-w-full break-all align-bottom">
                  {identity}
                </span>
              ) : null}
              {identity && member.jobTitle ? " · " : null}
              {member.jobTitle}
            </span>
          ) : null}
          <span className="flex flex-wrap gap-1.5">
            <RankBadge role={member.role} primaryOwner={member.primaryOwner} />
            <StatusBadge status={member.status} />
            {member.mustChangePassword ? <PendingPasswordBadge /> : null}
            {member.agent ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-fg">{t("members.agent_badge")}</span> : null}
            {member.spaceOnly ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-fg">{t("members.space_only_badge")}</span> : null}
          </span>
          <span className="block text-xs text-muted">{lastLoginLine(member.lastLoginAt, now, t)}</span>
          {member.managerName ? (
            <span className="block break-words text-xs text-muted">{t("members.manager_line", { name: member.managerName })}</span>
          ) : null}
          <span className="block break-words text-xs text-muted">{t("members.spaces_line", { names: spacesSummary(member, t) })}</span>
        </span>
        <ChevronLeft className="mt-3 size-4 shrink-0 text-muted" aria-hidden="true" />
      </button>
    </li>
  );
}
