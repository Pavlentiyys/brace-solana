import { NextResponse } from "next/server";
import Anthropic, { APIConnectionError, APIError } from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";

import { ACTION_SCHEMA, parseAction } from "@/lib/chat/actions";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_MODEL = "claude-opus-4-8";
const DEFAULT_ROUTER_BASE_URL = "https://agentrouter.org";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const MAX_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 6_000;

type ChatRole = "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface ChatContext {
  connected?: boolean;
  world?: "demo" | "chain";
  clusterLabel?: string;
  positionCount?: number | null;
  supportedCount?: number;
  hasGuard?: boolean;
  paused?: boolean;
  ltvBps?: number | null;
  triggerBps?: number | null;
  liquidationBps?: number | null;
  refreshed?: boolean;
  canAct?: boolean;
}

interface ChatRequest {
  messages?: unknown;
  context?: unknown;
}

function isMessage(value: unknown): value is ChatMessage {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.role === "user" || candidate.role === "assistant") &&
    typeof candidate.content === "string" &&
    candidate.content.trim().length > 0 &&
    candidate.content.length <= MAX_MESSAGE_LENGTH
  );
}

function isContext(value: unknown): value is ChatContext {
  return value === undefined || (typeof value === "object" && value !== null);
}

function contextSummary(context: ChatContext | undefined): string {
  if (!context) return "No wallet or position context is available.";

  return JSON.stringify({
    connected: context.connected ?? false,
    world: context.world ?? "demo",
    cluster: context.clusterLabel ?? "unknown",
    positionCount: context.positionCount ?? null,
    supportedCount: context.supportedCount ?? 0,
    hasGuard: context.hasGuard ?? false,
    paused: context.paused ?? false,
    ltvBps: context.ltvBps ?? null,
    triggerBps: context.triggerBps ?? null,
    liquidationBps: context.liquidationBps ?? null,
    refreshed: context.refreshed ?? true,
    canAct: context.canAct ?? false,
  });
}

function normalizeMessages(messages: ChatMessage[]): ChatMessage[] {
  const normalized: ChatMessage[] = [];
  for (const message of messages) {
    const previous = normalized.at(-1);
    if (previous?.role === message.role) {
      previous.content = `${previous.content}\n\n${message.content}`;
    } else {
      normalized.push({ ...message });
    }
  }

  const firstUser = normalized.findIndex((message) => message.role === "user");
  return firstUser < 0 ? [] : normalized.slice(firstUser);
}

function normalizeAnthropicBaseUrl(value: string): string {
  const normalized = value.replace(/\/+$/, "");
  if (normalized.endsWith("/v1/messages")) return normalized.slice(0, -13);
  if (normalized.endsWith("/v1")) return normalized.slice(0, -3);
  return normalized;
}

function findErrorMessage(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim() !== "") {
    return record.message.trim();
  }
  return findErrorMessage(record.error);
}

function upstreamErrorMessage(error: APIError): string {
  const fallback = error.message.trim();
  return findErrorMessage(error.error) ?? (fallback || "The router did not provide an error message.");
}

function runtimeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause;
    if (typeof cause === "object" && cause !== null && "code" in cause) {
      const code = (cause as { code?: unknown }).code;
      if (typeof code === "string" && code.trim() !== "") {
        return `${error.message} (${code})`;
      }
    }
    return error.message || error.name;
  }
  return "Unknown Agent Router error.";
}

function isWafChallenge(value: unknown): boolean {
  if (typeof value === "string") {
    return /aliyun_waf_|access verification|aliyuncaptcha|slide to complete/i.test(value);
  }
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return isWafChallenge(record.error) || isWafChallenge(record.message) || isWafChallenge(record.content);
}

function responseText(value: unknown, depth = 0): string {
  if (depth > 4) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const blockText = value
      .filter((block): block is Record<string, unknown> => typeof block === "object" && block !== null)
      .filter((block) =>
        ["text", "output_text", "text_delta"].includes(String(block.type)) && typeof block.text === "string",
      )
      .map((block) => String(block.text).trim())
      .filter(Boolean)
      .join("\n\n");
    if (blockText) return blockText;
    for (const item of value) {
      const nested = responseText(item, depth + 1);
      if (nested) return nested;
    }
    return "";
  }
  if (typeof value !== "object" || value === null) return "";

  const payload = value as Record<string, unknown>;
  for (const key of ["content", "output_text", "completion", "text", "message", "output", "choices", "data", "response", "result"]) {
    const nested = responseText(payload[key], depth + 1);
    if (nested) return nested;
  }
  return "";
}

function systemPrompt(context: ChatContext | undefined): string {
  return [
    "You are Brace, a cautious Solana risk assistant for Kamino borrow positions.",
    "Answer only from the supplied position context and the conversation.",
    "When the user describes what the agent should do — a trigger LTV, pausing, revoking, funding or withdrawing the reserve — call the matching tool with their numbers. When they ask for a one-time repayment now or at the current LTV, call repay_now. That is an immediate owner action, not a set_rule request. Do not describe the change in prose instead of calling it.",
    "Calling a tool only PROPOSES the change. It is shown to the user, checked against the on-chain limits, and takes effect only once they confirm it and sign in their wallet. Say what you are proposing; never say it is done, signed, repaid, or changed.",
    "Never invent limits the user did not give. Leave optional tool fields out and the app fills in its own defaults.",
    "If the context is missing or stale, say so plainly. Do not invent balances, prices, transactions, or safety guarantees.",
    "Keep answers concise, practical, and easy to scan. Use plain text, no markdown tables.",
    `Current app context: ${contextSummary(context)}`,
  ].join("\n");
}

async function generateWithGemini({
  apiKey,
  model,
  messages,
  context,
}: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  context: ChatContext | undefined;
}) {
  try {
    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.generateContent({
      model,
      contents: messages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      config: {
        systemInstruction: systemPrompt(context),
        maxOutputTokens: 900,
        // The model may propose one of a closed set of actions with typed numeric
        // arguments. It cannot execute any of them: the reply is rendered as a
        // proposal, checked against the same rules the program enforces, and signed
        // only if the user confirms it in their own wallet.
        tools: [{ functionDeclarations: ACTION_SCHEMA as unknown as [] }],
      },
    });

    const call = response.functionCalls?.[0];
    const action = call ? parseAction(call.name, call.args) : null;
    const text = response.text?.trim();

    if (!text && !action) {
      return NextResponse.json({ error: "Gemini returned an empty answer." }, { status: 502 });
    }
    return NextResponse.json({ text: text ?? "", action, model, provider: "gemini" });
  } catch (error) {
    const message = runtimeErrorMessage(error);
    console.error("Gemini chat request failed", message);
    if (/429|resource_exhausted|quota|prepayment credits depleted/i.test(message)) {
      return NextResponse.json(
        { error: "Gemini quota is exhausted. Add credits in Google AI Studio or use a key from another project." },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: `Gemini request failed: ${message}` }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const geminiApiKey = process.env.GOOGLE_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  const agentRouterApiKey =
    process.env.AGENT_ROUTER_API_KEY?.trim() ||
    process.env.ANTHROPIC_AUTH_TOKEN?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim();
  if (!geminiApiKey && !agentRouterApiKey) {
    return NextResponse.json(
      { error: "Neither GEMINI_API_KEY nor an Agent Router API key is configured on the server." },
      { status: 503 },
    );
  }

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: "A non-empty message history is required." }, { status: 400 });
  }

  const invalidMessageIndex = body.messages.findIndex((message) => !isMessage(message));
  if (invalidMessageIndex !== -1) {
    return NextResponse.json(
      { error: `Invalid chat message at index ${invalidMessageIndex}. Content must be a non-empty string of at most ${MAX_MESSAGE_LENGTH} characters.` },
      { status: 400 },
    );
  }
  if (!isContext(body.context)) {
    return NextResponse.json({ error: "The chat context must be an object or omitted." }, { status: 400 });
  }

  const messages = normalizeMessages(body.messages.map((message) => ({
    role: message.role,
    content: message.content.trim(),
  })));
  if (messages.length === 0) {
    return NextResponse.json({ error: "A user message is required." }, { status: 400 });
  }
  const context = body.context as ChatContext | undefined;

  if (geminiApiKey) {
    return generateWithGemini({
      apiKey: geminiApiKey,
      model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
      messages,
      context,
    });
  }

  const apiKey = agentRouterApiKey as string;
  const model =
    process.env.AGENT_ROUTER_MODEL?.trim() || process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  const baseUrl =
    process.env.AGENT_ROUTER_BASE_URL?.trim() ||
    process.env.ANTHROPIC_BASE_URL?.trim() ||
    DEFAULT_ROUTER_BASE_URL;
  const anthropicBaseUrl = normalizeAnthropicBaseUrl(baseUrl);

  try {
    const client = new Anthropic({
      apiKey,
      authToken: apiKey,
      baseURL: anthropicBaseUrl,
      maxRetries: 0,
      timeout: 20_000,
    });
    const response = await client.messages.create({
      model,
      max_tokens: 900,
      system: systemPrompt(context),
      messages,
    });

    if (isWafChallenge(response)) {
      console.error("Agent Router returned an Alibaba WAF verification page");
      return NextResponse.json(
        { error: "Agent Router blocked the Vercel request with an Alibaba WAF verification page. Check the router whitelist or use an approved endpoint." },
        { status: 502 },
      );
    }

    const responseError = findErrorMessage((response as unknown as Record<string, unknown>).error);
    if (responseError) {
      console.error("Agent Router returned an error payload", responseError);
      return NextResponse.json(
        { error: `Agent Router rejected the request: ${responseError}` },
        { status: 502 },
      );
    }

    const text = responseText(response);

    if (!text) {
      const keys = typeof response === "object" && response !== null
        ? Object.keys(response).join(", ")
        : "unknown";
      console.error("Agent Router returned an unsupported response shape", keys);
      return NextResponse.json(
        { error: `Agent Router returned no text (response fields: ${keys || "none"}).` },
        { status: 502 },
      );
    }

    return NextResponse.json({ text, model });
  } catch (error) {
    if (error instanceof APIError) {
      if (isWafChallenge(error.error) || isWafChallenge(error.message)) {
        console.error("Agent Router returned an Alibaba WAF verification page");
        return NextResponse.json(
          { error: "Agent Router blocked the Vercel request with an Alibaba WAF verification page. Check the router whitelist or use an approved endpoint." },
          { status: 502 },
        );
      }
      const upstreamMessage = upstreamErrorMessage(error);
      console.error("Agent Router chat request failed", error.status, upstreamMessage);
      if (error.status === 401) {
        return NextResponse.json(
          { error: "Agent Router rejected the API key. Check the router key and restart the router." },
          { status: 502 },
        );
      }
      if (error.status === 404) {
        return NextResponse.json(
          { error: `Agent Router model ${model} was not found. Check the router model mapping.` },
          { status: 502 },
        );
      }
      if (error.status === 400) {
        return NextResponse.json(
          { error: `Agent Router rejected the request: ${upstreamMessage}` },
          { status: 502 },
        );
      }
    }
    if (error instanceof APIConnectionError) {
      const message = runtimeErrorMessage(error);
      console.error("Agent Router connection failed", message);
      return NextResponse.json(
        { error: `Agent Router connection failed: ${message}` },
        { status: 502 },
      );
    }
    const message = runtimeErrorMessage(error);
    console.error("Agent Router chat request failed", message);
    return NextResponse.json(
      { error: `Agent Router request failed: ${message}` },
      { status: 502 },
    );
  }
}
