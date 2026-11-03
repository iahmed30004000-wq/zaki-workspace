import { describe, expect, it } from "vitest";
import { FEATURES, FEATURE_DEFAULTS } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";

describe("«حوّل» in «نتفرّج سوا»: its switch and its words", () => {
  it("has its own switch, on by default (a harmless screen action)", () => {
    expect(FEATURES).toContain("watchConvert");
    expect(FEATURE_DEFAULTS.watchConvert).toBe(true);
  });

  it("the switch is named, and its hint carries the risk and the fix", () => {
    expect(AR["features.watchConvert.name"]).toBeTruthy();
    expect(AR["features.watchConvert.hint"]).toContain("⚠️");
    expect(AR["features.watchConvert.hint"]).toContain("🔧");
  });

  it("every state a comment can show has its words", () => {
    for (const key of ["watch.convert.became_task", "watch.convert.became_idea", "watch.convert.became_project"]) expect(AR[key], key).toBeTruthy();
  });
});
