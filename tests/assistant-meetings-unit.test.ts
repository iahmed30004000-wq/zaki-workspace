import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AR } from "@/lib/i18n/dict";
import { FEATURES, FEATURE_DEFAULTS } from "@/lib/features";
import { agentSettings, signBody, verifySignature, MEETING_SYSTEM_PROMPT } from "@/server/calls/assistant-agent";

/** «المساعد بالاجتماعات» — the parts that need no database: the signature, the settings, the switch, the words. */

const SECRET = "test-agent-secret-0123456789abcdef";

describe("the agent's signature", () => {
  it("signs exactly as the Python agent does (the same vector is pinned in voice-agent/test_logic.py)", () => {
    expect(signBody(SECRET, 1800000000, '{"callId":"c1"}')).toBe("fbb72a635173d244972f1926cd42d36ead7950de25eace6444ea88c91f0cc4bb");
  });

  it("accepts a fresh correct signature and refuses a tampered body, another secret, an old or malformed time", () => {
    const body = '{"callId":"c1"}';
    const ts = 1800000000;
    const sig = signBody(SECRET, ts, body);
    const now = (ts + 5) * 1000;
    expect(verifySignature(SECRET, String(ts), sig, body, now)).toBe(true);
    expect(verifySignature(SECRET, String(ts), sig, body + " ", now)).toBe(false);
    expect(verifySignature("another-secret-0123456789abcdef", String(ts), sig, body, now)).toBe(false);
    expect(verifySignature(SECRET, String(ts), sig, body, (ts + 61) * 1000)).toBe(false);
    expect(verifySignature(SECRET, String(ts), sig, body, (ts - 61) * 1000)).toBe(false);
    expect(verifySignature(SECRET, null, sig, body, now)).toBe(false);
    expect(verifySignature(SECRET, "12ab", sig, body, now)).toBe(false);
  });
});

describe("the agent's settings", () => {
  it("need an http address and a secret of 16+ characters", () => {
    expect(agentSettings({})).toBeNull();
    expect(agentSettings({ VOICE_AGENT_URL: "http://voice-agent:8080", VOICE_AGENT_SECRET: "short" })).toBeNull();
    expect(agentSettings({ VOICE_AGENT_URL: "ftp://x", VOICE_AGENT_SECRET: SECRET })).toBeNull();
    expect(agentSettings({ VOICE_AGENT_URL: "http://voice-agent:8080/", VOICE_AGENT_SECRET: SECRET })).toEqual({ url: "http://voice-agent:8080", secret: SECRET });
  });
});

describe("the switch and the words", () => {
  it("is a switch, OFF by default, with a name and a hint that carries the ⚠️ and 🔧 notes", () => {
    expect(FEATURES).toContain("assistantInMeetings");
    expect(FEATURE_DEFAULTS.assistantInMeetings).toBe(false);
    expect(AR["features.assistantInMeetings.name"]).toMatch(/[؀-ۿ]/);
    expect(AR["features.assistantInMeetings.hint"]).toContain("⚠️");
    expect(AR["features.assistantInMeetings.hint"]).toContain("🔧");
  });

  it("every refusal the routes can answer has Arabic words", () => {
    for (const key of ["calls.e.assistant_not_configured", "calls.e.assistant_unreachable", "calls.assistant.invite", "calls.assistant.dismiss"]) expect(AR[key], key).toMatch(/[؀-ۿ]/);
  });

  it("the prompt asks for a short spoken answer with no formatting and gives the silence word", () => {
    expect(MEETING_SYSTEM_PROMPT).toContain("[صمت]");
    expect(MEETING_SYSTEM_PROMPT).toContain("ما بتنفّذ");
    // spoken in Standard Arabic, not a dialect (the owner asked for it)
    expect(MEETING_SYSTEM_PROMPT).toContain("الفصحى");
  });

  it("the agent's route is a machine path (no session), and the program is kept out of the site's image", () => {
    expect(readFileSync("src/middleware.ts", "utf8")).toContain('"/api/voice-agent/turn"');
    expect(readFileSync(".dockerignore", "utf8")).toContain("voice-agent");
  });
});
