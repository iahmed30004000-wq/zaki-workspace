// The made-up company the mobile pictures show. Run ONCE on a freshly migrated and seeded LOCAL database (prisma/seed.ts), with the local server up:
//   QA_PASSWORD=<the local seed's test password> QA_DB_NAME=<name ending in _demo or _qa> node qa/mobile/seed.mjs
// Ids and times are fixed afterwards: a topic's colour comes from its id and the date labels from its time, so another machine draws the same pictures.
import { execFileSync } from "node:child_process";
import { openBrowser, sleep } from "./driver.mjs";
import { IDS } from "./screens.mjs";

const DB = process.env.QA_DB_NAME ?? "";
if (!/_(demo|qa)$/.test(DB)) throw new Error("set QA_DB_NAME to a throwaway database whose name ends in _demo or _qa");
const CONTAINER = process.env.QA_DB_CONTAINER ?? "zaki-workspace-db-1";
const psql = (sql) => execFileSync("docker", ["exec", "-i", CONTAINER, "sh", "-c", `psql -v ON_ERROR_STOP=1 -tA -U "$POSTGRES_USER" -d ${DB}`], { input: sql }).toString().trim();
const one = (sql) => psql(sql).split("\n")[0] ?? "";

const SWITCHES = ["instantWork", "navV2", "workMyTasks", "recurringTasks", "taskPrivacy", "workInbox", "chatLayoutV2", "chatOneList", "tgTabBar", "tgLook", "voiceTelegram", "voiceNotes", "chatSounds", "chatChecklists", "apiDoor", "doorMessages", "botFather", "groupPictures", "controlPanelV2", "settingsOneDoor", "tgPhone"];

const browser = await openBrowser({ port: 9392 });
try {
  await browser.size(1280, 900, false);
  await browser.login();
  for (const name of SWITCHES)
    psql(`UPDATE "Organization" SET settings = jsonb_set(CASE WHEN jsonb_typeof(settings->'features') = 'object' THEN settings ELSE jsonb_set(coalesce(settings, '{}'::jsonb), '{features}', '{}'::jsonb) END, '{features,${name}}', 'true');`);
  if (one(`SELECT count(*) FROM "Workspace" WHERE name = 'العمل';`) !== "0") throw new Error("this database was already filled: start from a fresh one");

  const must = async (what, url, method, body) => {
    const r = await browser.api(url, method, body);
    if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  const orgId = one('SELECT id FROM "Organization" LIMIT 1;');
  await must("space", "/api/workspaces", "POST", { name: "العمل" });
  const madeSpace = one(`SELECT id FROM "Workspace" WHERE name = 'العمل';`);
  for (const [name, username] of [["سلمى", "salma"], ["محمد", "mohammad"]])
    await must(name, `/api/organizations/${orgId}/members`, "POST", { name, username, password: process.env.QA_PASSWORD, role: "MEMBER", workspaceIds: [madeSpace] });
  const userOf = (username) => one(`SELECT id FROM "User" WHERE username = '${username}';`);
  const [owner, salma, mohammad] = ["owner", "salma", "mohammad"].map(userOf);
  const topics = [
    ["التصاميم", IDS.topicDesign],
    ["فريق التأكيد", IDS.topicConfirm],
    ["بنك المقاطع", IDS.topicClips],
  ];
  for (const [title] of topics) await must(title, `/api/chat/spaces/${madeSpace}/topics`, "POST", { title });
  await must("dm salma", "/api/chat/dm", "POST", { userId: salma });
  await must("dm mohammad", "/api/chat/dm", "POST", { userId: mohammad });
  await must("saved", "/api/chat/dm", "POST", { saved: true });

  const dmWith = (id) => one(`SELECT id FROM "Conversation" WHERE "dmKey" LIKE '%${id}%' AND "dmKey" LIKE '%${owner}%' LIMIT 1;`);
  const renames = [
    ...topics.map(([title, id]) => [one(`SELECT id FROM "Conversation" WHERE title = '${title}';`), id]),
    [dmWith(salma), IDS.dmSalma],
    [dmWith(mohammad), IDS.dmMohammad],
    [one(`SELECT c.id FROM "Conversation" c WHERE c."dmKey" IS NOT NULL AND (SELECT count(*) FROM "ConversationMember" m WHERE m."conversationId" = c.id) = 1 LIMIT 1;`), IDS.saved],
  ];

  let n = 0;
  const say = async (conversation, body, extra = {}) => (await must(`send ${body}`, `/api/chat/conversations/${conversation}/messages`, "POST", { body, clientId: `qa-seed-${++n}`, ...extra }));
  const idOfBody = (body) => one(`SELECT id FROM "ChatMessage" WHERE body = '${body}' LIMIT 1;`);
  const [design, confirm, clips] = renames.slice(0, 3).map(([from]) => from);
  const [dm, other, saved] = renames.slice(3).map(([from]) => from);
  const talk = [
    [dm, "صباح الخير", salma],
    [dm, "جهزت التصميم الجديد؟", owner],
    [dm, "إي، ببعتلك إياه بعد شوي", salma],
    [dm, "تمام، بانتظارك", owner],
    [dm, "الاجتماع الساعة 6 مساءً، لا تنسى تجيب الأرقام معك لأنه بدنا نقرر على الميزانية", salma],
    [dm, "ماشي، بجيبهم معي", owner],
    [other, "وصل الطلب للمستودع", mohammad],
    [saved, "قائمة المشتريات: ورق وحبر طابعة", owner],
    [design, "تصميم الصفحة الرئيسية جاهز للمراجعة", salma],
    [design, "شوفوا الألوان وقولولي رأيكم", salma],
    [confirm, "أكدنا طلبين اليوم", mohammad],
    [clips, "رفعت المقاطع الجديدة", owner],
  ];
  for (const [conversation, body] of talk) {
    await say(conversation, body);
    await sleep(150);
  }
  for (const [, body, author] of talk) psql(`UPDATE "ChatMessage" SET "authorId" = '${author}' WHERE body = '${body}';`);

  // fixed times, in the order written: weeks before the pictures' «today»
  talk.forEach(([, body], i) => psql(`UPDATE "ChatMessage" SET "createdAt" = TIMESTAMP '2026-02-10 07:00:00' + interval '${i * 7} minutes' WHERE body = '${body}';`));
  psql(`UPDATE "Conversation" c SET "lastMessageAt" = coalesce((SELECT max(m."createdAt") FROM "ChatMessage" m WHERE m."conversationId" = c.id), TIMESTAMP '2026-02-09 07:00:00'), "createdAt" = TIMESTAMP '2026-02-01 07:00:00';`);
  psql(`UPDATE "ChatMessage" SET "createdAt" = TIMESTAMP '2026-02-01 07:00:00' WHERE kind = 'SYSTEM';`);
  // the owner has read everything but the last messages of the private chat with محمد and of «التصاميم»
  psql(`UPDATE "ConversationMember" SET "lastReadAt" = TIMESTAMP '2026-02-20 07:00:00', "lastDeliveredAt" = TIMESTAMP '2026-02-20 07:00:00', "joinedAt" = TIMESTAMP '2026-02-01 07:00:00';`);
  psql(`UPDATE "ConversationMember" SET "lastReadAt" = TIMESTAMP '2026-02-09 07:00:00' WHERE "userId" = '${owner}' AND "conversationId" IN ('${other}', '${design}');`);
  psql(`UPDATE "User" SET "lastSeenAt" = NULL, "lastLoginAt" = NULL, "createdAt" = TIMESTAMP '2026-02-01 07:00:00';`);
  psql(`UPDATE "Notification" SET "readAt" = TIMESTAMP '2026-02-20 07:00:00' WHERE "readAt" IS NULL;`);

  // fixed ids last (the foreign keys follow, ON UPDATE CASCADE)
  for (const [from, to] of renames) {
    if (!from) throw new Error(`nothing to rename into ${to}`);
    psql(`UPDATE "Conversation" SET id = '${to}' WHERE id = '${from}';`);
  }
  psql(`UPDATE "Workspace" SET id = '${IDS.space}' WHERE id = '${madeSpace}';`);
  console.log(`filled: ${renames.length} conversations, ${talk.length} messages; reply target ${idOfBody("جهزت التصميم الجديد؟") ? "found" : "missing"}; page errors ${browser.errors.length}`);
} finally {
  browser.close();
}
