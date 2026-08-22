/**
 * CustomClient — OpenAI-compatible client for self-hosted / custom endpoints.
 *
 * Covers: vLLM, LM Studio, llama.cpp server, and any OpenAI-compatible endpoint
 * registered with provider = 'custom'.
 *
 * Extends OpenAIClient directly — same SSE streaming protocol, own named class
 * for clarity and future customization.
 */

import { OpenAIClient } from './openaiClient';

export class CustomClient extends OpenAIClient {
    // Inherits all OpenAIClient behaviour.
    // Override methods here if custom endpoints diverge from the OpenAI SSE format.
}
