import { createAnthropicProvider, type AiProvider } from "./provider";
import { createOllamaProvider } from "./local-provider";
import { createOpenAiCompatProvider } from "./openai-compat-provider";

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
}

export type ProviderFactory = (config: ProviderConfig) => AiProvider;

const real: ProviderFactory = (config) => {
  if (config.kind === "ollama") return createOllamaProvider({ baseUrl: config.baseUrl ?? "", model: config.model });
  if (config.kind === "openai") return createOpenAiCompatProvider({ baseUrl: config.baseUrl ?? "", model: config.model, apiKey: config.apiKey });
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
