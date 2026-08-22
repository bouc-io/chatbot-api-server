/**
 * LLM Type Definitions for chatbot-api-server
 * Supports multi-provider streaming via the factory abstraction (GAP 6 Phase 2).
 */

export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Streaming callbacks passed to LLMClient.chatStream().
 * - onToken: regular response token (accumulated into fullResponse by caller)
 * - onThinkingToken: chain-of-thought token (streamed to UI via SSE but not stored directly)
 * - onDone: signals end of stream; includes token usage and optionally the full thinking
 *   content (JSON-format only) so the caller can reconstruct the <think>…</think> block
 *   for DB storage without re-accumulating from onThinkingToken.
 * - onError: fatal streaming error
 */
export interface LLMStreamCallbacks {
    onToken: (token: string) => void;
    onThinkingToken?: (token: string) => void;
    onDone?: (usage: {
        prompt_tokens: number;
        completion_tokens: number;
        /** Accumulated thinking content (JSON-format only). Used to rebuild finalContent. */
        thinking?: string;
    }) => void;
    onError?: (err: Error) => void;
}

export interface LLMChatOptions {
    /** Enable chain-of-thought thinking (model-specific; passed as-is for Ollama). */
    think?: boolean;
    temperature?: number;
    max_tokens?: number;
}

/**
 * Common interface for all LLM provider clients in chatbot-api-server.
 * Only streaming is required here; non-streaming is handled by agent-api-server.
 */
export interface LLMClient {
    chatStream(
        messages: LLMMessage[],
        callbacks: LLMStreamCallbacks,
        options?: LLMChatOptions
    ): Promise<void>;
}
