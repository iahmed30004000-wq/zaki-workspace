import { describe, expect, it } from "vitest";
import { FEATURES, FEATURE_DEFAULTS, featureOn, featuresOf, featuresOff, isFeatureKey, withFeature } from "@/lib/features";
import { buildNav } from "@/lib/nav/places";
import { newActionsFor } from "@/lib/nav/new-actions";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { AR } from "@/lib/i18n/dict";

const owner = { role: "OWNER" as const, caps: [...effectiveCapabilities({ role: "OWNER" })] };

describe("«الميزات»: the owner's switches", () => {
  it("every key has a default and its two lines in Arabic (a key added without them fails here)", () => {
    expect(FEATURES.length).toBeGreaterThan(0);
    expect(new Set(FEATURES).size).toBe(FEATURES.length);
    for (const key of FEATURES) {
      expect(typeof FEATURE_DEFAULTS[key], key).toBe("boolean");
      expect(AR[`features.${key}.name`], key).toMatch(/[؀-ۿ]/);
      expect(AR[`features.${key}.hint`], key).toMatch(/[؀-ۿ]/);
    }
  });

  it("a switch nobody touched is its default; a stored one wins", () => {
    expect(featureOn({}, "watch")).toBe(FEATURE_DEFAULTS.watch);
    expect(featureOn(null, "watch")).toBe(FEATURE_DEFAULTS.watch);
    expect(featureOn({ features: { watch: false } }, "watch")).toBe(false);
    expect(featureOn({ features: { watch: true } }, "watch")).toBe(true);
  });

  it("«حقول مخصصة» is a switch like the others: on until the owner turns it off, and off is only that key", () => {
    expect(FEATURES).toContain("customFields");
    expect(FEATURE_DEFAULTS.customFields).toBe(true);
    expect(featureOn({}, "customFields")).toBe(true);
    expect(featureOn({ features: { customFields: false } }, "customFields")).toBe(false);
    expect(featuresOff({ features: { customFields: false } })).toEqual(["ownerHiddenOnline", "ownerAssistant", "chatAssistant", "customFields", "apiDoor", "dbBackup", "voiceTranscript", "externalGateway", "morningDigest", "messageTranslate", "imageOcr", "semanticSearch", "emailToTask", "assistantInMeetings", "taskPrivacy", "omsLink", "knowledgeCards", "quickRecall", "orderStatus", "autoTickets", "mustRead", "orderTemplateHint", "navV2", "omsEvents", "doorMessages", "chatLayoutV2", "workInbox", "permissionTemplates", "workRequests", "workStages", "workMyTasks", "workStaleSweep"]);
  });

  it("a broken stored value is ignored, never read as off", () => {
    for (const settings of [{ features: "nope" }, { features: { watch: "false" } }, { features: { watch: 0 } }, "x", 42]) {
      expect(featureOn(settings, "watch"), JSON.stringify(settings)).toBe(FEATURE_DEFAULTS.watch);
    }
  });

  it("lists every switch with its default filled in, and the ones that are off", () => {
    const all = featuresOf({ features: { watch: false, unknown: true } });
    // exactly the keys of `FEATURES`, each at its default — a key added to the list lands here without
    // editing this test, and a key that exists in one place and not the other fails
    expect(Object.keys(all).sort()).toEqual([...FEATURES].sort());
    for (const key of FEATURES) expect(all[key], key).toBe(key === "watch" ? false : FEATURE_DEFAULTS[key]);
    // «إخفاء المالك من متصل» and «مساعد المالك» are OFF until the owner turns them on, so they are always in the list of the ones that are off
    expect(featuresOff({ features: { watch: false } })).toEqual(["watch", "ownerHiddenOnline", "ownerAssistant", "chatAssistant", "apiDoor", "dbBackup", "voiceTranscript", "externalGateway", "morningDigest", "messageTranslate", "imageOcr", "semanticSearch", "emailToTask", "assistantInMeetings", "taskPrivacy", "omsLink", "knowledgeCards", "quickRecall", "orderStatus", "autoTickets", "mustRead", "orderTemplateHint", "navV2", "omsEvents", "doorMessages", "chatLayoutV2", "workInbox", "permissionTemplates", "workRequests", "workStages", "workMyTasks", "workStaleSweep"]);
    expect(featuresOff({})).toEqual(["ownerHiddenOnline", "ownerAssistant", "chatAssistant", "apiDoor", "dbBackup", "voiceTranscript", "externalGateway", "morningDigest", "messageTranslate", "imageOcr", "semanticSearch", "emailToTask", "assistantInMeetings", "taskPrivacy", "omsLink", "knowledgeCards", "quickRecall", "orderStatus", "autoTickets", "mustRead", "orderTemplateHint", "navV2", "omsEvents", "doorMessages", "chatLayoutV2", "workInbox", "permissionTemplates", "workRequests", "workStages", "workMyTasks", "workStaleSweep"]);
    expect(featuresOff({ features: { ownerHiddenOnline: true, ownerAssistant: true, chatAssistant: true, apiDoor: true, dbBackup: true, voiceTranscript: true, externalGateway: true, morningDigest: true, messageTranslate: true, imageOcr: true, semanticSearch: true, emailToTask: true, assistantInMeetings: true, taskPrivacy: true, omsLink: true, knowledgeCards: true, quickRecall: true, orderStatus: true, autoTickets: true, mustRead: true, orderTemplateHint: true, navV2: true, omsEvents: true, doorMessages: true, chatLayoutV2: true, workInbox: true, permissionTemplates: true, workRequests: true, workStages: true, workMyTasks: true, workStaleSweep: true } })).toEqual([]);
    expect(FEATURE_DEFAULTS.ownerAssistant).toBe(false);
    // «الرسائل بدون نت» is ON until the owner turns it off (so it is never in the list of the ones that are off)
    expect(FEATURE_DEFAULTS.chatOutbox).toBe(true);
    expect(featuresOff({ features: { chatOutbox: false } })).toContain("chatOutbox");
  });

  it("«طلبات الموافقة والنماذج» (`approvals`) is a switch of its own, on by default, so it is never in the list of the ones that are off", () => {
    expect(FEATURES).toContain("approvals");
    expect(FEATURE_DEFAULTS.approvals).toBe(true);
    expect(featuresOff({})).not.toContain("approvals");
    expect(featuresOff({ features: { approvals: false } })).toContain("approvals");
    expect(featureOn({ features: { approvals: false } }, "approvals")).toBe(false);
    expect(buildNav({ ...owner, off: ["approvals"] }).places.flatMap((p) => p.tabs.map((t) => t.key))).not.toContain("approvals");
    expect(buildNav(owner).places.flatMap((p) => p.tabs.map((t) => t.key))).toContain("approvals");
  });

  it("«باب الربط الخارجي» (`apiDoor`) is OFF until the owner turns it on, named in Arabic, and is only that key", () => {
    expect(FEATURES).toContain("apiDoor");
    expect(FEATURE_DEFAULTS.apiDoor).toBe(false);
    expect(featureOn({}, "apiDoor")).toBe(false);
    expect(featureOn({ features: { apiDoor: true } }, "apiDoor")).toBe(true);
    expect(featuresOff({})).toContain("apiDoor");
    expect(featuresOff({ features: { apiDoor: true } })).not.toContain("apiDoor");
    expect(AR["features.apiDoor.name"]).toBe("باب الربط الخارجي");
  });

  it("setting one switch keeps every other key of the company's settings", () => {
    const before = { transparencyVersion: 3, features: { other: true }, somethingElse: { a: 1 } };
    expect(withFeature(before, "watch", false)).toEqual({ transparencyVersion: 3, features: { other: true, watch: false }, somethingElse: { a: 1 } });
    expect(withFeature(null, "watch", true)).toEqual({ features: { watch: true } });
  });

  it("«آخر ظهور» is a switch, ON by default (a company that never touched it has the feature), named in Arabic", () => {
    expect(FEATURES).toContain("lastSeen");
    expect(FEATURE_DEFAULTS.lastSeen).toBe(true);
    expect(featureOn({}, "lastSeen")).toBe(true);
    expect(featuresOff({ features: { ownerHiddenOnline: true, ownerAssistant: true, chatAssistant: true, apiDoor: true, dbBackup: true, voiceTranscript: true, externalGateway: true, messageTranslate: true, imageOcr: true, semanticSearch: true, emailToTask: true, assistantInMeetings: true, taskPrivacy: true, omsLink: true, knowledgeCards: true, quickRecall: true, orderStatus: true, autoTickets: true, mustRead: true, orderTemplateHint: true, navV2: true, omsEvents: true, doorMessages: true, chatLayoutV2: true, workInbox: true, permissionTemplates: true, workRequests: true, workStages: true, workMyTasks: true, workStaleSweep: true, lastSeen: false } })).toEqual(["lastSeen", "morningDigest"]);
    expect(AR["features.lastSeen.name"]).toBe("آخر ظهور");
  });

  it("knows its own keys and nothing else", () => {
    expect(isFeatureKey("watch")).toBe(true);
    expect(isFeatureKey("nope")).toBe(false);
    expect(isFeatureKey(1)).toBe(false);
  });
});

describe("«الأداء والتطوير» (teamDevelopment)", () => {
  it("is a switch, on until the owner turns it off, with its name and hint; off, «الهيكل» and «الأداء والتطوير» leave the map for everybody", () => {
    expect(FEATURES).toContain("teamDevelopment");
    expect(FEATURE_DEFAULTS.teamDevelopment).toBe(true);
    expect(featureOn({}, "teamDevelopment")).toBe(true);
    expect(featuresOff({ features: { teamDevelopment: false } })).toContain("teamDevelopment");
    const tabs = (off: string[]) => buildNav({ ...owner, off: off as never[] }).places.flatMap((p) => p.tabs.map((t) => t.key));
    expect(tabs([])).toEqual(expect.arrayContaining(["structure", "development"]));
    expect(tabs(["teamDevelopment"])).not.toContain("structure");
    expect(tabs(["teamDevelopment"])).not.toContain("development");
  });
});

describe("«الميزات»: a switched-off feature is gone from the map and from «جديد»", () => {
  it("«نتفرّج سوا» off: no sixth place, no «جديد» entry; on again: both back", () => {
    expect(buildNav({ ...owner, off: ["watch"] }).places.map((p) => p.key)).not.toContain("watch");
    expect(newActionsFor({ ...owner, off: ["watch"] })).not.toContain("watch");
    expect(buildNav({ ...owner, off: [] }).places.map((p) => p.key)).toContain("watch");
    expect(newActionsFor(owner)).toContain("watch");
  });

  it("«التسجيل اليومي» off: no tab in «الشغل» for anybody, and its place is still there; on again: the tab is back, for staff only", () => {
    const work = (subject: Parameters<typeof buildNav>[0]) => buildNav(subject).places.find((p) => p.key === "work")?.tabs.map((t) => t.key) ?? [];
    expect(work(owner)).toContain("checkins");
    expect(work({ ...owner, off: ["checkins"] })).not.toContain("checkins");
    expect(work({ ...owner, off: ["checkins"] })).toEqual(work(owner).filter((k) => k !== "checkins"));
    expect(buildNav({ ...owner, off: ["checkins"] }).places.map((p) => p.key)).toContain("work");
    // never for an external partner, switch or no switch
    expect(work({ role: "GUEST" as const, caps: [] })).not.toContain("checkins");
    expect(featuresOff({ features: { checkins: false } })).toContain("checkins");
  });

  it("«القائمة الجديدة» (`navV2`): a switch of its own, OFF until the owner turns it on, with its two lines; off, the map is the old one", () => {
    expect(FEATURES).toContain("navV2");
    expect(FEATURE_DEFAULTS.navV2).toBe(false);
    expect(featureOn({}, "navV2")).toBe(false);
    expect(featureOn({ features: { navV2: true } }, "navV2")).toBe(true);
    expect(featuresOff({})).toContain("navV2");
    expect(featuresOff({ features: { navV2: true } })).not.toContain("navV2");
    expect(AR["features.navV2.name"]).toBe("القائمة الجديدة");
    // the old map is what a person without the flag gets, whatever else is switched
    expect(buildNav({ ...owner, off: featuresOff({}) }).places.map((p) => p.key)).toEqual(["today", "chat", "work", "library", "watch", "admin"]);
  });

  it("«قائمة دردشة وحدة» (`chatOneList`, D-N2): a switch of its own, ON by default (the recommended answer, pending the owner), with its two lines; off, the chat list is one space like before", () => {
    expect(FEATURES).toContain("chatOneList");
    expect(FEATURE_DEFAULTS.chatOneList).toBe(true);
    expect(featureOn({}, "chatOneList")).toBe(true);
    expect(featureOn({ features: { chatOneList: false } }, "chatOneList")).toBe(false);
    expect(featuresOff({})).not.toContain("chatOneList");
    expect(featuresOff({ features: { chatOneList: false } })).toContain("chatOneList");
    expect(AR["features.chatOneList.name"]).toBe("قائمة دردشة وحدة");
    expect(AR["features.chatOneList.hint"]).toContain("بانتظار قرارك");
  });

  it("«شاشة الدردشة الجديدة» (`chatLayoutV2`, C2): a switch of its own, OFF until the owner turns it on, with its two lines; off, the chat is the old screen", () => {
    expect(FEATURES).toContain("chatLayoutV2");
    expect(FEATURE_DEFAULTS.chatLayoutV2).toBe(false);
    expect(featureOn({}, "chatLayoutV2")).toBe(false);
    expect(featureOn({ features: { chatLayoutV2: true } }, "chatLayoutV2")).toBe(true);
    expect(featuresOff({})).toContain("chatLayoutV2");
    expect(featuresOff({ features: { chatLayoutV2: true } })).not.toContain("chatLayoutV2");
    expect(AR["features.chatLayoutV2.name"]).toBe("شاشة الدردشة الجديدة");
    expect(AR["features.chatLayoutV2.hint"]).toContain("القديمة");
  });

  it("«تنسيق النص بالدردشة» (`chatFormatting`, C3b.1): ON by default, off is plain text; its two lines are there", () => {
    expect(FEATURES).toContain("chatFormatting");
    expect(FEATURE_DEFAULTS.chatFormatting).toBe(true);
    expect(featureOn({}, "chatFormatting")).toBe(true);
    expect(featureOn({ features: { chatFormatting: false } }, "chatFormatting")).toBe(false);
    expect(featuresOff({})).not.toContain("chatFormatting");
    expect(featuresOff({ features: { chatFormatting: false } })).toContain("chatFormatting");
    expect(AR["features.chatFormatting.name"]).toBe("تنسيق النص بالدردشة");
    expect(AR["features.chatFormatting.hint"]).toContain("نص عادي");
  });

  it("«ألبومات الصور وعارض الوسائط» (`chatAlbums`, C3b.3): ON by default, off is the old single pictures; its two lines are there", () => {
    expect(FEATURES).toContain("chatAlbums");
    expect(FEATURE_DEFAULTS.chatAlbums).toBe(true);
    expect(featureOn({}, "chatAlbums")).toBe(true);
    expect(featureOn({ features: { chatAlbums: false } }, "chatAlbums")).toBe(false);
    expect(featuresOff({})).not.toContain("chatAlbums");
    expect(featuresOff({ features: { chatAlbums: false } })).toContain("chatAlbums");
    expect(AR["features.chatAlbums.name"]).toBe("ألبومات الصور وعارض الوسائط");
    expect(AR["features.chatAlbums.hint"]).toContain("لحد 10 ملفات");
  });

  it("«صندوق الطلبات» (`workRequests`, W1.4): OFF until the owner turns it on, with its two lines; off, «الطلبات» is today's approvals page and no number rides on «الشغل»", () => {
    expect(FEATURES).toContain("workRequests");
    expect(FEATURE_DEFAULTS.workRequests).toBe(false);
    expect(featureOn({}, "workRequests")).toBe(false);
    expect(featureOn({ features: { workRequests: true } }, "workRequests")).toBe(true);
    expect(featuresOff({})).toContain("workRequests");
    expect(featuresOff({ features: { workRequests: true } })).not.toContain("workRequests");
    expect(AR["features.workRequests.name"]).toBe("صندوق الطلبات");
    expect(AR["features.workRequests.hint"]).toContain("بانتظاري");
  });

  it("«التثبيت والأرشفة الشخصية» (`chatPersonalState`, C3a.1): ON by default, off is the list as it was (nothing drawn, the routes 404, the data stays); its two lines are there", () => {
    expect(FEATURES).toContain("chatPersonalState");
    expect(FEATURE_DEFAULTS.chatPersonalState).toBe(true);
    expect(featureOn({}, "chatPersonalState")).toBe(true);
    expect(featureOn({ features: { chatPersonalState: false } }, "chatPersonalState")).toBe(false);
    expect(featuresOff({})).not.toContain("chatPersonalState");
    expect(featuresOff({ features: { chatPersonalState: false } })).toContain("chatPersonalState");
    expect(AR["features.chatPersonalState.name"]).toBe("التثبيت والأرشفة الشخصية");
    expect(AR["features.chatPersonalState.hint"]).toContain("لإلك بس");
  });

  it("«مجلدات الدردشة» (`chatFolders`, C3a.2): ON by default, off is the five built-in tabs (no folder drawn, the folders not answered or saved, the data stays); its two lines are there", () => {
    expect(FEATURES).toContain("chatFolders");
    expect(FEATURE_DEFAULTS.chatFolders).toBe(true);
    expect(featureOn({}, "chatFolders")).toBe(true);
    expect(featureOn({ features: { chatFolders: false } }, "chatFolders")).toBe(false);
    expect(featuresOff({})).not.toContain("chatFolders");
    expect(featuresOff({ features: { chatFolders: false } })).toContain("chatFolders");
    expect(AR["features.chatFolders.name"]).toBe("مجلدات الدردشة");
    expect(AR["features.chatFolders.hint"]).toContain("لإلك بس");
  });

  it("«الرسائل المحفوظة» (`savedMessages`, C3a.3): ON by default, off hides the chat and its door (the messages stay); its two lines are there and say who can read it", () => {
    expect(FEATURES).toContain("savedMessages");
    expect(FEATURE_DEFAULTS.savedMessages).toBe(true);
    expect(featureOn({}, "savedMessages")).toBe(true);
    expect(featureOn({ features: { savedMessages: false } }, "savedMessages")).toBe(false);
    expect(featuresOff({})).not.toContain("savedMessages");
    expect(featuresOff({ features: { savedMessages: false } })).toContain("savedMessages");
    expect(AR["features.savedMessages.name"]).toBe("الرسائل المحفوظة");
    expect(AR["features.savedMessages.hint"]).toContain("المالك");
  });

  it("«معاينة الروابط بالدردشة» (`linkPreviews`, C3b.2): ON by default, off is no page visited and no card (the data stays); its two lines carry the warning and the way out", () => {
    expect(FEATURES).toContain("linkPreviews");
    expect(FEATURE_DEFAULTS.linkPreviews).toBe(true);
    expect(featureOn({}, "linkPreviews")).toBe(true);
    expect(featureOn({ features: { linkPreviews: false } }, "linkPreviews")).toBe(false);
    expect(featuresOff({})).not.toContain("linkPreviews");
    expect(featuresOff({ features: { linkPreviews: false } })).toContain("linkPreviews");
    expect(AR["features.linkPreviews.name"]).toBe("معاينة الروابط بالدردشة");
    // ⚠️ the server visits the link, 🔧 and what limits it
    expect(AR["features.linkPreviews.hint"]).toContain("⚠️");
    expect(AR["features.linkPreviews.hint"]).toContain("🔧");
    expect(AR["features.linkPreviews.hint"]).toContain("السيرفر هو اللي بيزور الرابط");
  });

  it("«الإرسال بدون صوت» (`chatSilentSend`, C3c.2): ON by default; off, the route ignores the flag and the menu entry is not drawn (messages already sent silent stay silent)", () => {
    expect(FEATURES).toContain("chatSilentSend");
    expect(FEATURE_DEFAULTS.chatSilentSend).toBe(true);
    expect(featureOn({}, "chatSilentSend")).toBe(true);
    expect(featureOn({ features: { chatSilentSend: false } }, "chatSilentSend")).toBe(false);
    expect(featuresOff({})).not.toContain("chatSilentSend");
    expect(featuresOff({ features: { chatSilentSend: false } })).toContain("chatSilentSend");
    expect(AR["features.chatSilentSend.name"]).toBe("الإرسال بدون صوت");
    // what it does, and what it does not do (the unread count and the mention are kept)
    expect(AR["features.chatSilentSend.hint"]).toContain("ابعت بدون صوت");
    expect(AR["features.chatSilentSend.hint"]).toContain("⚠️");
    expect(AR["features.chatSilentSend.hint"]).toContain("🔧");
  });

  it("«جدولة الرسائل» (`chatScheduled`, C3c.3): ON by default; off, the routes answer «not found», the menu entry and the icon are not drawn and the job leaves the rows alone", () => {
    expect(FEATURES).toContain("chatScheduled");
    expect(FEATURE_DEFAULTS.chatScheduled).toBe(true);
    expect(featureOn({}, "chatScheduled")).toBe(true);
    expect(featureOn({ features: { chatScheduled: false } }, "chatScheduled")).toBe(false);
    expect(featuresOff({})).not.toContain("chatScheduled");
    expect(featuresOff({ features: { chatScheduled: false } })).toContain("chatScheduled");
    expect(AR["features.chatScheduled.name"]).toBe("جدولة الرسائل");
    expect(AR["features.chatScheduled.hint"]).toContain("جدول الإرسال");
    expect(AR["features.chatScheduled.hint"]).toContain("⚠️");
    expect(AR["features.chatScheduled.hint"]).toContain("🔧");
  });

  it("«مراحل الأعمدة» (`workStages`, W1.3): OFF until the owner turns it on; the column exists either way, the switch only gates the choice in column settings", () => {
    expect(FEATURES).toContain("workStages");
    expect(FEATURE_DEFAULTS.workStages).toBe(false);
    expect(featureOn({}, "workStages")).toBe(false);
    expect(featureOn({ features: { workStages: true } }, "workStages")).toBe(true);
    expect(featuresOff({})).toContain("workStages");
    expect(featuresOff({ features: { workStages: true } })).not.toContain("workStages");
    expect(AR["features.workStages.name"]).toBe("مراحل الأعمدة");
    expect(AR["features.workStages.hint"]).toContain("مدير المساحة");
  });

  it("«مهامي الموحّدة» (`workMyTasks`, W1.1): OFF until the owner turns it on, with its ⚠️ and 🔧; off, «مهامي» is today's page and /list and /calendar are their own pages", () => {
    expect(FEATURES).toContain("workMyTasks");
    expect(FEATURE_DEFAULTS.workMyTasks).toBe(false);
    expect(featureOn({}, "workMyTasks")).toBe(false);
    expect(featureOn({ features: { workMyTasks: true } }, "workMyTasks")).toBe(true);
    expect(featuresOff({})).toContain("workMyTasks");
    expect(featuresOff({ features: { workMyTasks: true } })).not.toContain("workMyTasks");
    expect(AR["features.workMyTasks.name"]).toBe("مهامي الموحّدة");
    expect(AR["features.workMyTasks.hint"]).toContain("⚠️");
    expect(AR["features.workMyTasks.hint"]).toContain("🔧");
    // the switch alone changes no map: the old map is exactly the same until the shell hands the switch to the map
    expect(buildNav({ ...owner, off: ["workMyTasks"] }).places).toEqual(buildNav(owner).places);
  });

  it("«مهام قديمة» (`workStaleSweep`, W1.9): OFF until the owner turns it on, with its ⚠️ and 🔧; the switch alone changes no map", () => {
    expect(FEATURES).toContain("workStaleSweep");
    expect(FEATURE_DEFAULTS.workStaleSweep).toBe(false);
    expect(featureOn({}, "workStaleSweep")).toBe(false);
    expect(featureOn({ features: { workStaleSweep: true } }, "workStaleSweep")).toBe(true);
    expect(featuresOff({})).toContain("workStaleSweep");
    expect(featuresOff({ features: { workStaleSweep: true } })).not.toContain("workStaleSweep");
    expect(AR["features.workStaleSweep.name"]).toBe("مهام قديمة");
    expect(AR["features.workStaleSweep.hint"]).toContain("⚠️");
    expect(AR["features.workStaleSweep.hint"]).toContain("🔧");
    expect(AR["features.workStaleSweep.hint"]).toContain("آلي");
    expect(buildNav({ ...owner, off: ["workStaleSweep"] }).places).toEqual(buildNav(owner).places);
  });

  it("switching a feature off changes nothing else on the map", () => {
    const on = buildNav(owner).places.filter((p) => p.key !== "watch");
    expect(buildNav({ ...owner, off: ["watch"] }).places).toEqual(on);
  });
});
