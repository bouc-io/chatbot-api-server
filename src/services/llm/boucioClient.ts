/**
 * BoucioClient — Internal bouc.io Ollama client for chatbot streaming.
 *
 * Implements the native Ollama /api/chat NDJSON streaming protocol.
 * This is the extracted version of the inline Axios block previously in chatStreamController.ts.
 *
 * Handles dual-format thinking output:
 *  - JSON thinking field (newer Ollama): data.message.thinking → onThinkingToken
 *  - Legacy <think> tags (older): stripped from content → onThinkingToken
 *
 * The JSON-format thinking content is also reported via onDone.thinking so the caller
 * can reconstruct the <think>…</think> block for DB storage.
 */

import axios from 'axios';
import https from 'https';
import { LLMClient, LLMMessage, LLMStreamCallbacks, LLMChatOptions } from '../../types/llm';
import type { LLMProviderConfig } from './llmClientFactory';
import { createComponentLogger } from '../../lib/logger';

const log = createComponentLogger('boucio-client');

const ALLOW_SELF_SIGNED_CERTS = process.env.ALLOW_SELF_SIGNED_CERTS === 'true';

export class BoucioClient implements LLMClient {
    private baseUrl: string;
    private model: string;

    constructor(config?: LLMProviderConfig | null) {
        // When used as env-var fallback (config = null), read OLLAMA_BASE_URL + OLLAMA_MODEL.
        this.baseUrl = config?.api_endpoint || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        this.model = config?.model || process.env.OLLAMA_MODEL || 'qwen3.5:2b';
    }

    async chatStream(
        messages: LLMMessage[],
        callbacks: LLMStreamCallbacks,
        options?: LLMChatOptions
    ): Promise<void> {
        const httpsAgent = new https.Agent({ rejectUnauthorized: !ALLOW_SELF_SIGNED_CERTS });
        // Resolve think: prefer explicit option, fall back to env var, default true
        const think = options?.think !== undefined
            ? options.think
            : process.env.OLLAMA_THINK !== 'false';

        log.debug({ model: this.model, baseUrl: this.baseUrl, think }, 'BoucioClient: starting stream');

        const ollamaResponse = await axios({
            method: 'post',
            url: `${this.baseUrl}/api/chat`,
            data: { model: this.model, messages, stream: true, think },
            responseType: 'stream',
            httpsAgent,
        });

        // Legacy <think> tag state
        let thinkingContent = '';
        let isInThinkingBlock = false;

        // JSON thinking field accumulator (reported in onDone.thinking for DB storage)
        let jsonThinkingContent = '';

        // NDJSON accumulator across chunk boundaries
        let ndjsonBuffer = '';

        let promptTokens = 0;
        let completionTokens = 0;

        await new Promise<void>((resolve, reject) => {
            ollamaResponse.data.on('data', (chunk: Buffer) => {
                ndjsonBuffer += chunk.toString();
                const lines = ndjsonBuffer.split('\n');
                ndjsonBuffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const data = JSON.parse(line);

                        // JSON thinking format (newer Ollama versions)
                        if (data.message?.thinking) {
                            jsonThinkingContent += data.message.thinking;
                            callbacks.onThinkingToken?.(data.message.thinking);
                        }

                        if (data.message?.content) {
                            const c: string = data.message.content;

                            // Legacy <think> tag format
                            if (c.includes('<think>')) {
                                isInThinkingBlock = true;
                            }

                            if (isInThinkingBlock) {
                                thinkingContent += c;
                                if (c.includes('</think>')) {
                                    isInThinkingBlock = false;
                                    // Emit any content after </think>
                                    const afterThink = thinkingContent.split('</think>')[1] || '';
                                    if (afterThink) {
                                        callbacks.onToken(afterThink);
                                    }
                                    // Extract and emit the thinking content
                                    const match = thinkingContent.match(/<think>([\s\S]*?)<\/think>/);
                                    if (match) {
                                        callbacks.onThinkingToken?.(match[1]);
                                    }
                                    thinkingContent = '';
                                }
                            } else {
                                callbacks.onToken(c);
                            }
                        }

                        if (data.done) {
                            promptTokens = data.prompt_eval_count ?? 0;
                            completionTokens = data.eval_count ?? 0;
                        }
                    } catch {
                        // Incomplete NDJSON chunk — ignore
                    }
                }
            });

            ollamaResponse.data.on('end', resolve);
            ollamaResponse.data.on('error', reject);
        });

        callbacks.onDone?.({
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            // Pass JSON-format thinking for DB storage reconstruction (legacy tag thinking is NOT stored)
            thinking: jsonThinkingContent || undefined,
        });
    }
}
