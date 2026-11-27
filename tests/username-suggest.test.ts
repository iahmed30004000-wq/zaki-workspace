import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { usernameFromName } from "@/lib/username-suggest";
import { usernameSchema } from "@/server/services/credentials";

/** «بدي اسم المستخدم ينعمل لحاله لما بضيف شخص جديد وهو يقدر يعدلو» (the owner, 2026-11-27). */
const SRC = (p: string) => readFileSync(join(__dirname, "..", "src", ...p.split("/")), "utf8").replace(/\r\n/g, "\n");

describe("a sign-in name made from the person's name", () => {
  it("writes the common Arabic names as people write them, first and last joined by a dot", () => {
    expect(usernameFromName("محمد")).toBe("mohammad");
    expect(usernameFromName("أحمد علي")).toBe("ahmad.ali");
    expect(usernameFromName("عبد الله صلاح")).toBe("abdullah.slah");
    expect(usernameFromName("سَارَة خالد العلي")).toBe("sara.alali");
  });

  it("keeps a latin name, and writes the rest letter by letter", () => {
    expect(usernameFromName("Lina Haddad")).toBe("lina.haddad");
    expect(usernameFromName("وليد يزن")).toBe("wlid.yzn");
  });

  it("always fits the one rule of usernames, however short, long or decorated the name; nothing from nothing", () => {
    for (const name of ["لي", "ب", "م.", "عبدالرحمن عبدالرحمن عبدالرحمن عبدالرحمن", "🌟 سلمى 🌟", "John  O'Neil", "مُحَمَّد ـــ"]) {
      const made = usernameFromName(name);
      expect(usernameSchema.safeParse(made).success, `${name} → ${made}`).toBe(true);
      expect(made.length, name).toBeLessThanOrEqual(24);
    }
    expect(usernameFromName("")).toBe("");
    expect(usernameFromName("🌟🌟")).toBe("");
  });
});

describe("the screens", () => {
  it("the add form makes it while the name is typed, until whoever adds types their own; the server's free form follows", () => {
    const sheet = SRC("components/members/add-member-sheet.tsx");
    expect(sheet).toContain("...(typedName ? {} : { username: usernameFromName(name) })");
    expect(sheet).toContain('setTypedName(username !== "");');
    expect(sheet).toContain("suggestUsername(orgId, values.name, stop.signal)");
  });

  it("«حسابي» lets the person change it, with the current password", () => {
    expect(SRC("components/profile-form.tsx")).toContain("{identity?.username ? <OwnUsername username={identity.username} /> : null}");
    expect(SRC("components/own-username.tsx")).toContain('<Input name="currentPassword" type="password" required');
  });
});
