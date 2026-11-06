import { createAnthropicProvider, type AiProvider } from "./provider";
import { createOllamaProvider } from "./local-provider";
import { createOpenAiCompatProvider } from "./openai-compat-provider";
import { LocalQueue } from "./local-queue";

/** A fast outside model answers in a second or two: a call that waits more than 12 s for its turn, or runs more than 20 s, gives up (the caller falls back). */
const FAST_TIMEOUT_MS = 20_000;
const fastQueue = new LocalQueue(3, 12_000);

/**
 * The one place a provider is made. Production: Anthropic over `fetch` (the default), or — when the owner chose «محلي» for an
 * assistant — an Ollama service (`kind: "ollama"`) or an OpenAI-compatible gateway (`kind: "openai"`) at an INTERNAL address
 * (src/server/ai/local-host.ts). Tests: `setProviderFactoryForTests` swaps in a fake, so no test ever touches the network (and a test can
 * read exactly what the provider was given).
 */
export type ProviderKind = "claude" | "ollama" | "openai";

export interface ProviderConfig {
  /** Claude: the key. An OpenAI-compatible gateway: its optional Bearer key (empty: none). Ollama: empty. */
  apiKey: string;
  model: string;
  /** Default `claude`. */
  kind?: ProviderKind;
  /** A local kind only: the validated address (an origin). */
  baseUrl?: string;
  /** A gateway at an outside https address that the owner allowed (`externalGateway`). */
  external?: boolean;
  /** A gateway whose chat path is not `/v1/chat/completions` (the meeting model, `meeting-model-env.ts`). */
  chatPath?: string;
  /** A shorter wait than a local model's, and a line of its own: a fast outside model must not queue behind the slow local one. */
  fast?: boolean;
}

export type ProviderFactory = (config: ProviderConfig) => AiProvider;

const real: ProviderFactory = (config) => {
  if (config.kind === "ollama") return createOllamaProvider({ baseUrl: config.baseUrl ?? "", model: config.model });
  if (config.kind === "openai") {
    return createOpenAiCompatProvider({
      baseUrl: config.baseUrl ?? "",
      model: config.model,
      apiKey: config.apiKey,
      external: config.external === true,
      ...(config.chatPath ? { chatPath: config.chatPath } : {}),
      ...(config.fast ? { queue: fastQueue, timeoutMs: FAST_TIMEOUT_MS } : {}),
    });
  }
  return createAnthropicProvider({ apiKey: config.apiKey, model: config.model });
};

let factory: ProviderFactory = real;

export function makeProvider(config: ProviderConfig): AiProvider {
  return factory(config);
}

/** Tests only: pass a factory to replace the provider, `null` to restore the real one. */
export function setProviderFactoryForTests(next: ProviderFactory | null): void {
  factory = next ?? real;
}
