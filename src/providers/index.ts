/**
 * Unified AI provider abstraction.
 *
 * Supports Ollama (local), OpenAI, and Anthropic.
 * Every call site in qagent goes through this module — no direct SDK imports elsewhere.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Ollama } from "ollama";
import type { Message as OllamaMessage } from "ollama";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProviderName = "ollama" | "openai" | "anthropic";

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** For tool results — the ID of the tool call this is responding to. */
  toolCallId?: string;
}

export interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, string>;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  /**
   * The raw assistant message to push back into the conversation.
   * For Anthropic this includes tool_use blocks; for others it's just text.
   * Callers should push this instead of manually building assistant messages.
   */
  rawAssistantMessage: ChatMessage;
}

export interface GenerateOptions {
  temperature?: number;
  /** Request JSON output: json_object mode for OpenAI, format:"json" for Ollama, prompt-handled for Anthropic */
  jsonMode?: boolean;
}

export interface ChatOptions extends GenerateOptions {
  tools?: ToolDef[];
}

// ─── Model registry ──────────────────────────────────────────────────────────

export interface ModelOption {
  id: string;
  label: string;
  provider: ProviderName;
}

export const CLOUD_MODELS: ModelOption[] = [
  { id: "gpt-4o",             label: "GPT-4o — best overall (OpenAI)",         provider: "openai" },
  { id: "gpt-4o-mini",        label: "GPT-4o Mini — fast and cheap (OpenAI)",  provider: "openai" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 — best overall (Anthropic)", provider: "anthropic" },
  { id: "claude-haiku-4-5-20251001",  label: "Claude Haiku 4.5 — fast and cheap (Anthropic)", provider: "anthropic" },
];

// ─── .env file loading ───────────────────────────────────────────────────────
// Loads keys from .env / .env.local so users don't need to export in shell.
// Only loads keys we care about — doesn't pollute the full process.env.

let envLoaded = false;
const envCache: Record<string, string> = {};

const loadEnvFiles = (cwd: string = process.cwd()): void => {
  if (envLoaded) return;
  envLoaded = true;

  const files = [".env", ".env.local", ".env.development", ".env.development.local"];
  for (const file of files) {
    const filePath = join(cwd, file);
    if (!existsSync(filePath)) continue;
    try {
      if (!statSync(filePath).isFile()) continue;
      const content = readFileSync(filePath, "utf8");
      for (const line of content.split("\n")) {
        let trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        // Handle `export KEY=val` syntax
        if (trimmed.startsWith("export ")) trimmed = trimmed.slice(7).trim();
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        // Strip surrounding quotes
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key && val) envCache[key] = val;
      }
    } catch { /* skip unreadable files */ }
  }
};

const readEnvKey = (key: string): string | undefined => {
  // Shell env takes priority
  if (process.env[key]) return process.env[key];
  loadEnvFiles();
  return envCache[key];
};

// ─── API key helpers ─────────────────────────────────────────────────────────

export const getApiKey = (provider: ProviderName): string | undefined => {
  if (provider === "openai")    return readEnvKey("OPENAI_API_KEY");
  if (provider === "anthropic") return readEnvKey("ANTHROPIC_API_KEY");
  return undefined; // Ollama doesn't need a key
};

export const hasApiKey = (provider: ProviderName): boolean => {
  if (provider === "ollama") return true;
  return !!getApiKey(provider);
};

export const envVarName = (provider: ProviderName): string => {
  if (provider === "openai")    return "OPENAI_API_KEY";
  if (provider === "anthropic") return "ANTHROPIC_API_KEY";
  return "";
};

// ─── Ollama provider ─────────────────────────────────────────────────────────

const ollamaGenerate = async (
  model: string,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<string> => {
  const ollama = new Ollama();
  const response = await ollama.generate({
    model,
    prompt,
    ...(opts.jsonMode ? { format: "json" } : {}),
    options: { temperature: opts.temperature ?? 0.2 },
  });
  accrue(response.prompt_eval_count ?? 0, response.eval_count ?? 0);
  return response.response;
};

const ollamaChat = async (
  model: string,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatResponse> => {
  const ollama = new Ollama();
  const ollamaMessages: OllamaMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const response = await ollama.chat({
    model,
    messages: ollamaMessages,
    ...(opts.tools ? { tools: opts.tools } : {}),
    options: { temperature: opts.temperature ?? 0.1 },
  });

  const msg = response.message;
  const content = (msg.content ?? "").trim();
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc, i) => ({
    id: `ollama-${Date.now()}-${i}`,
    name: tc.function.name,
    arguments: tc.function.arguments as Record<string, string>,
  }));
  accrue(response.prompt_eval_count ?? 0, response.eval_count ?? 0);

  return {
    content,
    toolCalls,
    rawAssistantMessage: { role: "assistant", content },
  };
};

export const listOllamaModels = async (): Promise<string[]> => {
  try {
    const { models } = await new Ollama().list();
    return models.map((m) => m.name);
  } catch {
    return [];
  }
};

export const isOllamaRunning = async (): Promise<boolean> => {
  try {
    await new Ollama().list();
    return true;
  } catch {
    return false;
  }
};

// ─── OpenAI provider ─────────────────────────────────────────────────────────

const openaiGenerate = async (
  model: string,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<string> => {
  const apiKey = getApiKey("openai");
  if (!apiKey) throw new Error("OPENAI_API_KEY not set — add it to .env or export in shell");

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: opts.temperature ?? 0.2,
    ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  accrue(data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0);
  return data.choices[0]?.message?.content ?? "";
};

const openaiChat = async (
  model: string,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatResponse> => {
  const apiKey = getApiKey("openai");
  if (!apiKey) throw new Error("OPENAI_API_KEY not set — add it to .env or export in shell");

  // Map our ChatMessage to OpenAI format — tool results need tool_call_id
  const openaiMessages = messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool" as const, content: m.content, tool_call_id: m.toolCallId ?? "" };
    }
    return { role: m.role, content: m.content };
  });

  const body: Record<string, unknown> = {
    model,
    messages: openaiMessages,
    temperature: opts.temperature ?? 0.1,
  };

  if (opts.tools?.length) {
    body["tools"] = opts.tools.map((t) => ({
      type: "function",
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }));
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as {
    choices: {
      message: {
        content: string | null;
        tool_calls?: { id: string; function: { name: string; arguments: string } }[];
      };
    }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  accrue(data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0);

  const msg = data.choices[0]?.message;
  const content = (msg?.content ?? "").trim();
  const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments) as Record<string, string>,
  }));

  return {
    content,
    toolCalls,
    rawAssistantMessage: { role: "assistant", content },
  };
};

// ─── Anthropic provider ──────────────────────────────────────────────────────

const anthropicGenerate = async (
  model: string,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<string> => {
  const apiKey = getApiKey("anthropic");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set — add it to .env or export in shell");

  const body = {
    model,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
    temperature: opts.temperature ?? 0.2,
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    content: { type: string; text?: string }[];
    usage?: { input_tokens: number; output_tokens: number };
  };
  accrue(data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0);
  const textBlock = data.content.find((b) => b.type === "text");
  return textBlock?.text ?? "";
};

const anthropicChat = async (
  model: string,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatResponse> => {
  const apiKey = getApiKey("anthropic");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set — add it to .env or export in shell");

  const systemMsg = messages.find((m) => m.role === "system");

  // Build Anthropic message array — must handle tool results specially.
  // Consecutive tool results get batched into one "user" message.
  type AnthropicMsg = { role: "user" | "assistant"; content: unknown };
  const anthropicMessages: AnthropicMsg[] = [];

  const nonSystem = messages.filter((m) => m.role !== "system");
  let i = 0;
  while (i < nonSystem.length) {
    const m = nonSystem[i]!;

    if (m.role === "tool") {
      // Batch consecutive tool results into one user message
      const toolResults: { type: "tool_result"; tool_use_id: string; content: string }[] = [];
      while (i < nonSystem.length && nonSystem[i]!.role === "tool") {
        const tr = nonSystem[i]!;
        toolResults.push({
          type: "tool_result",
          tool_use_id: tr.toolCallId ?? "",
          content: tr.content,
        });
        i++;
      }
      anthropicMessages.push({ role: "user", content: toolResults });
    } else if (m.role === "assistant") {
      // If content looks like JSON content blocks (from rawAssistantMessage), parse and pass through
      let assistantContent: unknown = m.content;
      try {
        const parsed = JSON.parse(m.content) as unknown;
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object" && parsed[0] !== null && "type" in parsed[0]) {
          assistantContent = parsed;
        }
      } catch { /* plain text, use as-is */ }
      anthropicMessages.push({ role: "assistant", content: assistantContent });
      i++;
    } else {
      // user message
      anthropicMessages.push({ role: "user", content: m.content });
      i++;
    }
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages: anthropicMessages,
    temperature: opts.temperature ?? 0.1,
    ...(systemMsg ? { system: systemMsg.content } : {}),
  };

  if (opts.tools?.length) {
    body["tools"] = opts.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as {
    content: { type: string; id?: string; text?: string; name?: string; input?: Record<string, string> }[];
    usage?: { input_tokens: number; output_tokens: number };
  };
  accrue(data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0);

  const textBlocks = data.content.filter((b) => b.type === "text");
  const toolBlocks = data.content.filter((b) => b.type === "tool_use");
  const content = textBlocks.map((b) => b.text ?? "").join("\n").trim();

  return {
    content,
    toolCalls: toolBlocks.map((b) => ({
      id: b.id ?? "",
      name: b.name ?? "",
      arguments: (b.input ?? {}) as Record<string, string>,
    })),
    // Store the raw content blocks so we can send them back as assistant message
    // This preserves tool_use blocks that Anthropic needs to see
    rawAssistantMessage: {
      role: "assistant",
      content: JSON.stringify(data.content),
    },
  };
};

// ─── Session token accumulator ───────────────────────────────────────────────

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

let _session: TokenUsage = { promptTokens: 0, completionTokens: 0 };

const accrue = (prompt: number, completion: number): void => {
  _session.promptTokens    += prompt;
  _session.completionTokens += completion;
};

export const getSessionUsage  = (): Readonly<TokenUsage> => ({ ..._session });
export const resetSessionUsage = (): void => { _session = { promptTokens: 0, completionTokens: 0 }; };

// ─── Unified API ─────────────────────────────────────────────────────────────

/**
 * Simple prompt → response. Used for test generation, explain, fix.
 */
export const generate = async (
  config: ProviderConfig,
  prompt: string,
  opts: GenerateOptions = {},
): Promise<string> => {
  switch (config.provider) {
    case "ollama":    return ollamaGenerate(config.model, prompt, opts);
    case "openai":    return openaiGenerate(config.model, prompt, opts);
    case "anthropic": return anthropicGenerate(config.model, prompt, opts);
  }
};

/**
 * Multi-turn chat with optional tool calling. Used for agents.
 */
export const chat = async (
  config: ProviderConfig,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatResponse> => {
  switch (config.provider) {
    case "ollama":    return ollamaChat(config.model, messages, opts);
    case "openai":    return openaiChat(config.model, messages, opts);
    case "anthropic": return anthropicChat(config.model, messages, opts);
  }
};
