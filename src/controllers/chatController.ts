import { Request, Response } from "express";
import { createComponentLogger } from "../lib/logger";

const logger = createComponentLogger("chat-controller");

export const createChat = async (req: Request, res: Response) => {
  try {
    const { title, model_id, summary } = req.body;
    const user_id = (req as any).user?.preferred_username;
    const org_id: string | null = (req as any).user?.org_id ?? null;

    if (!user_id) {
      logger.warn(
        { user: (req as any).user },
        "createChat: User ID not found in token",
      );
      return res.status(401).json({ error: "Unauthorized: User ID missing" });
    }

    if (!title || !model_id) {
      return res.status(400).json({ error: "Title and model_id are required" });
    }

    const chat = await (req as any).prisma.chat.create({
      data: {
        title,
        user_id,
        org_id,
        model_id,
        summary,
      },
    });

    res.status(201).json(chat);
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error creating chat",
    );
    res.status(500).json({ error: "Failed to create chat" });
  }
};

export const getChats = async (req: Request, res: Response) => {
  try {
    const user_id = (req as any).user?.preferred_username;
    const org_id: string | null = (req as any).user?.org_id ?? null;
    if (!user_id) {
      logger.warn(
        { user: (req as any).user },
        "getChats: User ID not found in token",
      );
      return res.status(401).json({ error: "Unauthorized: User ID missing" });
    }

    const page = parseInt(req.query.page as string) || 1;
    let limit = parseInt(req.query.limit as string) || 20;
    if (limit > 100) limit = 100; // Cap limit

    const allowedSorts = ["created_at", "updated_at", "title"];
    let sort = (req.query.sort as string) || "updated_at";
    if (!allowedSorts.includes(sort)) {
      sort = "updated_at";
    }

    const order = (req.query.order as string) === "asc" ? "asc" : "desc";
    const skip = (page - 1) * limit;

    const where = {
      user_id,
      ...(org_id && { org_id }),
    };

    const [chats, total] = await Promise.all([
      (req as any).prisma.chat.findMany({
        where,
        orderBy: { [sort]: order },
        skip,
        take: limit,
      }),
      (req as any).prisma.chat.count({ where }),
    ]);

    res.json({
      data: chats,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error fetching chats",
    );
    res.status(500).json({ error: "Failed to fetch chats" });
  }
};

export const getChatById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = (req as any).user?.preferred_username;

    if (!user_id) {
      logger.warn(
        { user: (req as any).user },
        "getChatById: User ID not found in token",
      );
      return res.status(401).json({ error: "Unauthorized: User ID missing" });
    }

    const chat = await (req as any).prisma.chat.findUnique({
      where: { id },
    });

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    if (chat.user_id !== user_id) {
      logger.warn(
        { chat_user_id: chat.user_id, request_user_id: user_id },
        "getChatById: Forbidden access",
      );
      return res.status(403).json({ error: "Forbidden" });
    }

    res.json(chat);
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error fetching chat",
    );
    res.status(500).json({ error: "Failed to fetch chat" });
  }
};

export const updateChat = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, summary } = req.body;
    const user_id = (req as any).user?.preferred_username;

    if (!user_id) {
      logger.warn(
        { user: (req as any).user },
        "updateChat: User ID not found in token",
      );
      return res.status(401).json({ error: "Unauthorized: User ID missing" });
    }

    // Check ownership before updating
    const existingChat = await (req as any).prisma.chat.findUnique({
      where: { id },
    });

    if (!existingChat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    if (existingChat.user_id !== user_id) {
      logger.warn(
        { chat_user_id: existingChat.user_id, request_user_id: user_id },
        "updateChat: Forbidden access",
      );
      return res.status(403).json({ error: "Forbidden" });
    }

    const chat = await (req as any).prisma.chat.update({
      where: { id },
      data: { title, summary },
    });

    res.json(chat);
  } catch (error: any) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error updating chat",
    );
    res.status(500).json({ error: "Failed to update chat" });
  }
};

export const deleteChat = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user_id = (req as any).user?.preferred_username;

    if (!user_id) {
      logger.warn(
        { user: (req as any).user },
        "deleteChat: User ID not found in token",
      );
      return res.status(401).json({ error: "Unauthorized: User ID missing" });
    }

    const chat = await (req as any).prisma.chat.findUnique({
      where: { id },
    });

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    if (chat.user_id !== user_id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await (req as any).prisma.chat.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error: any) {
    if (error.code === "P2025") {
      return res.status(404).json({ error: "Chat not found" });
    }
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Error deleting chat",
    );
    res.status(500).json({ error: "Failed to delete chat" });
  }
};
