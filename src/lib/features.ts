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
export const FEATURES = ["watch", "sectionPermissions", "libraryDrive", "pushEverything", "chatRowMenu", "callNoiseFilter", "instantWork", "avatars", "peopleDock", "chatBubbles", "taskLinks", "milestones", "ownerHiddenOnline", "quickChat", "taskSteps", "reminders", "calendarFeed", "recurringTasks", "timeTracking", "taskRewards", "ownerBoard", "ownerAssistant", "chatAssistant", "chatOutbox", "customFields", "lastSeen", "approvals", "teamDevelopment", "checkins", "okr", "taskRules", "apiDoor", "spaceDocs", "mfgLedger", "calls", "whiteboard", "voiceNotes", "pdfPageCount", "search", "backgroundNudges", "economyMode", "dbBackup"] as const;
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
  // «قراءة الدردشات للمساعد» (src/server/services/chat-assistant.ts): «@المساعد» appears in the «@» list of every chat and topic and answers ONLY when
  // somebody mentions it, once, in that same conversation, from the last 30 messages of THAT conversation with the text filtered first
  // (src/server/ai/redact-chat.ts). OFF until the owner turns it on. It needs «مساعد المالك» on and the owner's key saved. Off: the assistant is not in
  // the list, a typed «@المساعد» is plain text and nothing is read or sent; the answers already posted stay as ordinary lines.
  // ⚠️ An external model reads redacted chat text. 🔧 Phones, e-mails, links and addresses are masked, a conversation with a guest is refused,
  // the audit log keeps who asked and how many characters, never the words.
  chatAssistant: false,
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
  // «الباب» (src/server/services/api-door.ts, docs/contracts/workspace-door.v1.md): the door another Zaki system (System 7) uses to send ideas and
  // tasks to ONE space through /api/v1 with a token the owner makes. OFF until the owner turns it on: off, every /api/v1 route answers «not found»
  // for every token, the tokens card in «الأتمتة» is not drawn and its routes answer «not found»; the tokens, the records and what was sent in stay
  // and come back with the switch. ⚠️ An outside system writes into the company: 🔧 each token holds named permissions and one space, and is revoked in one click.
  apiDoor: false,
  // «المستندات» (src/server/services/documents.ts): the text documents of a space, with their version history, and the PDF viewer of the
  // library. Off: the «المستندات» tab is not drawn and every page and route under /documents and /api/documents answers «not found» for
  // everybody, the owner included; the documents and their history stay and come back with the switch. (The PDF viewer is part of the
  // library and stays: a file is a file.)
  spaceDocs: true,
  // «مخزون التصنيع» (src/server/services/manufacturing*.ts): the materials, lots, append-only movement ledger and stocktakes of a manufacturing
  // space, with the weighted-average cost. Off: the «مخزون التصنيع» tab is not drawn and every page and route under /manufacturing and
  // /api/manufacturing answers «not found» for everybody, the owner included; everything stored stays and comes back with the switch.
  // ⚠️ It records stock and cost only: not accounting, no payment, nothing linked to the OMS. 🔧 Costs are shown only to «الكلفة» holders.
  mfgLedger: true,
  // «المكالمات» (src/server/calls/calls.ts): voice and video on the company's own calls server (LiveKit). Off: «مكالمة» is not drawn,
  // no call or meeting starts, no token is made and the room is not asked for its people (the routes and the call page answer «not
  // found»); somebody still in a call can leave or end it; the call rows already stored stay and come back with the switch.
  calls: true,
  // «السبورة» (src/server/chat/whiteboard.ts): the drawing board of a conversation. Off: the link is not drawn, the page and the two
  // routes answer «not found», nothing is saved (a save can be up to 4 MB) and no live event is sent; the drawings stored stay.
  whiteboard: true,
  // «الرسائل الصوتية» (src/server/chat/messages.ts): record and send a voice note. Off: the microphone button is not drawn and a
  // voice message is refused; the notes already sent stay and still play.
  voiceNotes: true,
  // «عدّ صفحات الـPDF» (src/server/services/files.ts): the viewer shows «12 صفحة». Off: the file is not even read for it (the count
  // reads the whole file into memory, up to 15 MB) and the viewer shows no count; the file itself opens as before.
  pdfPageCount: true,
  // «البحث الشامل» (src/app/api/search/route.ts, src/server/chat/search.ts): the search box over tasks, projects, chat, people and
  // the library. Off: it answers an empty result at once with no database query at all.
  search: true,
  // «تنبيهات الخلفية»: the jobs that only nudge or scan, never act for a person (the check-in reminder three hours after a round opens,
  // the «لما تتأخر» rules' scan of overdue tasks). Off: the job runner skips them; the rounds, rules and everything stored stay, and a
  // nudge or rule not yet fired is fired once the switch is back on. The checks that open rounds, fire reminders, recurrences and close timers are not this.
  backgroundNudges: true,
  // «وضع التوفير» (src/lib/features.ts `ECONOMY_FORCED_OFF`): ONE master switch for a server that is not strong enough. ON, the heavy switches
  // listed in `ECONOMY_FORCED_OFF` behave as OFF and the screen's repeated refreshes are 4 times slower; the owner's own switches are NOT
  // overwritten (an overlay in `featureOn`), so turning this off gives back exactly what he had. OFF until the owner turns it on.
  economyMode: false,
  // «نسخ احتياطي لقاعدة البيانات» (src/server/services/db-backup.ts): a daily copy of the WHOLE database, compressed and encrypted with
  // ENCRYPTION_KEY, uploaded to the OWNER's Google Drive (folder «نسخ احتياطي»), the last 14 days and 4 older weeks kept. OFF until the owner
  // turns it on. Off: the job runner makes no copy, the button, the settings and «تحقّق» answer «not found», and the card in «الأتمتة» only
  // shows the history; the copies already on Drive stay. ⚠️ The copy holds customer data and every password hash. 🔧 Encrypted before it
  // leaves the server, only on the owner's Drive, never without ENCRYPTION_KEY, and restoring is a manual act into a NEW database.
  dbBackup: false,
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

/**
 * «وضع التوفير»: while it is ON, every key of this list behaves as OFF (an OVERLAY: the stored value of the key is never changed, so
 * switching economy off gives back exactly the owner's own choices). The list is what the screen prints; keep it to what costs CPU,
 * memory, disk, bandwidth or DB writes and is not what the company works through: the calls server, the drawing board, watch-together,
 * the microphone filter of a call, the floating chat, the «آخر ظهور» database writes, the nudge/scan jobs and the PDF page count.
 * Chat, tasks, boards, files, voice notes and search stay.
 */
export const ECONOMY_FORCED_OFF = ["calls", "whiteboard", "watch", "callNoiseFilter", "quickChat", "lastSeen", "backgroundNudges", "pdfPageCount"] as const satisfies readonly FeatureKey[];
/** The screen's repeated refreshes (the bell, the cards of «اليوم», the realtime fallback) wait this many times longer in economy mode. */
export const ECONOMY_POLL_FACTOR = 4;

const ECONOMY_SET: ReadonlySet<FeatureKey> = new Set<FeatureKey>(ECONOMY_FORCED_OFF);

/** What the owner set for one key (or its default), whatever economy mode says. */
function ownChoice(orgSettings: unknown, key: FeatureKey): boolean {
  return storedOf(orgSettings)[key] ?? FEATURE_DEFAULTS[key];
}

/** Is «وضع التوفير» on for this company? */
export function economyOn(orgSettings: unknown): boolean {
  return ownChoice(orgSettings, "economyMode");
}

/** Is this feature on for the company whose settings these are? Unset: its default; economy mode switches the heavy ones off. */
export function featureOn(orgSettings: unknown, key: FeatureKey): boolean {
  if (!ownChoice(orgSettings, key)) return false;
  return !(ECONOMY_SET.has(key) && economyOn(orgSettings));
}

/** Every switch of the company as it is IN FORCE (economy mode applied), each with its default filled in. */
export function featuresOf(orgSettings: unknown): Record<FeatureKey, boolean> {
  return Object.fromEntries(FEATURES.map((key) => [key, featureOn(orgSettings, key)])) as Record<FeatureKey, boolean>;
}

/** Every switch as the OWNER set it (economy mode NOT applied): what «الميزات» shows on each toggle. */
export function ownChoicesOf(orgSettings: unknown): Record<FeatureKey, boolean> {
  return Object.fromEntries(FEATURES.map((key) => [key, ownChoice(orgSettings, key)])) as Record<FeatureKey, boolean>;
}

/** The keys the owner left on that economy mode is holding off right now (empty when economy mode is off). */
export function economyHeldOff(orgSettings: unknown): FeatureKey[] {
  if (!economyOn(orgSettings)) return [];
  return ECONOMY_FORCED_OFF.filter((key) => ownChoice(orgSettings, key));
}

/**
 * The keys that are off (what the map of places is told to hide). «وضع التوفير» itself is not a place and is never listed here
 * (it is off by default, and listing it would change what every company's map is told).
 */
export function featuresOff(orgSettings: unknown): FeatureKey[] {
  const all = featuresOf(orgSettings);
  return FEATURES.filter((key) => key !== "economyMode" && !all[key]);
}

/** `Organization.settings` with one switch set, every other key of the settings kept as it was. */
export function withFeature(orgSettings: unknown, key: FeatureKey, on: boolean): Record<string, unknown> {
  const base = orgSettings && typeof orgSettings === "object" ? (orgSettings as Record<string, unknown>) : {};
  const features = base["features"] && typeof base["features"] === "object" ? (base["features"] as Record<string, unknown>) : {};
  return { ...base, features: { ...features, [key]: on } };
}
