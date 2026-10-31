/**
 * «الميزات» — THE OWNER'S ON/OFF SWITCHES, ONE PER FEATURE.
 *
 * The owner's rule (2026-10-26, «كل اشي ينضاف ك فيتشر اقدر اطفيه وارجع الموقع للمود الأصلي»): every new
 * feature sits behind its own switch. Off, the site is as it was before that feature: nothing of it is offered
 * or answers, and nothing it holds is lost (switched on again, everything is back).
 *
 * Pure (no React, no server imports): the map of places hides a switched-off feature's place, the server refuses
 * its routes (src/server/services/features.ts), and «الميزات» in the settings lists every key.
 *
 * 🔧 A new feature is one key here, its default, and its two lines in the dictionary
 *    (`features.<key>.name`, `features.<key>.hint`); tests/features.test.ts fails on a key without them.
 */

/** Every switch, in the order «الميزات» lists them. */
export const FEATURES = ["watch", "sectionPermissions", "libraryDrive", "pushEverything", "chatRowMenu", "callNoiseFilter", "instantWork", "avatars", "peopleDock", "chatBubbles", "taskLinks", "milestones", "ownerHiddenOnline", "quickChat", "taskSteps", "reminders", "calendarFeed", "recurringTasks", "timeTracking", "taskRewards", "ownerBoard", "ownerAssistant", "chatOutbox", "customFields", "lastSeen", "approvals", "teamDevelopment", "checkins", "okr", "taskRules"] as const;
export type FeatureKey = (typeof FEATURES)[number];

/** A key nobody switched yet is this (a new feature is on unless its key says otherwise). */
export const FEATURE_DEFAULTS: Readonly<Record<FeatureKey, boolean>> = {
  watch: true,
  // the per-person section grid «الأقسام» (src/server/policy/capabilities.ts): off, everyone has their rank's template
  sectionPermissions: true,
  // new library files go to the owner's Google Drive (src/server/files/drive-store.ts): off, they are written to the
  // server as before; the files already on Drive still open
  libraryDrive: true,
  // every notification of the bell also reaches the person's phone and laptop while the site is closed (Web Push);
  // off: only a ringing call does, as before
  pushEverything: true,
  // «⋯» next to every topic and chat of the list (pin, archive, delete) and the owner's «حذف نهائي» (src/server/chat/purge.ts)
  chatRowMenu: true,
  // the noise filter on the microphone in calls (src/components/calls/noise-filter.ts): off, the voice is sent as the
  // browser captures it, as before
  callNoiseFilter: true,
  // «مهمة فورية» and «تذكرة فورية» (src/server/services/instant-work.ts): off, neither is offered and their routes
  // answer «not found»; the ones already made stay where they are
  instantWork: true,
  // a person's own picture (src/server/services/avatars.ts): off, nobody uploads or removes one and the profile page
  // does not offer it; the pictures already uploaded keep showing (they are data, like a file already on Drive)
  avatars: true,
  // the staff strip along the bottom of the shell (src/components/shell/people-dock.tsx): off, the row is not drawn
  // and `/api/presence` answers «not found»; the presence itself is untouched
  peopleDock: true,
  // the modern message layout with the sender outside the bubble and a day separator (message-item.tsx,
  // lib/chat/day-separator.ts): off, the log goes back to the previous bubble and has no day lines
  chatBubbles: true,
  // «التبعيات» on a task (src/server/services/task-links.ts): off, the card is not drawn and its routes answer
  // «not found»; the links already stored stay, and come back with the switch
  taskLinks: true,
  // «المعالم» on a project (src/server/services/milestones.ts): off, the card is not drawn, the task's picker is not
  // offered and the routes answer «not found»; the milestones already made stay where they are
  milestones: true,
  // «إخفاء المالك من متصل» (the owner, 2026-10-30: «ميزة اقدر افعلها والغيها»): ON, everybody else sees the owner as not
  // at his screen (the people dock, the member pills of a conversation); he still sees himself. OFF (the default): as
  // before. Only what is DRAWN changes: whether he receives a notification still follows his real presence.
  ownerHiddenOnline: false,
  // the floating quick chat in the corner of the shell (src/components/shell/quick-chat.tsx): off, the button is not
  // drawn; the chat itself and every message already sent are untouched
  quickChat: true,
  // «خطوات» inside a task (src/server/services/task-steps.ts): off, the card is not drawn, the little «3 من 5» on the
  // cards is gone and the routes answer «not found»; the steps already written stay and come back with the switch
  taskSteps: true,
  // «ذكّرني» (src/server/services/reminders.ts): off, no «ذكّرني» button, no «تذكيراتي» card, the routes answer «not found»
  // and the job runner fires nothing; the reminders already set wait and are due again when the switch is back on
  reminders: true,
  // «حساب وقت الشغل» (src/server/services/time-tracking.ts): off, no «الوقت» card on a task, no «وقتي اليوم» on Today, no
  // report page, the routes answer «not found» and the job runner closes no timer; the entries already logged stay and come
  // back with the switch
  timeTracking: true,
  // «مهمة متكررة» (src/server/services/task-recurrence.ts): off, the «تكرار» control and the «🔁 متكررة» badge are not drawn, the
  // routes answer «not found» and neither the job runner nor a completion makes a new occurrence; the series already set
  // wait, and are due again when the switch is back on
  recurringTasks: true,
  // «اشتراك التقويم» (src/server/services/calendar-feed.ts): off, the card on the calendar page is not drawn, the routes
  // under /api/me/calendar-feed and every private feed link answer «not found»; the links already made stay and work again
  // with the switch
  calendarFeed: true,
  // «لوحة المالك» (src/server/services/owner-board.ts): off, the tab is not drawn, the pages /owner and the routes of
  // /api/owner-board answer «not found» for everybody, the owner included; nothing is stored by the board, so nothing is lost
  ownerBoard: true,
  // «مهمة بمكافأة» and «تثبيت» (src/server/services/rewards.ts): off, no reward toggle, card or badge, no pin button, the
  // routes answer «not found» and the owner-only lock on reward tasks is lifted (a task is a plain task again); the rewards
  // and pins already stored stay in the data and come back with the switch
  taskRewards: true,
  // «مساعد المالك» (src/server/services/owner-assistant*.ts): an analyst for the OWNER alone on top of «لوحة المالك», OFF until the
  // owner turns it on AND enters his own key (it needs one). Off: the tab is not drawn and the pages and the routes under
  // /owner/assistant and /api/owner-assistant answer «not found» for everybody, the owner included; the saved settings and
  // conversations stay and come back with the switch. It reads the board, so it also needs «لوحة المالك» on.
  ownerAssistant: false,
  // «الرسائل بدون نت» (src/lib/chat/outbox/): a message that cannot be sent because the network is gone is kept in the browser,
  // shown as «بانتظار الإرسال» and sent again by itself (in order, once, even if the first try did reach the server), and what is
  // typed and not sent is kept per conversation. Off: sending fails with an error and the text stays in the box, as before; the
  // messages already waiting stay in the browser and are sent when the switch is back on
  chatOutbox: true,
  // «حقول مخصصة» (src/server/services/custom-fields.ts): the fields a space's ADMIN defines on a project's tasks. Off: no «حقول
  // مخصصة» card on the task, no «إدارة الحقول» on the project, no chips, filter or sort on the list and the board, the routes answer
  // «not found» and a required field stops asking at completion; the fields and the values already stored stay and come back with the switch
  customFields: true,
  // «التسجيل اليومي» (src/server/services/checkins.ts): a short daily stand-up per space. Off, the tab, the card on «اليوم» and the
  // page are gone (the page and the routes answer «not found»), the job runner opens no round and sends no nudge; the
  // configurations, rounds and answers already stored stay and come back with the switch
  checkins: true,
  // «آخر ظهور» (src/server/services/last-seen.ts): under a person's name, when they were last at their screen («آخر ظهور قبل 10 دقايق»), in the
  // people dock, the quick chat, the header of a private chat and the profile page. Off: those places say «غير متصل» as before, the
  // fields leave every answer, `PATCH /api/me/last-seen` answers «not found» and the presence layer records no new time; the times
  // already recorded and each person's «إخفاء آخر ظهوري» choice stay and come back with the switch.
  lastSeen: true,
  // «طلبات الموافقة ونماذج» (src/server/services/approvals.ts, approval-forms.ts): a request for a decision from one approver or a chain of
  // up to three, and reusable forms that create them. Off: the «الموافقات» tab is not drawn, the pages /approvals and the routes under
  // /api/approvals and /api/approval-forms answer «not found» for everybody, the owner included, and no bell notice is written; the
  // requests, steps and forms already stored stay and come back with the switch. An approval only records a decision: it never moves money.
  approvals: true,
  // «الأداء والتطوير» (src/server/services/team-*.ts): the reporting lines («الهيكل»), the skills checklist, the scores, the reviews and the
  // development plans. Off, the tabs are not drawn and every page and route under /structure, /development and /api/team-development
  // answers «not found» for everybody, the owner included; nothing it stores is touched and everything is back with the switch.
  teamDevelopment: true,
  // «الأهداف والنتائج» (src/server/services/okr.ts, src/lib/okr.ts): an objective of «الأهداف» gets up to five measurable key results, an owner,
  // a quarter, check-ins and a status light the person sets. Off, the goals page is as it was (weekly and monthly, one hand-moved number),
  // the routes under /api/key-results and /api/goals/[id]/key-results answer «not found», and a new goal cannot use any of it; the
  // owners, lights, key results and check-ins already stored stay and come back with the switch.
  okr: true,
  // «القواعد التلقائية» (src/server/services/task-rules*.ts): simple if-then rules per project (a task moved, completed, created or overdue
  // -> assign, set the priority, move, add a step, notify, post a line). Off: the «القواعد» section of the project page is not drawn, the
  // routes under /api/projects/[id]/rules answer «not found», no rule runs (a task event and the job runner skip them); the rules and
  // the log already stored stay and everything is back with the switch.
  taskRules: true,
};

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && (FEATURES as readonly string[]).includes(value);
}

/** The switches stored on the company (`Organization.settings.features`), unknown or broken entries ignored. */
function storedOf(orgSettings: unknown): Partial<Record<FeatureKey, boolean>> {
  if (!orgSettings || typeof orgSettings !== "object") return {};
  const features = (orgSettings as { features?: unknown }).features;
  if (!features || typeof features !== "object") return {};
  const out: Partial<Record<FeatureKey, boolean>> = {};
  for (const key of FEATURES) {
    const v = (features as Record<string, unknown>)[key];
    if (typeof v === "boolean") out[key] = v;
  }
  return out;
}

/** Is this feature on for the company whose settings these are? Unset: its default. */
export function featureOn(orgSettings: unknown, key: FeatureKey): boolean {
  return storedOf(orgSettings)[key] ?? FEATURE_DEFAULTS[key];
}

/** Every switch of the company, each with its default filled in. */
export function featuresOf(orgSettings: unknown): Record<FeatureKey, boolean> {
  const stored = storedOf(orgSettings);
  return Object.fromEntries(FEATURES.map((key) => [key, stored[key] ?? FEATURE_DEFAULTS[key]])) as Record<FeatureKey, boolean>;
}

/** The keys that are off (what the map of places is told to hide). */
export function featuresOff(orgSettings: unknown): FeatureKey[] {
  const all = featuresOf(orgSettings);
  return FEATURES.filter((key) => !all[key]);
}

/** `Organization.settings` with one switch set, every other key of the settings kept as it was. */
export function withFeature(orgSettings: unknown, key: FeatureKey, on: boolean): Record<string, unknown> {
  const base = orgSettings && typeof orgSettings === "object" ? (orgSettings as Record<string, unknown>) : {};
  const features = base["features"] && typeof base["features"] === "object" ? (base["features"] as Record<string, unknown>) : {};
  return { ...base, features: { ...features, [key]: on } };
}
