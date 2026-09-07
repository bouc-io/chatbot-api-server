import { Request, Response } from "express";
import { createComponentLogger } from "../lib/logger";

const logger = createComponentLogger("usage-controller");

/**
 * Get token usage totals for the authenticated user across all chats
 * GET /v1/usage
 */
export const getUserUsage = async (req: Request, res: Response) => {
  const user_id = (req as any).user?.preferred_username;

  if (!user_id) {
    logger.warn(
      { user: (req as any).user },
      "getUserUsage: User ID not found in token",
    );
    return res.status(401).json({ error: "Unauthorized: User ID missing" });
  }

  try {
    const [totals, perChat] = await Promise.all([
      (req as any).prisma.message.aggregate({
        where: { user_id, role: "assistant" },
        _sum: {
          prompt_tokens: true,
          completion_tokens: true,
          total_tokens: true,
        },
        _count: { id: true },
      }),
      (req as any).prisma.message.groupBy({
        by: ["chat_id"],
        where: { user_id, role: "assistant" },
        _sum: {
          prompt_tokens: true,
          completion_tokens: true,
          total_tokens: true,
        },
        _count: { id: true },
        orderBy: { _sum: { total_tokens: "desc" } },
      }),
    ]);

    res.json({
      totals: {
        prompt_tokens: totals._sum.prompt_tokens ?? 0,
        completion_tokens: totals._sum.completion_tokens ?? 0,
        total_tokens: totals._sum.total_tokens ?? 0,
        assistant_messages: totals._count.id,
      },
      by_chat: perChat.map((row: any) => ({
        chat_id: row.chat_id,
        prompt_tokens: row._sum.prompt_tokens ?? 0,
        completion_tokens: row._sum.completion_tokens ?? 0,
        total_tokens: row._sum.total_tokens ?? 0,
        assistant_messages: row._count.id,
      })),
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error fetching user usage",
    );
    res.status(500).json({ error: "Failed to fetch usage" });
  }
};

/**
 * Get token usage totals for a specific chat
 * GET /v1/chats/:chatId/usage
 */
export const getChatUsage = async (req: Request, res: Response) => {
  const { chatId } = req.params;
  const user_id = (req as any).user?.preferred_username;

  if (!user_id) {
    logger.warn(
      { user: (req as any).user },
      "getChatUsage: User ID not found in token",
    );
    return res.status(401).json({ error: "Unauthorized: User ID missing" });
  }

  try {
    // Verify chat belongs to user
    const chat = await (req as any).prisma.chat.findUnique({
      where: { id: chatId },
    });
    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }
    if (chat.user_id !== user_id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const [totals, messages] = await Promise.all([
      (req as any).prisma.message.aggregate({
        where: { chat_id: chatId, role: "assistant" },
        _sum: {
          prompt_tokens: true,
          completion_tokens: true,
          total_tokens: true,
        },
        _count: { id: true },
      }),
      (req as any).prisma.message.findMany({
        where: { chat_id: chatId, role: "assistant" },
        select: {
          id: true,
          content: true,
          prompt_tokens: true,
          completion_tokens: true,
          total_tokens: true,
          created_at: true,
        },
        orderBy: { created_at: "asc" },
      }),
    ]);

    res.json({
      chat_id: chatId,
      totals: {
        prompt_tokens: totals._sum.prompt_tokens ?? 0,
        completion_tokens: totals._sum.completion_tokens ?? 0,
        total_tokens: totals._sum.total_tokens ?? 0,
        assistant_messages: totals._count.id,
      },
      messages: messages.map((m: any) => ({
        id: m.id,
        prompt_tokens: m.prompt_tokens ?? 0,
        completion_tokens: m.completion_tokens ?? 0,
        total_tokens: m.total_tokens ?? 0,
        created_at: m.created_at,
      })),
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error fetching chat usage",
    );
    res.status(500).json({ error: "Failed to fetch usage" });
  }
};
