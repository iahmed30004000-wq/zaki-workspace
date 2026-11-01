import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/members",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
import { I18nProvider } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n/server";
import { ToastProvider } from "@/components/ui/toast";
import { OrgMembersView } from "@/components/org-members-view";
import { MembersList } from "@/components/members/members-list";
import { CredentialsCard } from "@/components/members/credentials-card";
import { AddMemberSheet } from "@/components/members/add-member-sheet";
import { MemberSheet } from "@/components/members/member-sheet";
import { StaffDirectory } from "@/components/members/staff-directory";
import { CapabilityPanel } from "@/components/members/capability-panel";
import { SwitchRow } from "@/components/members/switch-row";
import { CAPABILITY_GROUPS, SOON_CAPABILITIES, type ActorInfo, type ContractMember, type MembersResponse } from "@/lib/members-ui";
import { CAPABILITIES, RANK_DEFAULTS, SECTION_CAPABILITIES, WIRED_CAPABILITIES } from "@/server/policy/capabilities";
import { ADMIN, GUEST, LEAD, MEMBER, NOW, OFFBOARDED, OWNER, SAMPLE, SPACES, SUSPENDED, contractMember } from "./members-ui-fixtures";

// The components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

const { t } = getServerT();

// the providers' `children` is typed as required, which createElement(type, props, child) cannot express
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;

/** Renders with the providers the app gives every page (Arabic dictionary, query cache, toasts). */
function render(element: ReactElement, client = new QueryClient()): string {
  return renderToStaticMarkup(
    createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Toasts, null, element))),
  );
}

const ownerActor: ActorInfo = { id: "u-owner", role: "OWNER", caps: ["spaces.create", "users.manage", "directory.view", "crm.view", "crm.edit", "prices.view", "integrations.manage", "announce.send", "escalation.configure", "cash.view", "penalties.view", "archive.view"] };
const adminActor: ActorInfo = { id: "u-admin", role: "ADMIN", caps: [...RANK_DEFAULTS.ADMIN] };

const noop = () => {};

/** What the panel offers today: the wired switches only. */
/** The wired capabilities shown as switches (the section boxes are the grid's checkboxes). */
const SWITCHES = WIRED_CAPABILITIES.filter((c) => !SECTION_CAPABILITIES.includes(c));
const WIRED = SWITCHES.length;
/** A team lead who was given users.manage: holds the lead defaults and that one, not integrations.manage. */
const leadManagerActor: ActorInfo = { id: "u-lead", role: "LEAD", caps: [...RANK_DEFAULTS.LEAD, "users.manage"] };

const list = (members: readonly ContractMember[], over: Partial<Parameters<typeof MembersList>[0]> = {}) =>
  createElement(MembersList, {
    members,
    actorId: "u-owner",
    now: NOW,
    filter: { query: "", status: "ALL" },
    onFilterChange: noop,
    onOpen: noop,
    ...over,
  });

/** The `<li>` of one person's card. */
function cardOf(markup: string, name: string): string {
  const card = markup.split("<li>").find((chunk) => chunk.includes(name));
  if (!card) throw new Error(`no card for ${name}`);
  return card.split("</li>")[0] as string;
}

const sheet = (member: ContractMember, actor: ActorInfo = ownerActor, members: readonly ContractMember[] = SAMPLE.members) =>
  createElement(MemberSheet, { orgId: "org1", member, members, actor, now: NOW, onClose: noop, onPatch: noop, onChanged: noop });

const count = (markup: string, pattern: RegExp) => (markup.match(pattern) ?? []).length;

describe("the people list: cards for the sample contract data", () => {
  const markup = render(list(SAMPLE.members));

  it("shows every person with name, @username and job title", () => {
    for (const m of SAMPLE.members) expect(markup, m.name).toContain(m.name);
    for (const username of ["ahmad", "abdullah", "manar", "qabas", "hassan", "rama", "abunizar"]) {
      expect(markup).toContain(`@${username}`);
    }
    expect(markup).toContain("المدير العام");
    expect(markup).toContain("قائدة فريق المودريتورز");
  });

  it("labels the rank in Arabic, the new team-lead rank included", () => {
    expect(cardOf(markup, "أحمد الكوري")).toContain("مالك");
    expect(cardOf(markup, "عبد الله")).toContain("مشرف");
    expect(cardOf(markup, "منار")).toContain("قائد فريق");
    expect(cardOf(markup, "قبس")).toContain("عضو");
    expect(cardOf(markup, "أبو نزار")).toContain("زائر");
  });

  it("shows the status of each: فعّال، موقوف، مُخرَج", () => {
    expect(cardOf(markup, "عبد الله")).toContain("فعّال");
    expect(cardOf(markup, "حسن")).toContain("موقوف");
    expect(cardOf(markup, "راما")).toContain("مُخرَج");
  });

  it("warns, on that card only, that the temporary password has not been changed", () => {
    expect(cardOf(markup, "قبس")).toContain("كلمة المرور المؤقتة لم تتغيّر");
    expect(count(markup, /كلمة المرور المؤقتة لم تتغيّر/g)).toBe(1);
  });

  it("shows the last sign-in as a relative Arabic time, or that there was none", () => {
    expect(cardOf(markup, "أحمد الكوري")).toContain("آخر دخول: قبل 5 دقائق");
    expect(cardOf(markup, "عبد الله")).toContain("آخر دخول: قبل 3 ساعات");
    expect(cardOf(markup, "منار")).toContain("آخر دخول: قبل يومين");
    expect(cardOf(markup, "حسن")).toContain("آخر دخول: قبل شهر");
    expect(cardOf(markup, "قبس")).toContain("لم يسجّل دخولًا بعد");
    expect(cardOf(markup, "قبس")).not.toContain("آخر دخول");
  });

  it("shows the manager and the spaces the person is in", () => {
    const lead = cardOf(markup, "منار");
    expect(lead).toContain("المسؤول: عبد الله");
    expect(lead).toContain("المقر، الشحن، المودريتورز");
    expect(lead).toContain("وغيرها (2)");
    expect(cardOf(markup, "أحمد الكوري")).toContain("كل المساحات");
    expect(cardOf(markup, "راما")).toContain("ليس في أي مساحة");
    expect(cardOf(markup, "قبس")).not.toContain("المسؤول:");
  });

  it("dims a suspended or offboarded person but still shows them", () => {
    expect(cardOf(markup, "حسن")).toContain("opacity-70");
    expect(cardOf(markup, "راما")).toContain("opacity-70");
    expect(cardOf(markup, "عبد الله")).not.toContain("opacity-70");
  });

  it("marks the signed-in person", () => {
    expect(cardOf(markup, "أحمد الكوري")).toContain("أنت");
    expect(cardOf(markup, "عبد الله")).not.toContain("أنت");
  });

  it("has a labelled search box and a status filter with the counts", () => {
    expect(markup).toContain('aria-label="بحث في الفريق"');
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="تصفية حسب الحالة"');
    for (const label of ["الكل", "فعّال", "موقوف", "مُخرَج"]) expect(markup).toContain(label);
    // all, active, suspended, offboarded
    expect(markup).toMatch(/الكل<span[^>]*>7<\/span>/);
    expect(markup).toMatch(/فعّال<span[^>]*>5<\/span>/);
    expect(markup).toMatch(/موقوف<span[^>]*>1<\/span>/);
    expect(markup).toMatch(/مُخرَج<span[^>]*>1<\/span>/);
    expect(markup).toContain('aria-pressed="true"');
  });

  it("lists the active people first", () => {
    const order = ["أحمد الكوري", "عبد الله", "منار", "قبس", "أبو نزار", "حسن", "راما"].map((n) => markup.indexOf(n));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("counts the people in Arabic number forms", () => {
    expect(markup).toContain("7 أشخاص");
    expect(render(list([OWNER]))).toContain("شخص واحد");
    expect(render(list([OWNER, ADMIN]))).toContain("شخصان");
    expect(render(list(SAMPLE.members.slice(0, 5).concat(SAMPLE.members.slice(0, 6))))).toContain("11 شخصًا");
  });

  it("filters by status and by search", () => {
    const suspended = render(list(SAMPLE.members, { filter: { query: "", status: "SUSPENDED" } }));
    expect(suspended).toContain("حسن");
    expect(suspended).not.toContain("أحمد الكوري");
    const search = render(list(SAMPLE.members, { filter: { query: "احمد", status: "ALL" } }));
    expect(search).toContain("أحمد الكوري");
    expect(search).not.toContain("عبد الله");
    expect(render(list(SAMPLE.members, { filter: { query: "لا أحد بهذا الاسم", status: "ALL" } }))).toContain(t("members.no_match"));
  });

  it("has a loading state, an empty state and an error state with a retry", () => {
    expect(render(list([], { loading: true }))).toContain(t("common.loading"));
    expect(render(list([]))).toContain(t("members.empty"));
    const failed = render(list([], { errorMessage: "ماتت الخدمة", onRetry: noop }));
    expect(failed).toContain(t("members.load_failed"));
    expect(failed).toContain("ماتت الخدمة");
    expect(failed).toContain(t("common.retry"));
  });
});

describe("the whole screen, with the data already loaded", () => {
  function screen(data: MembersResponse | null) {
    const client = new QueryClient();
    if (data) client.setQueryData(["org-members", "org1"], data);
    return render(createElement(OrgMembersView, { orgId: "org1", actorId: "u-owner", actorRole: "OWNER", actorCaps: ownerActor.caps }), client);
  }

  it("shows the title, the add button and the people", () => {
    const markup = screen(SAMPLE);
    expect(markup).toContain(t("orgm.title"));
    expect(markup).toContain(t("members.subtitle"));
    expect(markup).toContain("إضافة شخص");
    expect(markup).toContain("منار");
    expect(markup).not.toContain('role="dialog"'); // nothing is open until a card is tapped
  });

  it("shows a loading state while nothing has arrived", () => {
    expect(screen(null)).toContain(t("common.loading"));
  });

  it("offers no add button to somebody who can create no rank", () => {
    const client = new QueryClient();
    client.setQueryData(["org-members", "org1"], SAMPLE);
    const markup = render(
      createElement(OrgMembersView, { orgId: "org1", actorId: "u-guest", actorRole: "GUEST", actorCaps: [] }),
      client,
    );
    expect(markup).not.toContain("إضافة شخص");
  });
});

describe("the result card after creating an account", () => {
  const card = (over: Partial<Parameters<typeof CredentialsCard>[0]> = {}) =>
    render(
      createElement(CredentialsCard, {
        heading: t("members.created_title"),
        name: "نور",
        username: "nour.huda",
        password: "Tmp-9xq-7",
        onDone: noop,
        ...over,
      }),
    );

  it("shows the username and the temporary password, each with a copy button", () => {
    const markup = card();
    expect(markup).toContain("تم إنشاء الحساب");
    expect(markup).toContain("nour.huda");
    expect(markup).toContain("Tmp-9xq-7");
    expect(markup).toContain('aria-label="نسخ اسم المستخدم"');
    expect(markup).toContain('aria-label="نسخ كلمة المرور"');
    expect(markup).toMatch(/dir="ltr"[^>]*>Tmp-9xq-7</);
  });

  it("has the one button that copies the ready message", () => {
    expect(card()).toContain("نسخ بيانات الدخول");
  });

  it("says the password is shown only once, and what to do if it is lost (⚠️ with its 🔧)", () => {
    const markup = card();
    expect(markup).toContain("⚠️");
    expect(markup).toContain("مرة واحدة فقط");
    expect(markup).toContain("🔧");
    expect(markup).toContain("سيُطلب منه تغييرها عند أول دخول");
  });

  it("offers to add another person, or to finish", () => {
    const markup = card({ secondary: { label: t("members.add_another"), onClick: noop } });
    expect(markup).toContain("إضافة شخص آخر");
    expect(markup).toContain(">تم<");
  });

  it("when the server sent no password it says so and offers no copy-everything button", () => {
    const markup = card({ password: null });
    expect(markup).toContain(t("members.no_password_returned"));
    expect(markup).not.toContain("نسخ بيانات الدخول");
  });
});

describe("the add-person form", () => {
  const form = (actor: ActorInfo = ownerActor) =>
    render(createElement(AddMemberSheet, { orgId: "org1", actor, members: SAMPLE.members, spaces: SPACES, onClose: noop, onCreated: noop }));

  it("is one dialog with the fields the owner needs", () => {
    const markup = form();
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    for (const label of ["الاسم الكامل", "اسم المستخدم", "الرتبة", "المسمّى الوظيفي (اختياري)", "البريد الإلكتروني (اختياري)", "المسؤول المباشر", "المساحات التي سيراها"]) {
      expect(markup, label).toContain(label);
    }
    expect(markup).toContain("إنشاء الحساب");
  });

  it("has the generate-password switch ON by default, and no manual password field then", () => {
    const markup = form();
    expect(markup).toContain("ولّد كلمة مرور تلقائيًا");
    expect(markup).toMatch(/role="switch" aria-checked="true"/);
    expect(markup).not.toContain('autoComplete="new-password"');
    expect(markup).not.toContain('autocomplete="new-password"');
  });

  it("offers a checkbox for each space the actor may use", () => {
    const markup = form();
    for (const space of SPACES) expect(markup).toContain(space.name);
    expect(count(markup, /type="checkbox"/g)).toBe(SPACES.length);
  });

  it("offers the OWNER every rank to create, and an ADMIN only the ranks below ADMIN", () => {
    const owner = form(ownerActor);
    for (const rank of ["مشرف", "قائد فريق", "عضو", "زائر"]) expect(owner).toContain(`>${rank}</option>`);
    const admin = form(adminActor);
    expect(admin).not.toContain(">مشرف</option>");
    for (const rank of ["قائد فريق", "عضو", "زائر"]) expect(admin).toContain(`>${rank}</option>`);
  });

  it("keeps the username field left-to-right, lower-case and away from the browser's autofill", () => {
    // HTML attribute names are case-insensitive; the server markup keeps React's camelCase spelling
    const markup = form().toLowerCase();
    const input = /<input[^>]*id=":r\d+:-username"[^>]*>/.exec(markup)?.[0] ?? "";
    expect(input).toContain('dir="ltr"');
    expect(input).toContain('autocomplete="off"');
    expect(input).toContain('autocapitalize="none"');
    expect(input).toContain('autocorrect="off"');
    expect(input).toContain('spellcheck="false"');
    expect(input).toContain('data-1p-ignore="true"');
  });
});

describe("the panel of one person: only what the actor may do is offered", () => {
  it("OWNER on an active member: the switches, the security actions, suspend and offboard", () => {
    const markup = render(sheet(MEMBER));
    expect(markup).toContain('role="dialog"');
    expect(count(markup, /role="switch"/g)).toBe(WIRED);
    for (const label of ["تصفير كلمة المرور", "اخرجه من كل الأجهزة", "إيقاف الحساب", "إخراج من الفريق", "حفظ التعديلات"]) {
      expect(markup, label).toContain(label);
    }
    expect(markup).not.toContain("إعادة التفعيل");
    expect(markup).toContain("قبس");
    expect(markup).toContain("@qabas");
  });

  it("only the wired switches are offered; the owner-only archive is not on the screen at all", () => {
    const markup = render(sheet(MEMBER));
    expect(markup).not.toContain("archive");
    expect(count(markup, /role="switch"/g)).toBe(WIRED);
    // the capabilities a later phase will wire are named as «قريبًا», never as a switch
    expect(markup).toContain(t("members.caps_soon_title"));
    for (const cap of SOON_CAPABILITIES) {
      expect(markup, cap).toContain(t(`members.cap.${cap}.title`));
      expect(markup, cap).not.toContain(t(`members.cap.${cap}.hint`));
    }
    for (const cap of SWITCHES) expect(markup, cap).toContain(t(`members.cap.${cap}.title`));
  });

  it("«قريبًا» is the rest of the catalogue's groups and nothing else: derived, so a wired capability leaves it by itself", () => {
    const grouped = CAPABILITY_GROUPS.flatMap((group) => [...group.capabilities]);
    for (const cap of SOON_CAPABILITIES) {
      expect(grouped, cap).toContain(cap);
      expect(WIRED_CAPABILITIES, cap).not.toContain(cap);
    }
    // the four the security review counted as guarding nothing (C3), and the owner-only archive never appears
    for (const cap of ["cash.view", "penalties.view", "announce.send", "escalation.configure"] as const) {
      expect(SOON_CAPABILITIES, cap).toContain(cap);
    }
    expect(SOON_CAPABILITIES).not.toContain("archive.view");
  });

  it("shows each switch with its rank default, a one-line explanation and the group it belongs to; a group with nothing wired is gone", () => {
    const markup = render(sheet(LEAD));
    expect(markup).toContain("المفاتيح (الصلاحيات)");
    for (const group of CAPABILITY_GROUPS) {
      const title = t(`members.group_${group.id}`);
      const wired = group.capabilities.some((c) => WIRED_CAPABILITIES.includes(c));
      if (wired) expect(markup, group.id).toContain(`>${title}</h4>`);
      else expect(markup, group.id).not.toContain(`>${title}</h4>`);
    }
    expect(markup).toContain(t("members.cap.directory.view.hint"));
    // a team lead's rank gives these of the wired switches
    const onByRank = SWITCHES.filter((c) => RANK_DEFAULTS.LEAD.includes(c)).length;
    expect(count(markup, /role="switch" aria-checked="true"/g)).toBe(onByRank);
    expect(count(markup, /حسب الرتبة/g)).toBe(WIRED);
  });

  it("shows what the owner changed on top of the rank, and warns about a sensitive extra", () => {
    const changed = contractMember({
      id: "u-x",
      name: "نادين",
      role: "MEMBER",
      capabilities: ["integrations.manage"],
      revokedCapabilities: ["directory.view"],
    });
    const markup = render(sheet(changed));
    expect(markup).toContain("أُضيف فوق الرتبة");
    expect(markup).toContain("سُحب من الرتبة");
    expect(markup).toContain("مفتاح حسّاس");
    expect(markup).toContain(t("members.caps_reset"));
    // an untouched person has nothing to reset
    expect(render(sheet(MEMBER))).not.toContain(t("members.caps_reset"));
  });

  it("stored capabilities that are not on the screen leave no trace on it: no tag, no warning, no reset button", () => {
    const hiddenOnly = contractMember({
      id: "u-y",
      name: "سلمى",
      role: "MEMBER",
      capabilities: ["cash.view", "penalties.view"],
    });
    // an ADMIN's announce.send (a rank default) switched off: still not a switch the screen offers
    const lead = contractMember({ id: "u-z", name: "رنا", role: "ADMIN", revokedCapabilities: ["announce.send"] });
    for (const person of [hiddenOnly, lead]) {
      const markup = render(sheet(person));
      expect(markup).not.toContain("أُضيف فوق الرتبة");
      expect(markup).not.toContain("سُحب من الرتبة");
      expect(markup).not.toContain("مفتاح حسّاس");
      expect(markup).not.toContain(t("members.caps_reset"));
    }
  });

  it("a person who cannot hand out a switch sees it locked, with why (a team lead who was given users.manage lacks integrations.manage and, since 2026-10-25, spaces.create)", () => {
    const markup = render(sheet(MEMBER, leadManagerActor));
    expect(markup).toContain(t("members.caps_locked_actor"));
    // integrations.manage, spaces.create, «لوحة الفريق» (board.team), «الهيكل» (people.manage_lines), «تقييم الفريق» (people.review) and the three of «مخزون التصنيع» (view and edit are an ADMIN's, the cost the owner's alone): a lead holds none by default
    expect(count(markup, /role="switch"[^>]*disabled=""/g)).toBe(8);
    // an ADMIN holds every wired switch but the four the owner alone hands out (board.team, people.manage_lines, people.review, manufacturing.cost): those are locked
    const admin = render(sheet(MEMBER, adminActor));
    expect(count(admin, /role="switch"[^>]*disabled=""/g)).toBe(4);
  });

  it("a suspended person can be reactivated or offboarded, not suspended again", () => {
    const markup = render(sheet(SUSPENDED));
    expect(markup).toContain("إعادة التفعيل");
    expect(markup).toContain("إخراج من الفريق");
    expect(markup).not.toContain("إيقاف الحساب");
    expect(markup).not.toContain("تصفير كلمة المرور");
    expect(markup).toContain(t("members.suspended_note"));
  });

  it("an offboarded person can only be reactivated", () => {
    const markup = render(sheet(OFFBOARDED));
    expect(markup).toContain("إعادة التفعيل");
    for (const label of ["إيقاف الحساب", "إخراج من الفريق", "تصفير كلمة المرور", "حفظ التعديلات"]) expect(markup).not.toContain(label);
    expect(markup).toContain(t("members.offboarded_note"));
    expect(count(markup, /role="switch"[^>]*disabled=""/g)).toBe(WIRED);
  });

  it("nobody is offered anything on themselves: a note and a link to their own profile instead", () => {
    const markup = render(sheet(ADMIN, adminActor));
    expect(markup).toContain(t("members.view_only_self"));
    expect(markup).toContain('href="/profile"');
    for (const label of ["إيقاف الحساب", "إخراج من الفريق", "تصفير كلمة المرور", "حفظ التعديلات"]) expect(markup).not.toContain(label);
  });

  it("an ADMIN looking at the OWNER, or at another ADMIN, can change nothing", () => {
    const owner = render(sheet(OWNER, adminActor));
    expect(owner).toContain(t("members.view_only_owner"));
    expect(owner).toContain(t("members.caps_owner"));
    expect(count(owner, /role="switch"/g)).toBe(0);
    const peer = render(sheet(contractMember({ id: "u-admin2", name: "ربى", role: "ADMIN" }), adminActor));
    expect(peer).toContain(t("members.view_only"));
    expect(peer).not.toContain("إيقاف الحساب");
    expect(count(peer, /role="switch"[^>]*disabled=""/g)).toBe(WIRED);
  });

  it("a guest shows the sentence that external partners hold no capability, and no switch", () => {
    const markup = render(sheet(GUEST));
    expect(markup).toContain(t("members.caps_guest"));
    expect(count(markup, /role="switch"/g)).toBe(0);
    // but the guest can still be managed
    expect(markup).toContain("إيقاف الحساب");
  });

  it("warns that the temporary password was never changed, with what to do (⚠️ and 🔧)", () => {
    const markup = render(sheet(MEMBER));
    expect(markup).toContain(t("members.pw_pending_warning"));
    expect(markup).toContain(t("members.pw_pending_fix"));
    expect(render(sheet(LEAD))).not.toContain(t("members.pw_pending_warning"));
  });

  it("offers the OWNER every rank to change a person to, and an ADMIN only the ranks below ADMIN", () => {
    const owner = render(sheet(MEMBER, ownerActor));
    expect(owner).toContain(">مشرف</option>");
    const admin = render(sheet(MEMBER, adminActor));
    expect(admin).not.toContain(">مشرف</option>");
    expect(admin).toContain(">قائد فريق</option>");
  });

  it("the manager picker never offers the person themselves, a guest or somebody who left", () => {
    const markup = render(sheet(MEMBER));
    const select = markup.slice(markup.indexOf(t("members.manager_owner")));
    expect(select).toContain("عبد الله");
    expect(select).toContain("منار");
    expect(select).not.toContain("— زائر"); // the guest
    expect(select).not.toContain(">راما —");
    expect(select).not.toContain(">حسن —");
    expect(select).not.toContain(">قبس —");
  });
});

describe("the read-only staff directory", () => {
  const people = [
    { id: "a", name: "أحمد", jobTitle: "المدير العام", role: "OWNER" as const, email: "ahmad@example.test" },
    { id: "b", name: "قبس", jobTitle: null, role: "MEMBER" as const, email: null },
  ];

  it("shows title, rank and e-mail when they were given, and links to the profile", () => {
    const markup = renderToStaticMarkup(createElement(StaffDirectory, { people, t, linkProfiles: true }));
    expect(markup).toContain("المدير العام");
    expect(markup).toContain("ahmad@example.test");
    expect(markup).toContain("مالك");
    expect(markup).toContain('href="/u/a"');
  });

  it("shows only names when the server sent only names (no capability to see more)", () => {
    const namesOnly = people.map((p) => ({ id: p.id, name: p.name, jobTitle: null, role: null, email: null }));
    const markup = renderToStaticMarkup(createElement(StaffDirectory, { people: namesOnly, t, linkProfiles: false }));
    expect(markup).toContain("أحمد");
    expect(markup).toContain("قبس");
    expect(markup).not.toContain("example.test");
    expect(markup).not.toContain("مالك");
    expect(markup).not.toContain("href=");
  });

  it("says so when the list is empty", () => {
    expect(renderToStaticMarkup(createElement(StaffDirectory, { people: [], t, linkProfiles: false }))).toContain(t("members.dir_empty"));
  });
});

describe("accessibility, right-to-left and colour rules hold across the whole screen", () => {
  const everything = (): string[] => [
    render(list(SAMPLE.members)),
    render(createElement(CredentialsCard, { heading: "تم", name: "نور", username: "u", password: "p", onDone: noop, secondary: { label: "رجوع", onClick: noop } })),
    render(createElement(AddMemberSheet, { orgId: "o", actor: ownerActor, members: SAMPLE.members, spaces: SPACES, onClose: noop, onCreated: noop })),
    ...[OWNER, ADMIN, LEAD, MEMBER, GUEST, SUSPENDED, OFFBOARDED].map((m) => render(sheet(m))),
    render(sheet(MEMBER, adminActor)),
    renderToStaticMarkup(createElement(StaffDirectory, { people: [{ id: "a", name: "أحمد", jobTitle: "x", role: "OWNER", email: "a@b.test" }], t, linkProfiles: true })),
  ];

  it("uses logical CSS only: start/end, never left/right", () => {
    const physical = /^(?:-?)(?:ml|mr|pl|pr|left|right|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|text-left|text-right|float-left|float-right)(?:-|$)/;
    const offenders = new Set<string>();
    for (const markup of everything()) {
      for (const attr of markup.matchAll(/class="([^"]*)"/g)) {
        for (const token of (attr[1] as string).split(/\s+/)) {
          const utility = token.split(":").pop() as string;
          if (physical.test(utility)) offenders.add(token);
        }
      }
    }
    expect([...offenders]).toEqual([]);
  });

  it("never shows a raw dictionary key (a missing translation prints the key itself)", () => {
    for (const markup of everything()) {
      expect(markup).not.toMatch(/\b(members|orgm|role|common|teams|auth)\.[a-z_.]+/);
    }
  });

  it("every icon-only button and every control has an Arabic accessible name", () => {
    for (const markup of everything()) {
      const buttons = [...markup.matchAll(/<button\b[^>]*>(.*?)<\/button>/gs)];
      for (const [whole, inner] of buttons) {
        const hasText = /[\u0600-\u06FF]/.test((inner as string).replace(/<[^>]*>/g, ""));
        const label = /aria-label="([^"]*)"/.exec(whole)?.[1] ?? "";
        const labelled = /aria-labelledby=/.test(whole);
        expect(hasText || /[\u0600-\u06FF]/.test(label) || labelled, whole.slice(0, 160)).toBe(true);
      }
      for (const input of markup.matchAll(/<input\b[^>]*>/g)) {
        if (/type="checkbox"/.test(input[0])) continue; // wrapped in a label with the space's name
        expect(/aria-label="[^"]*[\u0600-\u06FF]/.test(input[0]) || /\bid="/.test(input[0]), input[0].slice(0, 120)).toBe(true);
      }
    }
  });

  it("every control is a thumb-sized target: none is left at the 32-40px sizes the shared controls default to", () => {
    const small = /(^|\s)(h|size)-(8|9|10)(\s|$)/;
    let checked = 0;
    for (const markup of everything()) {
      for (const tag of markup.matchAll(/<(button|select|input|summary|textarea)\b[^>]*>/g)) {
        const cls = /class="([^"]*)"/.exec(tag[0])?.[1] ?? "";
        expect(small.test(cls), tag[0].slice(0, 140)).toBe(false);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("the switch is a real switch with a name and a description, whose row is at least 56px tall", () => {
    const markup = renderToStaticMarkup(createElement(SwitchRow, { checked: true, onChange: noop, title: "عنوان", hint: "شرح" }));
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toMatch(/aria-labelledby="[^"]+"/);
    expect(markup).toMatch(/aria-describedby="[^"]+"/);
    expect(markup).toContain("min-h-14");
  });

  it("the capability panel is empty-handed for a guest and for the owner", () => {
    const panel = (member: ContractMember, mode: "guest" | "owner") =>
      render(createElement(CapabilityPanel, { member, actor: ownerActor, mode, busy: false, pendingCapability: null, onToggle: noop, onReset: noop }));
    expect(panel(GUEST, "guest")).not.toContain('role="switch"');
    expect(panel(OWNER, "owner")).not.toContain('role="switch"');
  });
});

describe("the source files follow the colour rule", () => {
  const ROOT = path.resolve(__dirname, "..");
  const files = [
    ...readdirSync(path.join(ROOT, "src/components/members")).map((f) => path.join("src/components/members", f)),
    "src/components/org-members-view.tsx",
    "src/lib/members-ui.ts",
    "src/app/(app)/members/page.tsx",
    "src/app/(app)/settings/page.tsx",
  ];

  it("no hard-coded colour: tokens and Tailwind palette classes only", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(path.join(ROOT, file), "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(line)) offenders.push(`${file}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe("the section grid on a person's sheet («الأقسام»)", () => {
  it("the owner sees a box per section and action, ticked as the rank's template gives", () => {
    const markup = render(sheet(MEMBER));
    expect(markup).toContain(t("members.sections_title"));
    for (const section of ["ideas", "goals", "production", "reports"]) expect(markup, section).toContain(t(`members.section.${section}`));
    for (const action of ["view", "edit", "delete"]) expect(markup, action).toContain(t(`members.action.${action}`));
    expect(count(markup, /role="checkbox"/g)).toBe(SECTION_CAPABILITIES.length);
    const onByRank = SECTION_CAPABILITIES.filter((c) => RANK_DEFAULTS.MEMBER.includes(c)).length;
    expect(count(markup, /role="checkbox" aria-checked="true"/g)).toBe(onByRank);
  });

  it("an offboarded person's boxes are all locked", () => {
    const markup = render(sheet(OFFBOARDED));
    expect(count(markup, /role="checkbox"[^>]*disabled=""/g)).toBe(SECTION_CAPABILITIES.length);
  });
});
