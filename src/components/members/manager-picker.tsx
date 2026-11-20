"use client";

import { Select } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import { ROLE_KEYS } from "@/lib/i18n/roles";
import { cn } from "@/lib/utils";

/**
 * «المسؤول المباشر» — the ONE control that edits `OrganizationMember.managerId` on the screen (A1.3). The people sheet, the
 * add-person sheet and «الهيكل» all draw it, so the empty answer has one label («بدون مسؤول مباشر») and the list is
 * drawn the same way everywhere: «name — rank».
 *
 * It only CHOOSES: who may appear in `options` (an ACTIVE staff member, never the person or somebody below them) is decided
 * by the caller from the data it already holds, and the server (`assertManager`, one service path) refuses a loop, a guest
 * or a chain deeper than 6 whatever the screen offered. `current` keeps a manager who has since left the company visible, so
 * opening a sheet never silently drops the line.
 */

export interface ManagerChoice {
  id: string;
  name: string;
  role: string;
}

interface Props {
  id: string;
  /** The chosen manager's id; "" means nobody. */
  value: string;
  onChange: (managerId: string) => void;
  options: readonly ManagerChoice[];
  /** The manager the person has today, shown even when they are no longer an option (suspended, offboarded). */
  current?: { id: string; name: string } | null;
  disabled?: boolean;
  className?: string;
  /** The person this line belongs to, for a screen reader when no visible label is next to the control. */
  label?: string;
}

export function ManagerPicker({ id, value, onChange, options, current = null, disabled, className, label }: Props) {
  const { t } = useI18n();
  const missing = current !== null && !options.some((o) => o.id === current.id) ? current : null;
  return (
    <Select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn("h-11", className)}
      aria-label={label}
      data-manager-picker
    >
      <option value="">{t("members.manager_owner")}</option>
      {missing ? <option value={missing.id}>{missing.name}</option> : null}
      {options.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} — {t(ROLE_KEYS[m.role] ?? "role.member")}
        </option>
      ))}
    </Select>
  );
}
