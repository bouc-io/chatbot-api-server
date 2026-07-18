import { Request, Response } from 'express';
import { createComponentLogger } from '../lib/logger';
import { distillationClient } from '../services/distillationClient';
import { fetchInstructions } from '../services/instructionClient';
import { memoryClient } from '../services/memoryClient';
import { buildInstructionPrefix, buildKnowledgeSuffix } from '../services/memoryFormatter';
import { fetchAssignmentConfig, createLLMClientFromConfig } from '../services/llm/assignmentConfigClient';
import { OllamaChatLLMService, GenericChatLLMService } from '../services/llm/chatLLMService';

const logger = createComponentLogger('chat-stream-controller');

function sendEvent(res: Response, eventType: string, data: object) {
    res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
}

function extractBearerToken(req: Request): string | undefined {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader
            .split(',')
            .map((s) => s.trim())
            .find((s) => s.startsWith('Bearer '))
            ?.split(' ')[1];
        if (token) return token;
    }
    const headerToken = req.headers['x-auth-request-access-token'];
    if (typeof headerToken === 'string') return headerToken;
    if (Array.isArray(headerToken)) return headerToken[0];
    return undefined;
}

async function maybeDistill(
    prisma: any,
    chat: any,
    user_id: string,
    requestToken: string | undefined
): Promise<void> {
    const minMessages = parseInt(process.env.DISTILLATION_MIN_MESSAGES || '10', 10);
    const minInterval = parseInt(process.env.DISTILLATION_MIN_INTERVAL_MS || '900000', 10);
    const maxMessages = parseInt(process.env.DISTILLATION_MAX_MESSAGES || '50', 10);

    const totalCount: number = await prisma.message.count({ where: { chat_id: chat.id } });
    const newSinceLast = totalCount - (chat.distilled_message_count ?? 0);
    const lastAt = chat.last_distilled_at ? (chat.last_distilled_at as Date).getTime() : 0;
    const intervalOk = Date.now() - lastAt >= minInterval;

    if (newSinceLast < minMessages || !intervalOk) {
        logger.debug({ chat_id: chat.id, newSinceLast, intervalOk }, 'Distillation threshold not met, skipping');
        return;
    }

    const recentMessages: Array<{ role: string; content: string }> = await prisma.message.findMany({
        where: { chat_id: chat.id },
        orderBy: { created_at: 'desc' },
        take: maxMessages,
        select: { role: true, content: true },
    });
    recentMessages.reverse();

    await prisma.chat.update({
        where: { id: chat.id },
        data: { last_distilled_at: new Date(), distilled_message_count: totalCount },
    });

    logger.info({ chat_id: chat.id, messages_sent: recentMessages.length, newSinceLast }, 'Triggering distillation');

    distillationClient
        .triggerDistillation(
            {
                source: { type: 'chat', id: chat.id },
                context: { messages: recentMessages },
                metadata: { user_id },
                options: { max_memories: 10 },
            },
            requestToken
        )
        .catch((err) => logger.error({ err, chat_id: chat.id }, 'Distillation trigger failed'));
}

export const streamChat = async (req: Request, res: Response) => {
    const { chatId } = req.params;
    const user_id = (req as any).user?.preferred_username;

    if (!user_id) {
        logger.warn({ user: (req as any).user }, 'streamChat: User ID not found in token');
        return res.status(401).json({ error: 'Unauthorized: User ID missing' });
    }

    const { content, model_id } = req.body;
    if (!content) {
        return res.status(400).json({ error: 'content is required' });
    }

    const prisma = (req as any).prisma;

    // Validate chat ownership
    const chat = await prisma.chat.findUnique({ where: { id: chatId } });
    if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
    }
    if (chat.user_id !== user_id) {
        logger.warn({ chat_user_id: chat.user_id, request_user_id: user_id }, 'streamChat: Forbidden access');
        return res.status(403).json({ error: 'Forbidden' });
    }

    // model_id is kept for DB logging; actual model used is resolved from the assignment config
    const model = model_id || process.env.OLLAMA_MODEL || 'qwen3.5:2b';
    const maxHistory = parseInt(process.env.MAX_HISTORY_MESSAGES || '20', 10);

    // Save user message to DB before opening the stream
    let userMessage: any;
    try {
        userMessage = await prisma.message.create({
            data: { role: 'user', content, chat_id: chatId, user_id },
        });
    } catch (err: any) {
        logger.error({ err: err.message, chat_id: chatId }, 'Failed to save user message');
        return res.status(500).json({ error: 'Failed to save message' });
    }

    // Open SSE stream
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // Disable socket timeout for long-lived SSE connections
    req.socket?.setTimeout(0);

    let clientGone = false;
    req.on('close', () => {
        clientGone = true;
        logger.debug({ chat_id: chatId }, 'SSE client disconnected');
    });

    // Notify client of the server-assigned user message ID
    sendEvent(res, 'user_message.created', { message_id: userMessage.id });
    sendEvent(res, 'run.status', { status: 'running' });

    try {
        // Load recent chat history (excluding the message we just saved, most-recent-first then reverse)
        const historyMessages: Array<{ role: string; content: string }> = await prisma.message.findMany({
            where: { chat_id: chatId, id: { not: userMessage.id } },
            orderBy: { created_at: 'desc' },
            take: maxHistory,
            select: { role: true, content: true },
        });
        historyMessages.reverse();

        // Fetch config instructions and retrieve memories in parallel.
        const accessToken = extractBearerToken(req);
        const [configInstructions, memories] = await Promise.all([
            accessToken ? fetchInstructions(accessToken) : Promise.resolve([]),
            memoryClient.isEnabled()
                ? memoryClient.retrieveMemories(content, user_id, accessToken ?? undefined)
                : Promise.resolve([]),
        ]);
        logger.info({ chat_id: chatId, instruction_count: configInstructions.length, memory_count: memories.length }, 'Context loaded');

        const basePrompt =
            process.env.OLLAMA_SYSTEM_PROMPT ||
            'You are a helpful assistant. If you reason before responding, keep it extremely brief — a few short sentences at most. Do not restate the question, list options, or deliberate over phrasings.';
        const instructionPrefix = buildInstructionPrefix(configInstructions, memories);
        const knowledgeSuffix = buildKnowledgeSuffix(memories);
        const noParrotRule = knowledgeSuffix
            ? '\nUse all context sections (KNOWN FACTS, USER PROFILE, NEURALESE_CONTEXT) silently to inform your response. Do NOT quote them back verbatim.'
            : '';
        const systemPrompt = instructionPrefix + basePrompt + knowledgeSuffix + noParrotRule;

        const ollamaMessages = [
            { role: 'system' as const, content: systemPrompt },
            ...(historyMessages as Array<{ role: 'user' | 'assistant'; content: string }>),
            { role: 'user' as const, content },
        ];

        // think: prefer the value sent by the client (UI toggle), fall back to OLLAMA_THINK env var
        const think = req.body.think !== undefined
            ? Boolean(req.body.think)
            : process.env.OLLAMA_THINK !== 'false';

        // Resolve LLM provider from admin assignment config (org → global override chain).
        // Falls back to env-var BoucioClient (internal bouc.io Ollama) if no assignment found.
        const assignmentConfig = accessToken
            ? await fetchAssignmentConfig('chatbot', accessToken)
            : null;
        const chatService = assignmentConfig
            ? new GenericChatLLMService(createLLMClientFromConfig(assignmentConfig))
            : new OllamaChatLLMService();
        // The model actually used — org-specific if an assignment was found, otherwise env default.
        const resolvedModel = assignmentConfig?.model ?? model;

        logger.info(
            {
                chat_id: chatId,
                provider: assignmentConfig
                    ? { provider: assignmentConfig.provider, endpoint: assignmentConfig.api_endpoint }
                    : 'boucio-fallback',
                model: assignmentConfig?.model ?? model,
                history_count: historyMessages.length,
            },
            'Starting LLM stream'
        );
        logger.debug({ chat_id: chatId, messages: ollamaMessages }, 'LLM messages payload');

        let fullResponse = '';
        let promptTokens = 0;
        let completionTokens = 0;
        let savedThinking = '';   // JSON-format thinking only (for <think> DB storage)

        await chatService.streamChat(
            ollamaMessages,
            {
                onToken: (t) => {
                    if (clientGone) return;
                    fullResponse += t;
                    sendEvent(res, 'message.token', { token: t });
                },
                onThinkingToken: (t) => {
                    if (clientGone) return;
                    sendEvent(res, 'message.thinking_token', { token: t });
                },
                onDone: ({ prompt_tokens, completion_tokens, thinking }) => {
                    promptTokens = prompt_tokens;
                    completionTokens = completion_tokens;
                    savedThinking = thinking || '';
                },
            },
            { think }
        );

        if (clientGone) {
            logger.warn({ chat_id: chatId }, 'Client disconnected mid-stream, skipping DB save');
            return;
        }

        // Assemble final content: wrap JSON-format thinking with <think> tags for DB storage.
        // Legacy <think>-tag thinking is streamed to the client but not stored separately.
        const finalContent = savedThinking
            ? `<think>${savedThinking}</think>\n\n${fullResponse}`
            : fullResponse;

        // Save assistant message to DB
        const assistantMessage = await prisma.message.create({
            data: {
                role: 'assistant',
                content: finalContent,
                chat_id: chatId,
                user_id,
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: promptTokens + completionTokens,
                model_id: model,
            },
        });

        logger.info(
            { chat_id: chatId, prompt_tokens: promptTokens, completion_tokens: completionTokens },
            'Assistant message saved'
        );

        sendEvent(res, 'message.created', {
            role: 'assistant',
            content: finalContent,
            message_id: assistantMessage.id,
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: promptTokens + completionTokens,
            model_name: resolvedModel,
        });

        sendEvent(res, 'run.completed', {});
        res.end();

        // Trigger distillation after closing the connection (fire-and-forget)
        if (distillationClient.isEnabled()) {
            const chatForDistill = await prisma.chat.findUnique({ where: { id: chatId } });
            if (chatForDistill) {
                maybeDistill(prisma, chatForDistill, user_id, extractBearerToken(req)).catch((err) =>
                    logger.error({ err }, 'Unexpected error in maybeDistill')
                );
            }
        }
    } catch (error: any) {
        logger.error({
            chat_id: chatId,
            error_message: error.message,
            error_code: error.code,
            error_status: error.response?.status,
            error_data: error.response?.data,
            stack: error.stack,
        }, 'Error in chat stream');
        if (!clientGone) {
            sendEvent(res, 'run.failed', { error: error.message || 'Stream failed' });
            res.end();
        }
    }
};
