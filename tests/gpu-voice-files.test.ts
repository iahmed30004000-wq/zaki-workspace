import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «كرت الشاشة»: the deployment files of the voice program (voice-agent/). The compose file of a server WITHOUT a card keeps working as it did; the one
 * for a card is a whole file of its own (Coolify deploys one file) that must pass the same settings, keep the same models volume, reserve the card and
 * build the CUDA libraries in with pinned versions. No docker build runs here: these are the files read as text.
 */
const read = (p: string) => readFileSync(join(process.cwd(), "voice-agent", p), "utf8").replace(/\r\n/g, "\n");

const envOf = (compose: string) =>
  new Map(
    [...compose.matchAll(/^ {6}- ([A-Z_0-9]+)=(.*)$/gm)].map((m) => [m[1] as string, m[2] as string]),
  );
/** Comments do not deploy. */
const code = (text: string) => text.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");

describe("the compose file of a server without a card", () => {
  const base = code(read("docker-compose.yml"));

  it("asks for no card and builds no card libraries", () => {
    expect(base).not.toMatch(/nvidia|driver:|reservations|GPU|LD_LIBRARY_PATH/);
  });

  it("keeps the processor's model and threads as they were, and passes the new choice with «auto» as its default", () => {
    const env = envOf(base);
    expect(env.get("WHISPER_MODEL")).toBe("${WHISPER_MODEL:-small}");
    expect(env.get("WHISPER_THREADS")).toBe("${WHISPER_THREADS:-0}");
    expect(env.get("STT_DEVICE")).toBe("${STT_DEVICE:-auto}");
  });
});

describe("the compose file of a server with a card", () => {
  const base = code(read("docker-compose.yml"));
  const gpu = code(read("docker-compose.gpu.yml"));

  it("passes every setting of the other file with the same default, so switching files loses nothing", () => {
    const wanted = envOf(base);
    const got = envOf(gpu);
    expect(wanted.size).toBeGreaterThan(20);
    for (const [name, value] of wanted) expect(got.get(name), name).toBe(value);
  });

  it("keeps the same service name, the same secret and the same models volume (nothing is typed or downloaded twice)", () => {
    expect(gpu).toMatch(/^services:\n {2}voice-agent:/m);
    expect(gpu).toContain("VOICE_AGENT_SECRET=${SERVICE_PASSWORD_VOICEAGENT}");
    expect(gpu).toContain("- voice-models:/models");
    expect(gpu).toMatch(/^volumes:\n {2}voice-models:/m);
  });

  it("reserves one NVIDIA card, with the driver's own tool for its name, and builds the libraries in", () => {
    expect(gpu).toMatch(/deploy:\n +resources:\n +reservations:\n +devices:\n +- driver: nvidia\n +count: 1\n +capabilities: \[gpu\]/);
    expect(gpu).toMatch(/args:\n +GPU: "1"/);
    expect(envOf(gpu).get("NVIDIA_DRIVER_CAPABILITIES")).toBe("compute,utility");
  });

  it("points the loader at the two libraries pip installs in this image", () => {
    const path = envOf(gpu).get("LD_LIBRARY_PATH") ?? "";
    expect(path).toContain("/usr/local/lib/python3.11/site-packages/nvidia/cublas/lib");
    expect(path).toContain("/usr/local/lib/python3.11/site-packages/nvidia/cudnn/lib");
    expect(read("Dockerfile")).toMatch(/^FROM python:3\.11-slim$/m);
  });

  it("does not name the model of the card through the processor's variable (Coolify keeps what it read from the first file)", () => {
    expect(envOf(gpu).get("WHISPER_GPU_MODEL")).toBe("${WHISPER_GPU_MODEL:-large-v3}");
    expect(envOf(gpu).get("WHISPER_GPU_COMPUTE")).toBe("${WHISPER_GPU_COMPUTE:-int8_float16}");
  });
});

describe("the image", () => {
  const dockerfile = read("Dockerfile");

  it("carries every module of the program", () => {
    const copied = /^COPY (.*\.py.*) \.\/$/m.exec(dockerfile)?.[1] ?? "";
    for (const name of readdirSync(join(process.cwd(), "voice-agent")).filter((f) => f.endsWith(".py") && !f.startsWith("test_"))) {
      expect(copied.split(" "), name).toContain(name);
    }
  });

  it("installs the card libraries only when the build asks for them, in one resolve with the ordinary ones", () => {
    expect(dockerfile).toMatch(/^ARG GPU=0$/m);
    expect(dockerfile).toContain('if [ "$GPU" = "1" ]; then pip install --no-cache-dir -r requirements.txt -r requirements-gpu.txt; else pip install --no-cache-dir -r requirements.txt; fi');
  });

  it("pins every card library to one exact version, and CTranslate2 to the version those libraries belong to", () => {
    expect(existsSync(join(process.cwd(), "voice-agent", "requirements-gpu.txt"))).toBe(true);
    const lines = read("requirements-gpu.txt").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    expect(lines).toEqual(["ctranslate2==4.5.0", "nvidia-cublas-cu12==12.4.5.8", "nvidia-cudnn-cu12==9.1.0.70"]);
    // the ordinary build is untouched: it pins no card library and leaves CTranslate2 to faster-whisper as before
    expect(read("requirements.txt")).not.toMatch(/ctranslate2|nvidia/);
  });
});

describe("the owner's guide", () => {
  const readme = read("README.md");

  it("has the steps for a card, with the warning and its fix, and says they were not tried on his server", () => {
    const part = readme.slice(readme.indexOf("## كرت الشاشة"));
    expect(readme).toContain("## كرت الشاشة");
    for (const word of ["docker-compose.gpu.yml", "docker-compose.yml", "nvidia-smi", "STT_DEVICE", "WHISPER_GPU_MODEL", "⚠️", "🔧", "ما انجرّبت"]) {
      expect(part, word).toContain(word);
    }
  });
});
