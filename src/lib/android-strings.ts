/**
 * The Android app's copy of the site's own words for a feature, generated (never typed by hand): `scripts/build-android-strings.mjs`
 * writes the Kotlin file from the dictionary fragment, and tests/android-strings.test.ts fails while the committed file differs, so
 * the phone can never say something the site does not. Pure.
 */

export interface AndroidStringsFile {
  /** the dictionary fragment, under src/lib/i18n */
  source: string;
  /** the Kotlin file, from the repository's root */
  target: string;
  /** the Kotlin package and object */
  pkg: string;
  name: string;
  /** which keys to carry (every key of the fragment when absent) */
  keep?: (key: string) => boolean;
  /** single keys the screens also need, from other fragments (named one by one, never a whole file) */
  extra?: { source: string; keys: readonly string[] }[];
}

/** The words a file carries: its fragment's (filtered by `keep`) and the named `extra` keys; a named key missing from its fragment throws. */
export function collectWords(file: AndroidStringsFile, read: (source: string) => Record<string, string>): Record<string, string> {
  const own = read(file.source);
  const words: Record<string, string> = {};
  for (const [k, v] of Object.entries(own)) if (file.keep ? file.keep(k) : true) words[k] = v;
  for (const x of file.extra ?? []) {
    const other = read(x.source);
    for (const k of x.keys) {
      if (!(k in other)) throw new Error(`${k} is not in ${x.source}`);
      words[k] = other[k] as string;
    }
  }
  return words;
}

export const ANDROID_STRINGS: readonly AndroidStringsFile[] = [
  {
    source: "ar.manufacturing.json",
    target: "android/app/src/main/java/io/zakiai/workspace/feature/mfg/MfgWords.kt",
    pkg: "io.zakiai.workspace.feature.mfg",
    name: "MfgWords",
  },
  {
    source: "ar.team-development.json",
    target: "android/app/src/main/java/io/zakiai/workspace/feature/dev/DevWords.kt",
    pkg: "io.zakiai.workspace.feature.dev",
    name: "DevWords",
    keep: (key) => key.startsWith("teamdev.") || key === "nav.tab.myFile",
  },
  {
    source: "ar.spaces.json",
    target: "android/app/src/main/java/io/zakiai/workspace/feature/spaces/SpaceWords.kt",
    pkg: "io.zakiai.workspace.feature.spaces",
    name: "SpaceWords",
    extra: [
      { source: "ar.json", keys: ["ws.name", "ws.desc", "ws.role_admin", "ws.role_guest", "ws.role_member", "ws.promote", "ws.demote", "ws.removeMember", "ws.addMembers", "ws.add", "ws.everyoneIn", "ws.editTitle", "ws.renamed"] },
      { source: "ar.cards.json", keys: ["cards.space_type", "cards.space_type.STANDARD", "cards.space_type.CARDS", "cards.space_type.MANUFACTURING"] },
      { source: "ar.permissions-v2.json", keys: ["teamlead.hint", "teamlead.label", "teamlead.none", "teamlead.saved"] },
      { source: "ar.work-v2.json", keys: ["enum.WorkStage.TODO", "enum.WorkStage.DOING", "enum.WorkStage.REVIEW", "enum.WorkStage.DONE"] },
    ],
  },
  {
    source: "ar.routine.json",
    target: "android/app/src/main/java/io/zakiai/workspace/feature/routines/RoutineWords.kt",
    pkg: "io.zakiai.workspace.feature.routines",
    name: "RoutineWords",
    extra: [
      { source: "ar.recurring.json", keys: ["recurring.day.0", "recurring.day.1", "recurring.day.2", "recurring.day.3", "recurring.day.4", "recurring.day.5", "recurring.day.6"] },
      { source: "ar.features.json", keys: ["features.off"] },
      { source: "ar.json", keys: ["guest.readonly", "section.view_denied", "section.edit_denied"] },
      { source: "ar.spaces.json", keys: ["assignee.not_in_team"] },
      { source: "ar.enums.json", keys: ["project.not_found", "board.not_found"] },
    ],
  },
  {
    source: "ar.members.json",
    target: "android/app/src/main/java/io/zakiai/workspace/feature/accounts/AccountWords.kt",
    pkg: "io.zakiai.workspace.feature.accounts",
    name: "AccountWords",
    extra: [
      { source: "ar.json", keys: ["role.owner", "role.partner", "role.admin", "role.lead", "role.member", "role.guest", "orgm.title", "orgm.name", "orgm.role_denied", "orgm.not_member", "auth.jobTitle"] },
      {
        source: "ar.permissions-v2.json",
        keys: ["perm.area.work", "perm.area.chat", "perm.area.files", "perm.area.customers", "perm.area.reports", "perm.area.people", "perm.area.integrations", "perm.area.manufacturing", "perm.area_count", "perm.areas_hint", "perm.tasks_delete_note", "perm.explain.title", "perm.explain.hint", "perm.explain.count", "perm.explain.can", "perm.explain.cannot"],
      },
      { source: "ar.space-only.json", keys: ["members.space_only_badge"] },
      // the switches whose words live with their own feature (tests/android-strings.test.ts pins that every capability has its title)
      {
        source: "ar.manufacturing.json",
        keys: ["members.cap.manufacturing.view.title", "members.cap.manufacturing.view.hint", "members.cap.manufacturing.edit.title", "members.cap.manufacturing.edit.hint", "members.cap.manufacturing.cost.title", "members.cap.manufacturing.cost.hint"],
      },
      { source: "ar.owner-board.json", keys: ["members.cap.board.self.title", "members.cap.board.self.hint", "members.cap.board.team.title", "members.cap.board.team.hint"] },
      { source: "ar.team-development.json", keys: ["members.cap.people.manage_lines.title", "members.cap.people.manage_lines.hint", "members.cap.people.review.title", "members.cap.people.review.hint"] },
      { source: "ar.verified-badge.json", keys: ["verified.section", "verified.state_on", "verified.state_off", "verified.help", "verified.grant", "verified.revoke", "verified.granted", "verified.revoked", "verified.failed"] },
      {
        source: "ar.task-requests.json",
        keys: ["bulk.apply_move", "bulk.apply_unassign", "bulk.close", "bulk.count", "bulk.done", "bulk.later", "bulk.manager_only", "bulk.none", "bulk.open_button", "bulk.person_not_found", "bulk.pick", "bulk.pick_none", "bulk.requested_note", "bulk.same_person", "bulk.section", "bulk.section_hint", "bulk.skipped_note", "bulk.title"],
      },
      {
        source: "ar.accounts.json",
        keys: [
          "accounts.name_too_short", "accounts.name_too_long", "accounts.job_title_too_long", "accounts.role_invalid", "accounts.self_denied", "accounts.bad_transition",
          "accounts.offboarded_frozen", "accounts.transfer_required", "accounts.transferee_invalid", "accounts.transfer_needs_space_access", "accounts.manager_invalid",
          "accounts.manager_cycle", "accounts.guest_no_manager", "accounts.cap_unknown", "accounts.cap_owner_only", "accounts.cap_not_for_guests", "accounts.cap_owner_has_all",
          "accounts.cap_not_held", "accounts.cap_both_lists",
        ],
      },
    ],
  },
];

/** A Kotlin string literal: backslash, quote and `$` escaped, a line break kept as `\n`. */
export function kotlinLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/\r?\n/g, "\\n")}"`;
}

/** The Kotlin file from the words `collectWords` gathered. */
export function renderAndroidStrings(file: AndroidStringsFile, words: Record<string, string>): string {
  const keys = Object.keys(words).sort();
  const lines = keys.map((k) => `        ${kotlinLiteral(k)} to ${kotlinLiteral(words[k] as string)},`);
  return [
    `// GENERATED by scripts/build-android-strings.mjs from src/lib/i18n/${file.source} — do not edit by hand.`,
    "// tests/android-strings.test.ts fails while this file differs from what the script writes.",
    `package ${file.pkg}`,
    "",
    `/** The site's own words (${file.source}), as the app reads them: [s] fills «{name}» from its arguments. */`,
    `object ${file.name} {`,
    "    val all: Map<String, String> = mapOf(",
    ...lines,
    "    )",
    "",
    "    /** The sentence of [key] with its «{param}» filled; the key itself when the site has no such sentence (a test pins every key used). */",
    "    fun s(key: String, vararg params: Pair<String, Any?>): String {",
    "        var text = all[key] ?: return key",
    "        for ((name, value) in params) text = text.replace(\"{\" + name + \"}\", value?.toString() ?: \"\")",
    "        return text",
    "    }",
    "}",
    "",
  ].join("\n");
}
