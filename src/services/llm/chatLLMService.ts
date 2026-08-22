/**
 * Chat LLM Service (chatbot-api-server)
 *
 * Thin service wrapper over LLMClient that normalises streaming callbacks
 * to the common LLMStreamCallbacks interface.
 *
 * Two implementations:
 *  - OllamaChatLLMService: env-var BoucioClient (no assignment config, internal Ollama fallback)
 *  - GenericChatLLMService: any LLMClient from the factory (OpenAI, Anthropic, Custom, Boucio)
 */

import { LLMClient, LLMMessage, LLMStreamCallbacks, LLMChatOptions } from '../../types/llm';
import { BoucioClient } from './boucioClient';

export interface ChatLLMService {
    streamChat(
        messages: LLMMessage[],
        callbacks: LLMStreamCallbacks,
        options?: LLMChatOptions
    ): Promise<void>;
}

/**
 * Fallback service used when no assignment config is found.
 * Creates a BoucioClient from env vars (OLLAMA_BASE_URL + OLLAMA_MODEL).
 */
export class OllamaChatLLMService implements ChatLLMService {
    private client: LLMClient;

    constructor() {
        this.client = new BoucioClient(null);
    }

    async streamChat(
        messages: LLMMessage[],
        callbacks: LLMStreamCallbacks,
        options?: LLMChatOptions
    ): Promise<void> {
        return this.client.chatStream(messages, callbacks, options);
    }
}

/**
 * Service backed by a factory-resolved LLMClient (any provider).
 */
export class GenericChatLLMService implements ChatLLMService {
    private client: LLMClient;

    constructor(client: LLMClient) {
        this.client = client;
    }

    async streamChat(
        messages: LLMMessage[],
        callbacks: LLMStreamCallbacks,
        options?: LLMChatOptions
    ): Promise<void> {
        return this.client.chatStream(messages, callbacks, options);
    }
}
