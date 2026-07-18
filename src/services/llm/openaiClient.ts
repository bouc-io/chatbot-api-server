/**
 * OpenAIClient — OpenAI-compatible SSE streaming client.
 *
 * Covers: openai, google (Gemini via OpenAI-compat API), azure.
 * Uses the standard /chat/completions endpoint with SSE streaming.
 *
 * Thinking / reasoning:
 *  - For o-series models (o1, o3): reasoning is implicit; reasoning_effort can be set
 *    but the API does not stream reasoning tokens separately.
 *  - For standard models: think flag is ignored.
 *  - Some providers (DeepSeek, etc.) stream reasoning in delta.reasoning_content.
 */

import axios from 'axios';
import https from 'https';
import { LLMClient, LLMMessage, LLMStreamCallbacks, LLMChatOptions } from '../../types/llm';
import type { LLMProviderConfig } from './llmClientFactory';
import { createComponentLogger } from '../../lib/logger';

const log = createComponentLogger('openai-client');

const ALLOW_SELF_SIGNED_CERTS = process.env.ALLOW_SELF_SIGNED_CERTS === 'true';

export class OpenAIClient implements LLMClient {
    protected config: LLMProviderConfig;

    constructor(config: LLMProviderConfig) {
        this.config = config;
    }

    async chatStream(
        messages: LLMMessage[],
        callbacks: LLMStreamCallbacks,
        options?: LLMChatOptions
    ): Promise<void> {
        const httpsAgent = new https.Agent({ rejectUnauthorized: !ALLOW_SELF_SIGNED_CERTS });
        const baseUrl = this.config.api_endpoint.replace(/\/$/, '');
        const apiKey = this.config.api_key ?? '';

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        };

        // Azure uses api-key header instead of Authorization
        if (this.config.provider === 'azure') {
            headers['api-key'] = apiKey;
            delete headers['Authorization'];
        }

        const body: Record<string, unknown> = {
            model: this.config.model,
            messages,
            stream: true,
            stream_options: { include_usage: true },
        };

        // o-series models: reasoning_effort instead of think
        if (options?.think && /^o[13]/.test(this.config.model)) {
            body.reasoning_effort = 'high';
        }
        if (options?.max_tokens) body.max_tokens = options.max_tokens;

        log.debug({ model: this.config.model, baseUrl, provider: this.config.provider }, 'OpenAIClient: starting stream');

        const response = await axios({
            method: 'post',
            url: `${baseUrl}/chat/completions`,
            data: body,
            headers,
            responseType: 'stream',
            httpsAgent,
        });

        let thinkingContent = '';
        let ndjsonBuffer = '';
        let promptTokens = 0;
        let completionTokens = 0;

        await new Promise<void>((resolve, reject) => {
            response.data.on('data', (chunk: Buffer) => {
                ndjsonBuffer += chunk.toString();
                const lines = ndjsonBuffer.split('\n');
                ndjsonBuffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;
                    if (!trimmed.startsWith('data: ')) continue;

                    try {
                        const data = JSON.parse(trimmed.slice(6));

                        // Usage (sent in the final chunk when stream_options.include_usage is set)
                        if (data.usage) {
                            promptTokens = data.usage.prompt_tokens ?? 0;
                            completionTokens = data.usage.completion_tokens ?? 0;
                        }

                        const delta = data.choices?.[0]?.delta;
                        if (!delta) continue;

                        // Reasoning content (DeepSeek, some OpenAI-compat providers)
                        if (delta.reasoning_content) {
                            thinkingContent += delta.reasoning_content;
                            callbacks.onThinkingToken?.(delta.reasoning_content);
                        }

                        if (delta.content) {
                            callbacks.onToken(delta.content);
                        }
                    } catch {
                        // Incomplete SSE chunk — ignore
                    }
                }
            });

            response.data.on('end', resolve);
            response.data.on('error', reject);
        });

        callbacks.onDone?.({
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            thinking: thinkingContent || undefined,
        });
    }
}
