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
export const FEATURES = ["watch", "sectionPermissions", "libraryDrive", "pushEverything", "chatRowMenu", "callNoiseFilter", "instantWork", "avatars", "peopleDock", "chatBubbles", "taskLinks", "milestones", "ownerHiddenOnline", "quickChat", "taskSteps", "reminders", "calendarFeed", "recurringTasks", "timeTracking", "taskRewards", "ownerBoard", "ownerAssistant", "chatAssistant", "chatOutbox", "customFields", "lastSeen", "approvals", "teamDevelopment", "checkins", "okr", "taskRules", "apiDoor", "spaceDocs", "mfgLedger", "calls", "whiteboard", "voiceNotes", "pdfPageCount", "search", "backgroundNudges", "economyMode", "dbBackup", "controlPanel", "voiceTranscript", "externalGateway", "assistantContact", "assistantWorkData", "assistantProposals", "siteGuide", "morningDigest", "watchConvert", "messageTranslate", "imageOcr", "semanticSearch", "emailToTask", "appConnection", "assistantInMeetings", "themeSwitchFx", "taskPrivacy", "omsLink", "knowledgeCards", "quickRecall", "orderStatus", "autoTickets", "mustRead", "orderTemplateHint", "navV2", "chatOneList", "omsEvents", "doorMessages", "chatLayoutV2", "chatFormatting", "workInbox", "chatAlbums", "permissionTemplates", "workRequests", "chatPersonalState", "chatFolders", "savedMessages", "linkPreviews", "chatSilentSend", "chatScheduled"] as const;
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
  // the Android app's live line (src/server/devices/devices.ts, /api/device/stream): the full-screen ring and the notifications reach the app
  // even when it is closed. Off: nobody can pair a phone, the line answers «not found» and everything goes through the browser's Web Push as before
  appConnection: true,
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
  // «كتابة نص الرسالة الصوتية» (src/server/services/voice-transcript.ts): a «اكتب النص» button under a voice note sends the recording to a
  // speech-to-text service the owner runs on his OWN machine (env TRANSCRIBE_URL, judged by src/server/ai/local-host.ts) and shows the text.
  // Off by default: the audio leaves the app for that service. Off: no button, the route answers «not found», nothing is sent; the texts
  // already written stay with their notes.
  voiceTranscript: false,
  // «بوابة نموذج خارجية» (src/server/services/gateway-address.ts): the OpenAI-compatible gateway of the owner's assistant may live at an
  // https address on the internet (a public name), not only inside the server. Off by default: the questions then leave the server. Off:
  // an outside address is refused (the old rule). The privacy filter stays ON for such a model whatever the «محلي» tick says.
  externalGateway: false,
  // «المساعد» كجهة اتصال (src/server/services/assistant-chat.ts): the row «المساعد» in the chat's people lists opens the person's own conversation
  // with the assistant, and every message written there is answered without «@». On by default, but only ever offered where «@المساعد» is (its two
  // switches and a ready model). Off: no row, the route answers «not found», nothing is answered without «@»; the conversations made stay.
  assistantContact: true,
  // «المساعد يعرف شغلك» (src/server/services/assistant-work.ts): in a person's OWN conversation with the assistant, every question also
  // carries their work picture (the owner: the board's numbers of 7 days; anybody else: only their own open tasks), through the same
  // filter as «مساعد المالك». Off: the contact answers from the conversation alone, as before.
  assistantWorkData: true,
  // «المساعد يقترح» (src/server/services/chat-assistant.ts): in the OWNER's own conversation with the assistant it may propose the five
  // actions of «مساعد المالك» (new task, change the assignee, a due day, pin, remind) as cards with «وافق» / «ارفض»; nothing runs until he
  // presses «وافق». Off: it only talks. The proposals already made stay.
  assistantProposals: true,
  // «المرشد» (src/server/services/site-guide.ts, src/components/site-guide): the OWNER guide that looks at the page he is on (a filtered list of
  // its controls), takes him to pages, points at things and explains them out loud, and clicks or types ONLY after he presses «نفّذ». Owner only.
  // Off: no button, no voice call, the route answers not found.
  siteGuide: true,
  // «شو فاتني؟» (src/server/services/digest.ts, src/components/digest): a short card on «اليوم» written by the owner's assistant — what changed in the
  // person's own tasks and in the topics they missed — and a «لخّصلي» button inside a topic. Only what the person may already read, filtered like the
  // chat assistant, generated when the card is opened and kept 3 hours. OFF until the owner turns it on (it sends redacted work text to the model);
  // needs «مساعد المالك» and «قراءة الدردشات للمساعد» on and a ready provider. Off: no card, no button, the routes answer not found.
  morningDigest: false,
  // «حوّل» in «نتفرّج سوا» (src/server/watch/convert.ts, src/components/watch/watch-comments.tsx): a comment of a session becomes a task, an idea
  // or a project, and the comment shows what it became. Off: the action is not drawn, the doors refuse a link back to a comment, and the
  // room itself and what was already made stay. Harmless UI: on.
  watchConvert: true,
  // «ترجمة رسالة» (src/server/services/message-translate.ts): a «ترجم» item in the message menu turns a text message into Arabic (or English when it is
  // mostly Arabic) with the owner's assistant model, after the privacy filter. Needs «مساعد المالك» and «قراءة الدردشات للمساعد» on and a ready model; staff only,
  // never in a conversation a guest can reach. The translation is shown to the asker only and is never stored. Off by default: the message text leaves for the
  // model. Off: no item, the route answers «not found».
  messageTranslate: false,
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
  // «لوحة التحكم» (src/server/services/control-panel.ts): «لوحة المالك» on the home screen «اليوم» for the OWNER rank alone, with smart sentences
  // (each with its formula), «التقارير» merged into it and the state of «زاكي أي أي». It needs «لوحة المالك» on. Off: «اليوم» has no panel, the
  // tab is «لوحة المالك» again, «التقارير» is its own page again for the owner too, and /api/control-panel answers «not found»; it stores
  // nothing of its own, so nothing is lost.
  controlPanel: true,
  // «بحث بالمعنى» (src/server/services/search-semantic.ts, search-embed-index.ts): the search box also finds a message or task by its MEANING («علب التغليف» finds «الكراتين»),
  // marked «بمعنى قريب» and always after the hits the words found. The text of messages and tasks (after the chat filter, never a direct chat,
  // never a conversation or space a guest can reach) is sent to the embeddings service of the server (env EMBED_URL, EMBED_MODEL, EMBED_API_KEY); the
  // vectors stay in the database. OFF by default: text leaves the app. Off: the search is the word search exactly as before, nothing is sent,
  // indexed or queried; the vectors already made stay and come back with the switch.
  // «المعنيين بس» (src/server/services/team-scope.ts, tasks.ts): a task can be private to the people it concerns. The read rule of a
  // private task ALWAYS applies, whatever this says (a private row never leaks because a switch was flipped); this switch only
  // makes a NEW task that somebody holds private by default. OFF until the owner answers D-P2: new tasks stay «المساحة كلها»
  // and the person may choose «المعنيين بس» on each one (or the space's manager does it in one click for the open ones).
  taskPrivacy: false,
  // «ربط نظام الطلبات» (src/server/integrations/oms.ts, oms-sync.ts, Q1.0): the company's orders system is read — the products (name, price,
  // offers, stock) into the snapshot beside each linked sheet (`Card.external`), every 5 minutes. A price is never typed here, only read; one older
  // than 30 minutes is shown as stale and never copied or sent. OFF by default: the token and the system's address are set in «التكاملات»
  // first. Off: the integration card says it is off, the job reads nothing, the snapshots already kept stay as they were.
  omsLink: false,
  // «المنتجات» (src/server/services/knowledge.ts, Q1.1): a product sheet per product, with copy buttons, an offer message built from the live price,
  // questions and answers. Written by the space's managers and the people the owner named; a sheet nobody approved is invisible to the rest;
  // an external partner never comes in. OFF by default: off, the page and its doors answer «not found» and the sheets already made stay.
  knowledgeCards: false,
  // «/» في صندوق الكتابة (src/server/chat/recall.ts, Q1.3): a menu in the composer — «منتج» sends an approved product sheet into the conversation as a card
  // (no price in the message: each reader's screen asks for the card), «رد» inserts an approved answer for the person to edit and send. Needs
  // «المنتجات». OFF by default: off, the menu and its two doors do not exist; the cards already sent stay.
  quickRecall: false,
  orderStatus: false,
  // «المشاكل تصير تذاكر» (src/server/services/problem-tickets.ts, Q1.5): «🎫 مشكلة» on a message makes a ticket where the message is, one ticket per order,
  // the customer's number kept encrypted and wiped 30 days after resolve. OFF by default: off, the door answers not found.
  autoTickets: false,
  // «لازم ينقرأ» (src/server/services/must-read.ts, Q1.6): a moderator marks an instruction post; each person it reaches taps «قرأت ✓» (a ✅ reaction); the
  // author sees who has not and the late ones are reminded in working hours. OFF by default: off, no button, no count, no reminder.
  mustRead: false,
  // «تنبيه بيانات الزبون» (src/lib/chat/customer-data-hint.ts, Q1.7): a hint line for the author and the moderators when customer data (the order template, a phone
  // number) is typed into an open topic. Hints only: nothing is blocked, hidden or changed. OFF by default.
  orderTemplateHint: false,
  // «القائمة الجديدة» (src/lib/nav/places.ts, N1.1): the new map of places - الدردشة · اليوم · الشغل · المكتبة · نتفرّج سوا · الإدارة (or «الناس»), at most four tabs and «المزيد»
  // in each place, the landing page the company chose (`Organization.settings.landing`) and the glossary's names. OFF by default: off, the old map (PLACES_V1) is drawn and «/» is «اليوم»,
  // as before (the glossary's words are renamed for everybody). Nothing is removed by either map: every old address is still a page.
  navV2: false,
  // «قائمة دردشة وحدة» (src/server/chat/list.ts, C1.2, D-N2): ON, `GET /api/chat/list` answers with ONE list - every space as a forum row with its topics and every private
  // chat of the person (each with a small space chip) - like the team's Telegram; OFF, it answers with the space the person is in only («كل مساحة حساب», the owner's
  // decision of 2026-10-25). Either way `?spaceId=` asks for one space. The recommended answer is built as the default while the owner has not answered D-N2 (pending);
  // nothing is stored by either shape, so flipping it back and forth loses nothing.
  chatOneList: true,
  // «أحداث نظام الطلبات» (src/server/integrations/oms-events.ts, I1.1a) — group: التكاملات · dependsOn: none (the receiver needs only its own secret; «ربط نظام الطلبات» is a separate link):
  // the orders system sends its own signed events (confirmed, shipped, delivered, returned, cancelled) to `POST /api/integrations/oms/events/[receiverId]`; each one refreshes the
  // order's state, may post a CARD into the topic the owner chose and open a ticket (returned, cancelled), and a daily card counts them. total, currency and city are dropped at the door.
  // OFF by default: off, the receiver answers «not found» for everybody, the daily card is not sent; the states and counts already kept stay.
  omsEvents: false,
  // «باب الرسائل» (src/server/chat/door-message.ts, docs/contracts/workspace-door.v2.md, I1.1b) — group: التكاملات · dependsOn: apiDoor:
  // another system (the media buyer, n8n) posts a CARD into one topic of the token's space with `POST /api/v2/messages` (permission messages.write). OFF by default: off, the route answers
  // «not found» for every token; the cards already posted stay. ⚠️ An outside system writes into a chat. 🔧 A topic must be given a door name first, a button needs its host allowed on the token, and every text is checked for phone numbers.
  doorMessages: false,
  // «شاشة الدردشة الجديدة» (src/app/(app)/chat/layout.tsx, src/components/chat/v2/, C2.1 + C2.2 + C2.3): the Telegram-style chat - the list column that stays while the person moves between chats (folders, virtual rows, the forum view of a space) beside the
  // conversation, instead of one page of cards. OFF by default (the owner turns it on after his own check, ✋C2): off, `/chat` is today's `ChatHomeClient` and `/chat/[id]` today's conversation page, unchanged; nothing
  // it shows is stored by it, so switching it back and forth loses nothing. The two shapes of the list (`chatOneList`) and the two menus (`navV2`) are separate switches and each combination works.
  chatLayoutV2: false,
  // «تنسيق النص» (src/lib/chat/format/, C3b.1): bold, italic, strike, code, a code block, a spoiler, a quote line, `[text](https://...)` and bare links drawn in the NEW chat screen's bubbles, plus a selection toolbar and the
  // keyboard shortcuts (Ctrl+B, I, U, K and Ctrl+Shift+X, M) in its composer. The text stays plain text in `ChatMessage.body` (no schema); every preview, push, search snippet and text sent to a model shows the words without the markers.
  // ON by default. Off: the body is drawn as plain text and the composer draws no toolbar and answers no shortcut; what people wrote stays as typed, and switching it back on brings the formatting back.
  chatFormatting: true,
  // «صندوق المهام» (src/server/services/instant-work.ts, W1.2, D-N3): the hidden «مهام فورية» project of each space becomes a visible, named, pinned inbox on top of
  // «المشاريع»; a quick task from anywhere (Today's quick add, «اعمل منها مهمة» with no project chosen, «جديد») lands there in «للتنفيذ»; made while in «الشركة» (which holds no
  // projects) it lands in the inbox of the person's first standard space, and with none the quick add says why. A quick task with an assignee is «المعنيين بس». OFF by default:
  // off, «مهام فورية» is the hidden project it was, Today's quick add uses the first project with a board and nothing else changes; the projects and tasks already there are never moved or deleted.
  workInbox: false,
  // «ألبومات الصور وعارض الوسائط» (src/lib/chat/album-layout.ts, src/components/chat/v2/media-viewer.tsx, C3b.3): a message with two to ten pictures or videos is ONE mosaic in the NEW chat screen's bubbles, and a tap on a picture opens a
  // full-screen viewer (arrows and swipe between the conversation's media, zoom, download, «اعرض بالمحادثة», the caption). The composer sends up to ten files in one message with one caption. No schema: the sizes were already stored.
  // ON by default. Off: every picture is its own box as before and nothing opens; the messages and files are untouched, and switching it back on brings the mosaics back.
  chatAlbums: true,
  // «القوالب» (src/lib/permission-templates.ts, src/server/services/permission-templates.ts, A1.1): a template is a rank plus the boxes it adds and takes away (seven starters: «مدير مساحة»,
  // «موظف», «مبيعات وتأكيد طلبات», «ميديا باير», «مونتاج وتصميم», «محاسبة», «مشاهدة فقط»), kept in the company's settings; the create-account sheet gets «القالب» and the person's sheet «تطبيق قالب»
  // with «القالب: X» and «معدّل» once changed by hand. Applying goes THROUGH the account service (the same rank rules, audited): a template never gives more than the applier holds, a guest template does not exist, and
  // archive.view is never in one. OFF by default: no picker anywhere, the routes answer «not found», an account is made and edited exactly as before; the templates already saved and the people already given one stay.
  permissionTemplates: false,
  // «صندوق الطلبات» (src/server/services/work-requests.ts, src/app/(app)/requests/, W1.4): ONE screen for everything that waits for a decision - «بانتظاري» (approvals whose turn is mine, task assignment
  // requests addressed to me, the open tickets of my departments, cards and product sheets I decide) and «طلباتي» - each row acting in place through the doors that already exist (approvals, task accept and return, tickets,
  // card status, sheet status), and the number on «الشغل». OFF by default: off, «الطلبات» of the new map is today's approvals page and no number rides on «الشغل». Nothing it shows is stored by it.
  workRequests: false,
  // «التثبيت والأرشفة الشخصية» (src/server/chat/read-state.ts `setMyChatState`, `PUT /api/chat/conversations/[id]/me`, C3a.1): in the NEW chat screen a person pins up to ten chats on top of THEIR list, archives a chat (it
  // comes back when a message arrives, unless it is muted), marks it unread by hand, and mutes it for an hour, eight hours, a day, a week or for good - all «لإلك بس»: nobody else sees any of it, and the managers' pin and archive of a topic
  // (for everybody) are untouched. A person who reads in silent oversight can do none of it (a 404, no trace). ON by default. Off: no menu item and no «الأرشيف» tab is drawn, the route answers «not found», the list sends none of it (an
  // archived chat is in the list again); the pins, archives and marks already made stay in the data and come back with the switch.
  chatPersonalState: true,
  // «المجلدات» (src/lib/chat/folders.ts, src/lib/chat/prefs.ts, `GET/PUT /api/me/chat-prefs`, C3a.2): in the NEW chat screen a person makes up to ten folders of their own (a name of 12 letters at most, an emoji, the private chats, the spaces, the mentions,
  // chats picked by hand, whole spaces; minus the muted, the read or the archived), drags them into the order they like and may hide the built-in tabs - all «لإلك بس», kept on their account (`User.chatPrefs`). A folder only filters the list the person already
  // has, so a chat they can no longer read shows nothing in it. ON by default. Off: no folder tab is drawn, the folders are not answered and cannot be saved (the route answers «not found» for them; the other prefs still work), and the built-in tabs are the five of
  // today; what was saved stays in the data and comes back with the switch.
  chatFolders: true,
  // «الرسائل المحفوظة» (src/server/chat/dm.ts `openSavedMessages`, `POST /api/chat/dm` `{ saved: true }`, C3a.3): in the NEW chat screen a person has a private chat with themselves (a DM whose two people are the same person, kept pinned on top of their list; Ctrl+0
  // opens it) and «حوّل للمحفوظة» in a message's menu keeps a message there. No new table: it is a DM with one row. ⚠️ It is NOT secret from the owner: the same oversight rule as every private chat (the owner reads it silently, an outsider and a guest never do), and the
  // info panel says so in one line. 🔧 Nothing of the company's work belongs there that the person would not want the owner to read. ON by default. Off: the chat leaves the list and the menu has no item, the door answers «not found»; what was saved stays and comes back with the switch.
  savedMessages: true,
  // «معاينة الرابط» (src/server/chat/link-preview.ts, C3b.2): right AFTER a message with a link is sent, the SERVER reads that public page (its title, description, site name and one picture) and the bubble draws a card under the words; the
  // sender can switch the card off in the composer (✕) and remove it from their own message («شيل المعاينة»). ON by default, but it works only where the NEW chat screen (`chatLayoutV2`) is on too (`linkPreviewsOn`): that screen draws the card and has the ✕ and «شيل المعاينة»; with it off nothing is visited. Off: no page is visited, no card is drawn or sent and the routes answer «not found»; the cards already made stay in the data
  // and come back with the switch. ⚠️ The server visits the link: the site sees the address of this server, never the person's, and no cookie, no login and no company data is sent. 🔧 Only public https pages (a private or internal address is refused,
  // at every redirect too), 3 seconds, 512 KB; the picture is kept by the app and shown only to people who may read the message; it is written in the guide.
  linkPreviews: true,
  // «ابعت بدون صوت» (src/server/chat/messages.ts, notify.ts, C3c.2): on the send button's menu (right-click on the computer, long press on a phone) a message can be sent silently: it is a normal message for reading, the unread count and the app badge, but it makes no
  // bell, no push and no arrival sound for anybody, a person who is @mentioned included (the sender chose silence; the mention stays among that person's unread mentions). ON by default. Off: the route ignores the flag (the message is an ordinary one) and the menu entry is not drawn; messages
  // already sent silent stay silent and come back with the switch.
  chatSilentSend: true,
  // «جدول الإرسال» (src/server/chat/scheduled.ts, src/server/jobs/chat-scheduled.ts, C3c.3): on the send button's menu (right-click on the computer, long press on a phone) a message is scheduled for a later moment (a date and a time in the company's time zone,
  // at least a minute ahead and at most a year); a calendar icon in the composer lists the person's waiting messages with «ابعت هلّق», «عدّل» and «احذف». The rows live in a table of their own that no message reader ever reads, and ONLY their author sees them.
  // At its time the job sends the message through the normal send AS the author and checks again that they may still write there: a person who lost access sends nothing and is told by a note to themselves. ON by default. Off: the routes answer «not found»,
  // the menu entry and the icon are not drawn and the job leaves the waiting rows alone (they are sent when the switch is back, late); the rows already made stay in the data.
  chatScheduled: true,
  semanticSearch: false,
  // «قراءة نص الصور» (src/server/services/image-ocr.ts): a button on a picture (a chat image, a library image) sends it to a vision model service the
  // owner set up (env OCR_URL, OCR_MODEL, optional OCR_API_KEY; an https public name or an inside address, judged by src/server/ai/local-host.ts),
  // keeps the text it reads (FileText) under the picture, and search finds the picture by those words under the file's own visibility rule.
  // Off by default: the picture leaves the app for that service. Off: no button, the routes answer «not found», nothing is sent and search
  // ignores the kept texts; the texts already read stay.
  imageOcr: false,
  // «بريد يصير مهمة» (src/server/services/mail-to-task.ts): the app reads the company mailbox (the owner types its app password into the card himself,
  // stored encrypted) and each new mail becomes one task: the subject and a short plain-text excerpt, never an attachment, nothing sent to any model, no
  // mail deleted, moved or answered. OFF until the owner turns it on. Off: the job reads nothing, the settings and the connection test answer «not found»
  // (taking the mailbox out of the card still works); the tasks already made stay. ⚠️ The app reads a mailbox and keeps each subject and a short excerpt.
  // 🔧 Turn it off here and take the mailbox out of the card: the password is deleted.
  emailToTask: false,
  // «المساعد بالاجتماعات» (src/server/calls/assistant-agent.ts): the owner calls his assistant into a call: it listens and answers by voice when somebody speaks to
  // it. The sound goes through a small program of the owner's OWN (voice-agent/, on his server): speech to text and text to speech both run there, free; the words
  // that reach the model are filtered like the chat assistant's. OFF until the owner turns it on; it needs «مساعد المالك» on and the program's address and secret in Coolify.
  // Off: no button in the call, the routes answer «not found», an assistant already in a room is sent away. ⚠️ While it is in the call its program hears everybody in the room.
  // 🔧 Only the owner calls it in, the room sees «المساعد» as a participant, and he sends it out with one tap; nothing of the sound is stored.
  assistantInMeetings: false,
  // «مظهر المفتاح» (src/lib/themes/switch-fx.ts, src/components/theme/theme-switch.tsx): the light/dark switch of the top bar may wear one of four looks (glass,
  // lamp, sky, colour temperature) chosen per person, and changes the theme with a torn-edge reveal. All in the browser: no network, no model. Off: only the plain
  // compact switch, no effect code is loaded and no tint is drawn; the choices already saved stay and come back with the switch. «وضع التوفير» still keeps its
  // motion off while this is on. ⚠️ A tint changes the colours of the whole screen a little. 🔧 It is capped, «رجّع» clears it, and this switch removes it.
  themeSwitchFx: true,
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

/**
 * C4.3 — «الدردشة»: the company's chat switches as DATA, in the order of the spec (docs/restructure/C4-settings.md section 4). `FeatureSwitches` draws this
 * group first on «الميزات» (until A2's «إعدادات الشركة»; A1.4 turns the whole list into groups with `dependsOn` and absorbs this one). It adds, renames and
 * removes no switch: every key is a key of `FEATURES` and keeps its own name and hint.
 *   risk  the switch has a ⚠️ and its 🔧 under it (`companyChat.warn.<key>` / `companyChat.fix.<key>`, src/lib/i18n/ar.settings-company-chat.json):
 *         the server visits links, message text goes to a model (never a customer's data to an outside one), who is seen and when.
 *   note  a line of explanation under the hint (`companyChat.note.<key>`): «شكل الرسائل الحديث» is the company's default look.
 * Nothing here moves into a person's own settings: it is the owner's.
 */
export const COMPANY_CHAT_GROUP: ReadonlyArray<{ key: FeatureKey; risk?: true; note?: true }> = [
  { key: "chatBubbles", note: true },
  { key: "chatOutbox" },
  { key: "voiceNotes" },
  { key: "voiceTranscript", risk: true },
  { key: "messageTranslate", risk: true },
  { key: "whiteboard" },
  { key: "calls" },
  { key: "callNoiseFilter" },
  { key: "quickChat" },
  { key: "linkPreviews", risk: true },
  { key: "chatLayoutV2" },
  { key: "lastSeen", risk: true },
  { key: "ownerHiddenOnline", risk: true },
  { key: "chatRowMenu" },
];
