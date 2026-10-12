import { Router } from "express";
import { streamChat } from "../controllers/chatStreamController";
import { requireRoles } from "../middleware/auth";
import { AI_APP_ROLES } from "../lib/roles";
import { validate } from "../middleware/validate";
import { streamChatSchema } from "../schemas";

// mergeParams: true exposes :chatId from the parent app.use() mount point
const router = Router({ mergeParams: true });

router.use(requireRoles(...AI_APP_ROLES));

router.post("/", validate(streamChatSchema), streamChat);

export default router;
