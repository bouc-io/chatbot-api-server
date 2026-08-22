import { Request, Response } from 'express';
import { createComponentLogger } from '../lib/logger';
import { distillationClient } from '../services/distillationClient';

const logger = createComponentLogger('message-controller');

/**
 * Extract the raw Bearer token string from the request headers,
 * mirroring the same logic used in auth.ts.
 */
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

/**
 * Check thresholds and, if met, update Chat tracking fields and fire distillation.
 * Extracted so it runs fully after the HTTP response is sent.
 */
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
    logger.debug(
      { chat_id: chat.id, newSinceLast, minMessages, intervalOk },
      'Distillation threshold not met, skipping'
    );
    return;
  }

  // Fetch recent messages for the payload (oldest-first)
  const recentMessages: Array<{ role: string; content: string }> = await prisma.message.findMany({
    where: { chat_id: chat.id },
    orderBy: { created_at: 'desc' },
    take: maxMessages,
    select: { role: true, content: true },
  });
  recentMessages.reverse();

  // Optimistically update tracking fields before firing
  await prisma.chat.update({
    where: { id: chat.id },
    data: { last_distilled_at: new Date(), distilled_message_count: totalCount },
  });

  logger.info(
    { chat_id: chat.id, messages_sent: recentMessages.length, newSinceLast },
    'Triggering distillation'
  );

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

export const createMessage = async (req: Request, res: Response) => {
  try {
    const { id: chat_id } = req.params;
    const { role, content, metadata, prompt_tokens, completion_tokens, total_tokens } = req.body;
    const user_id = (req as any).user?.preferred_username;

    if (!user_id) {
      logger.warn({ user: (req as any).user }, 'createMessage: User ID not found in token');
      return res.status(401).json({ error: 'Unauthorized: User ID missing' });
    }

    if (!role || !content) {
      return res.status(400).json({ error: 'Role and content are required' });
    }

    // Check if chat exists and belongs to user
    const chat = await (req as any).prisma.chat.findUnique({ where: { id: chat_id } });
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    if (chat.user_id !== user_id) {
      logger.warn({ chat_user_id: chat.user_id, request_user_id: user_id }, 'createMessage: Forbidden access');
      return res.status(403).json({ error: 'Forbidden' });
    }

    const message = await (req as any).prisma.message.create({
      data: {
        role,
        content,
        chat_id,
        user_id,
        metadata,
        prompt_tokens:     prompt_tokens     ?? 0,
        completion_tokens: completion_tokens ?? 0,
        total_tokens:      total_tokens      ?? 0,
      },
    });

    res.status(201).json(message);

    // Trigger distillation after assistant messages, fire-and-forget
    if (role === 'assistant' && distillationClient.isEnabled()) {
      maybeDistill((req as any).prisma, chat, user_id, extractBearerToken(req)).catch((err) =>
        logger.error({ err }, 'Unexpected error in maybeDistill')
      );
    }
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error creating message');
    res.status(500).json({ error: 'Failed to create message' });
  }
};

export const getMessagesByChatId = async (req: Request, res: Response) => {
  try {
    const { id: chat_id } = req.params;
    const user_id = (req as any).user?.preferred_username;

    if (!user_id) {
      logger.warn({ user: (req as any).user }, 'getMessagesByChatId: User ID not found in token');
      return res.status(401).json({ error: 'Unauthorized: User ID missing' });
    }

    // Check chat ownership first
    const chat = await (req as any).prisma.chat.findUnique({ where: { id: chat_id } });
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    if (chat.user_id !== user_id) {
      logger.warn({ chat_user_id: chat.user_id, request_user_id: user_id }, 'getMessagesByChatId: Forbidden access');
      return res.status(403).json({ error: 'Forbidden' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      (req as any).prisma.message.findMany({
        where: { chat_id },
        skip,
        take: limit,
        orderBy: { created_at: 'asc' },
        include: { feedback: true },
      }),
      (req as any).prisma.message.count({ where: { chat_id } }),
    ]);

    res.json({
      data: messages,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error fetching messages');
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
};

export const getMessageById = async (req: Request, res: Response) => {
  try {
    const { messageId } = req.params;
    const user_id = (req as any).user?.preferred_username;

    if (!user_id) {
      logger.warn({ user: (req as any).user }, 'getMessageById: User ID not found in token');
      return res.status(401).json({ error: 'Unauthorized: User ID missing' });
    }

    const message = await (req as any).prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (message.user_id !== user_id) {
      logger.warn({ message_user_id: message.user_id, request_user_id: user_id }, 'getMessageById: Forbidden access');
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(message);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error fetching message');
    res.status(500).json({ error: 'Failed to fetch message' });
  }
};

export const updateMessage = async (req: Request, res: Response) => {
  try {
    const { messageId } = req.params;
    const { content } = req.body;
    const user_id = (req as any).user?.preferred_username;

    if (!user_id) {
      logger.warn({ user: (req as any).user }, 'updateMessage: User ID not found in token');
      return res.status(401).json({ error: 'Unauthorized: User ID missing' });
    }

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const existingMessage = await (req as any).prisma.message.findUnique({
        where: { id: messageId },
    });

    if (!existingMessage) {
        return res.status(404).json({ error: 'Message not found' });
    }

    if (existingMessage.user_id !== user_id) {
        logger.warn({ message_user_id: existingMessage.user_id, request_user_id: user_id }, 'updateMessage: Forbidden access');
        return res.status(403).json({ error: 'Forbidden' });
    }

    const message = await (req as any).prisma.message.update({
      where: { id: messageId },
      data: { content },
    });

    res.json(message);
  } catch (error: any) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error updating message');
    res.status(500).json({ error: 'Failed to update message' });
  }
};

export const submitFeedback = async (req: Request, res: Response) => {
  try {
    const user_id = (req as any).user?.preferred_username;
    if (!user_id) {
      logger.warn({ user: (req as any).user }, 'submitFeedback: User ID not found in token');
      return res.status(401).json({ error: 'Unauthorized: User ID missing' });
    }

    const { id: chat_id, messageId } = req.params;
    const { rating, comment } = req.body as { rating: string; comment?: string };

    if (!rating || !['positive', 'negative'].includes(rating)) {
      return res.status(400).json({ error: "rating must be 'positive' or 'negative'" });
    }

    const message = await (req as any).prisma.message.findFirst({
      where: { id: messageId, chat_id, user_id },
      select: { id: true },
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    await (req as any).prisma.messageFeedback.upsert({
      where: { message_id: messageId },
      create: { message_id: messageId, rating, comment: comment ?? null },
      update: { rating, comment: comment ?? null },
    });

    logger.info({ messageId, rating }, 'Feedback submitted');
    res.status(204).send();
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error submitting feedback');
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
};

export const deleteMessage = async (req: Request, res: Response) => {
  try {
    const { messageId } = req.params;
    const user_id = (req as any).user?.preferred_username;

    if (!user_id) {
      logger.warn({ user: (req as any).user }, 'deleteMessage: User ID not found in token');
      return res.status(401).json({ error: 'Unauthorized: User ID missing' });
    }

    const existingMessage = await (req as any).prisma.message.findUnique({
        where: { id: messageId },
    });

    if (!existingMessage) {
        return res.status(404).json({ error: 'Message not found' });
    }

    if (existingMessage.user_id !== user_id) {
        logger.warn({ message_user_id: existingMessage.user_id, request_user_id: user_id }, 'deleteMessage: Forbidden access');
        return res.status(403).json({ error: 'Forbidden' });
    }

    await (req as any).prisma.message.delete({
      where: { id: messageId },
    });

    res.status(204).send();
  } catch (error: any) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Error deleting message');
    res.status(500).json({ error: 'Failed to delete message' });
  }
};