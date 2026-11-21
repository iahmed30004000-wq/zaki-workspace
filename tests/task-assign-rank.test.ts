import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OrgRole } from "@prisma/client";
import { assignKindByRank, isRequestTo } from "@/server/policy/assign-rank";
import { AR } from "@/lib/i18n/dict";
import { TaskAssignRequestBanner, type RequestBannerMode } from "@/components/task-assign-request-banner";
import fragment from "@/lib/i18n/ar.task-requests.json";

/**
 * Who may give a task to whom, by rank: the pure rule, the banner of a pending request, the words, and the pin that every
 * way of setting an assignee goes through the one judge. The database half is tests/db/assign-by-rank.test.ts.
 */
// the banner reads its words through `useI18n()`; the provider is a client component, so the test hands it the same dictionary
vi.mock("@/lib/i18n", async () => {
  const { AR: dict } = await import("@/lib/i18n/dict");
  const { interpolate } = await import("@/lib/i18n/interpolate");
  return { useI18n: () => ({ t: (key: string, vars?: Record<string, string | number>) => interpolate(dict[key] ?? key, vars) }) };
});

const ROLES: OrgRole[] = ["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"];
const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("the rank rule", () => {
  it("below and the same rank are direct; above is a request; the owner gives to anybody; a guest never asks", () => {
    const matrix: Record<string, string> = {
      "OWNER>OWNER": "direct", "OWNER>ADMIN": "direct", "OWNER>LEAD": "direct", "OWNER>MEMBER": "direct", "OWNER>GUEST": "direct",
      "ADMIN>OWNER": "request", "ADMIN>ADMIN": "direct", "ADMIN>LEAD": "direct", "ADMIN>MEMBER": "direct", "ADMIN>GUEST": "direct",
      "LEAD>OWNER": "request", "LEAD>ADMIN": "request", "LEAD>LEAD": "direct", "LEAD>MEMBER": "direct", "LEAD>GUEST": "direct",
      "MEMBER>OWNER": "request", "MEMBER>ADMIN": "request", "MEMBER>LEAD": "request", "MEMBER>MEMBER": "direct", "MEMBER>GUEST": "direct",
      "GUEST>OWNER": "refused", "GUEST>ADMIN": "refused", "GUEST>LEAD": "refused", "GUEST>MEMBER": "refused", "GUEST>GUEST": "direct",
    };
    for (const a of ROLES) for (const b of ROLES) expect(assignKindByRank(a, b), `${a}>${b}`).toBe(matrix[`${a}>${b}`]);
  });

  it("the picker marks only the people a pick would ask", () => {
    expect(isRequestTo("MEMBER", "ADMIN")).toBe(true);
    expect(isRequestTo("MEMBER", "MEMBER")).toBe(false);
    expect(isRequestTo("OWNER", "ADMIN")).toBe(false);
    expect(isRequestTo("GUEST", "ADMIN")).toBe(false); // refused, not a request
  });
});

describe("the banner on the task page", () => {
  const draw = (props: Partial<React.ComponentProps<typeof TaskAssignRequestBanner>> & { mode: RequestBannerMode }) =>
    renderToStaticMarkup(React.createElement(TaskAssignRequestBanner, { fromName: "سارة", toName: "أحمد", ...props }));

  it("the addressed person sees who asked, with «قبول» and «إرجاع بسبب»", () => {
    const html = draw({ mode: "addressee" });
    expect(html).toContain("سارة");
    expect(html).toContain(">قبول<");
    expect(html).toContain(">إرجاع بسبب<");
    expect(html).not.toContain("<textarea");
  });

  it("returning asks for a written reason first, and sends nothing without one", () => {
    const html = draw({ mode: "addressee", initialReturning: true });
    expect(html).toContain("<textarea");
    expect(html).toContain(AR["taskreq.reason"]!);
    expect(html).not.toContain(">قبول<");
    // the send button is disabled while the reason is empty
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>أرجِع الطلب<\/button>/);
  });

  it("the owner answering for somebody else sees both names", () => {
    const html = draw({ mode: "owner" });
    expect(html).toContain("سارة");
    expect(html).toContain("أحمد");
    expect(html).toContain(">قبول<");
  });

  it("the requester only sees who the answer is awaited from: no buttons", () => {
    const html = draw({ mode: "waiting" });
    expect(html).toContain("أحمد");
    expect(html).not.toContain("<button");
  });

  it("uses theme tokens only: no Tailwind palette colour and no hex value", () => {
    const source = read("src/components/task-assign-request-banner.tsx");
    expect(source).not.toMatch(/(text|bg|border)-(red|green|blue|yellow|amber|orange|gray|slate|zinc|neutral)-\d/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("the words", () => {
  it("lives in its own fragment and is registered: no key in two files", () => {
    expect(read("src/lib/i18n/dict.ts")).toContain("ar.task-requests.json");
    for (const key of Object.keys(fragment)) expect(AR[key], key).toBe((fragment as Record<string, string>)[key]);
  });

  it("every notification type has its Arabic title, and every refusal its Arabic sentence", () => {
    for (const key of ["notif.type.task_assign_request", "notif.type.task_assign_accepted", "notif.type.task_assign_returned"]) {
      expect(AR[key], key).toMatch(/[؀-ۿ]/);
    }
    const errors = [
      "assign.not_allowed", "assign.guest_cannot_give", "assign.guest_outside_space", "assign.guest_no_request", "assign.request_not_in_space", "assign.target_not_in_space",
      "taskreq.already_pending", "taskreq.not_found", "taskreq.already_answered", "taskreq.not_addressee", "taskreq.reason_required",
    ];
    for (const key of errors) expect(AR[key], key).toMatch(/[؀-ۿ]/);
    // errors are Modern Standard Arabic (the dialect is for the labels around them)
    const dialect = /(^|\s)(ما ب|ما عندك|هال|هون|بس[ .،]|شوي|كتير|لسا|بدك|اللي|شيل|ابعت|بتقدر|بيقدر|ما لقينا|استنى)/;
    for (const key of errors) expect(AR[key], key).not.toMatch(dialect);
  });

  it("the picker's mark and its line are the owner's words", () => {
    expect(AR["taskreq.tag"]).toBe("طلب");
    expect(AR["taskreq.hint"]).toBe("هالطلب بينبعت له وبيقبله أو بيرجّعه");
  });
});

describe("one judge for every way a task gets an assignee", () => {
  it("createTask and updateTask ask judgeAssignment, and no longer decide it by hand", () => {
    const source = read("src/server/services/tasks.ts");
    expect(source.match(/judgeAssignment\(/g)?.length).toBe(2);
    expect(source).not.toContain('throw new ForbiddenError("assignee.not_member")');
  });

  it("the instant task goes through createTask and tells the person only when it was really assigned", () => {
    const source = read("src/server/services/instant-work.ts");
    expect(source).toContain("createTask(");
    expect(source).toContain("task.assigneeId && task.assigneeId !== ctx.userId");
  });

  it("the task PATCH route sends «أُسندت إليك» only when the task really went to them", () => {
    expect(read("src/app/api/tasks/[id]/route.ts")).toContain("task.assigneeId === id");
  });

  it("the two answer routes exist and go through the service", () => {
    for (const door of ["accept", "return"]) {
      const source = read(`src/app/api/tasks/[id]/request/${door}/route.ts`);
      expect(source).toContain("answerAssignRequest(");
      expect(source).toContain("requireTaskAccess(");
    }
  });
});
