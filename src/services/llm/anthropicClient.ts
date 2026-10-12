/**
 * AnthropicClient — Anthropic /v1/messages SSE streaming client.
 *
 * Key differences from OpenAI:
 *  - System messages must be extracted to a top-level `system` field.
 *  - Authorization uses `x-api-key` header (not `Authorization: Bearer`).
 *  - Streaming event format: `event: …\ndata: …` (SSE with named events).
 *  - Thinking enabled via `thinking: { type: "enabled", budget_tokens: N }`.
 *  - Thinking content arrives in `content_block_delta` events with `type: "thinking_delta"`.
 *  - Token usage: `input_tokens` / `output_tokens` (reported in `message_delta` event).
 */

import axios from "axios";
import https from "https";
import {
  LLMClient,
  LLMMessage,
  LLMStreamCallbacks,
  LLMChatOptions,
} from "../../types/llm";
import type { LLMProviderConfig } from "./llmClientFactory";
import { createComponentLogger } from "../../lib/logger";

const log = createComponentLogger("anthropic-client");

const ALLOW_SELF_SIGNED_CERTS = process.env.ALLOW_SELF_SIGNED_CERTS === "true";
const DEFAULT_THINKING_BUDGET = 8000;

export class AnthropicClient implements LLMClient {
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  async chatStream(
    messages: LLMMessage[],
    callbacks: LLMStreamCallbacks,
    options?: LLMChatOptions,
  ): Promise<void> {
    const httpsAgent = new https.Agent({
      rejectUnauthorized: !ALLOW_SELF_SIGNED_CERTS,
    });
    const baseUrl = this.config.api_endpoint.replace(/\/$/, "");
    const apiKey = this.config.api_key ?? "";

    // Extract system message(s) to top-level system field
    const systemMessages = messages.filter((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");
    const systemContent =
      systemMessages.map((m) => m.content).join("\n\n") || undefined;

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: options?.max_tokens ?? 8096,
      stream: true,
    };

    if (systemContent) body.system = systemContent;

    // Enable extended thinking if requested
    if (options?.think && this.config.enable_reasoning) {
      body.thinking = {
        type: "enabled",
        budget_tokens: DEFAULT_THINKING_BUDGET,
      };
    }

    log.debug(
      { model: this.config.model, baseUrl, think: !!body.thinking },
      "AnthropicClient: starting stream",
    );

    const response = await axios({
      method: "post",
      url: `${baseUrl}/v1/messages`,
      data: body,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      responseType: "stream",
      httpsAgent,
    });

    let thinkingContent = "";
    let ndjsonBuffer = "";
    let promptTokens = 0;
    let completionTokens = 0;
    // Track whether the current content block is a thinking block
    let currentBlockIsThinking = false;

    await new Promise<void>((resolve, reject) => {
      response.data.on("data", (chunk: Buffer) => {
        ndjsonBuffer += chunk.toString();
        const lines = ndjsonBuffer.split("\n");
        ndjsonBuffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith("event: ")) {
            eventType = trimmed.slice(7).trim();
            continue;
          }

          if (!trimmed.startsWith("data: ")) continue;

          try {
            const data = JSON.parse(trimmed.slice(6));

            switch (eventType) {
              case "content_block_start":
                // Track whether this block is a thinking block
                currentBlockIsThinking =
                  data.content_block?.type === "thinking";
                break;

              case "content_block_delta": {
                const delta = data.delta;
                if (!delta) break;

                if (delta.type === "thinking_delta" && delta.thinking) {
                  thinkingContent += delta.thinking;
                  callbacks.onThinkingToken?.(delta.thinking);
                } else if (
                  delta.type === "text_delta" &&
                  delta.text &&
                  !currentBlockIsThinking
                ) {
                  callbacks.onToken(delta.text);
                }
                break;
              }

              case "message_delta":
                // Usage is reported here with stop_reason
                if (data.usage) {
                  promptTokens = data.usage.input_tokens ?? promptTokens;
                  completionTokens = data.usage.output_tokens ?? 0;
                }
                break;

              case "message_start":
                // Initial usage (input_tokens available here)
                if (data.message?.usage) {
                  promptTokens = data.message.usage.input_tokens ?? 0;
                }
                break;
            }
          } catch {
            // Incomplete SSE data — ignore
          }
        }
      });

      response.data.on("end", resolve);
      response.data.on("error", reject);
    });

    callbacks.onDone?.({
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      thinking: thinkingContent || undefined,
    });
  }
}
