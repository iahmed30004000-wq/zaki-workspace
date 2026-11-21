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
  });

  it("the prompt asks for the Levantine the owner speaks, not a forced Modern Standard (S6.1; the old order said «الفصحى» and «بدون لهجة عامية»)", () => {
    expect(MEETING_SYSTEM_PROMPT).toContain("اللهجة الشامية");
    expect(MEETING_SYSTEM_PROMPT).not.toContain("الفصحى");
    expect(MEETING_SYSTEM_PROMPT).not.toContain("بدون لهجة");
    // still read aloud: no symbols, no lists, the numbers in words, short
    expect(MEETING_SYSTEM_PROMPT).toContain("بالحروف");
    expect(MEETING_SYSTEM_PROMPT).toContain("جملة إلى ثلاث جمل");
  });

  it("the prompt tells it to stay silent when it did not understand, so an addressed silence is a silence", () => {
    expect(MEETING_SYSTEM_PROMPT).toMatch(/ما فهمت/);
  });

  it("the old «please repeat» sentence is gone from the server: an addressed silence is not answered", () => {
    const source = readFileSync("src/server/calls/assistant-agent.ts", "utf8");
    expect(source).not.toContain("REPEAT_REQUEST");
    expect(source).not.toContain("لم أفهم جيدًا");
  });

  it("the agent's route is a machine path (no session), and the program is kept out of the site's image", () => {
    expect(readFileSync("src/middleware.ts", "utf8")).toContain('"/api/voice-agent/turn"');
    expect(readFileSync(".dockerignore", "utf8")).toContain("voice-agent");
  });
});

describe("the voice agent's side (voice-agent/, a Python program: its own tests are voice-agent/test_logic.py)", () => {
  const logic = readFileSync("voice-agent/logic.py", "utf8");
  const agent = readFileSync("voice-agent/agent.py", "utf8");

  it("a follow-up is eight seconds from the SAME speaker, not twenty-five seconds from anybody", () => {
    expect(logic).toContain("FOLLOW_UP_SECONDS = 8.0");
    expect(logic).not.toContain("FOLLOW_UP_SECONDS = 25");
    expect(logic).toContain("same_speaker");
    expect(agent).toContain("logic.FollowUp()");
    expect(agent).not.toContain("last_spoke_at");
  });

  it("the names are matched as whole words (token by token), never as a piece of another word", () => {
    expect(logic).toContain("def is_named");
    expect(logic).toContain("def _tokens");
    expect(logic).not.toMatch(/normalize\(w\) in words/);
  });

  it("a silence is not answered: the agent speaks only what logic.should_speak lets through", () => {
    expect(logic).toContain("def should_speak");
    expect(agent).toContain("logic.should_speak(answer)");
  });
});

describe("the knobs of the voice agent are passed through its compose file, and the site's are documented", () => {
  const compose = readFileSync("voice-agent/docker-compose.yml", "utf8");
  const example = readFileSync(".env.example", "utf8");

  it("every knob the README documents reaches the container (EDGE_*, PIPER_*, STT_PROMPT, the Gemini model, the filler)", () => {
    for (const name of ["EDGE_VOICE", "EDGE_RATE", "PIPER_LENGTH_SCALE", "PIPER_NOISE_SCALE", "PIPER_NOISE_W", "PIPER_SENTENCE_SILENCE", "STT_PROMPT", "GEMINI_TTS_MODEL", "VOICE_FILLER_TEXT"]) {
      expect(compose, name).toContain(`- ${name}=\${${name}:-`);
    }
  });

  it("the Piper knobs default to empty (the voice's own settings) and the hint to the agent's own text", () => {
    expect(compose).toContain("- PIPER_LENGTH_SCALE=${PIPER_LENGTH_SCALE:-}");
    expect(compose).toContain("STT_PROMPT=${STT_PROMPT:-اجتماع عمل. المساعد زاكي يشارك فيه.}");
  });

  it(".env.example names the site's variables of the meeting assistant (VOICE_AGENT_* and MEETING_LLM_*), commented, with no value", () => {
    for (const name of ["VOICE_AGENT_URL", "VOICE_AGENT_SECRET", "MEETING_LLM_URL", "MEETING_LLM_MODEL", "MEETING_LLM_API_KEY"]) {
      expect(example, name).toMatch(new RegExp(`^# ${name}=\r?$`, "m"));
    }
  });
});
