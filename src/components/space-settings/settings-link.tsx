import Link from "next/link";
import { Settings, Users, UsersRound } from "lucide-react";

const ICONS = { general: Settings, people: Users, teams: UsersRound } as const;

/**
 * A button-shaped link into one tab of a space's settings page (A2.2): what the dialog buttons of the projects page become while the switch `controlPanelV2` is ON
 * (the same size and look as the `secondary` small `Button`, so the toolbar does not move). Pure markup, no state: it is drawn by the server page.
 */
export function SettingsLink({ href, label, icon }: { href: string; label: string; icon: keyof typeof ICONS }) {
  const Icon = ICONS[icon];
  return (
    <Link
      href={href}
      data-space-settings-link={icon}
      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] border border-border bg-surface px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent md:h-8"
    >
      <Icon aria-hidden="true" className="size-4 text-accent" />
      {label}
    </Link>
  );
}
