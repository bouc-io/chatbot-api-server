import express, { Request, Response } from 'express';
import {
  createChat,
  getChats,
  getChatById,
  updateChat,
  deleteChat,
} from '../controllers/chatController';
import { requireRoles } from '../middleware/auth';
import { AI_APP_ROLES } from '../lib/roles';
import { validate } from '../middleware/validate';
import { createChatSchema, updateChatSchema } from '../schemas';

const router = express.Router();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string; name: string };

// /health is unguarded (k8s probe / UI version check)
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    version: pkg.version,
    name: pkg.name,
    model_name: process.env.OLLAMA_MODEL || 'unknown',
  });
});

router.use(requireRoles(...AI_APP_ROLES));

/**
 * @openapi
 * /v1/chats:
 *   get:
 *     summary: List the current user's chat sessions
 *     tags: [Chats]
 *     responses:
 *       '200': { description: Chat list }
 *       '403': { description: Forbidden }
 *   post:
 *     summary: Create a chat session
 *     tags: [Chats]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *     responses:
 *       '201': { description: Chat created }
 *       '400': { description: Validation error }
 */
router.post('/', validate(createChatSchema), createChat);
router.get('/', getChats);

/**
 * @openapi
 * /v1/chats/{id}:
 *   get:
 *     summary: Get a chat session by id
 *     tags: [Chats]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200': { description: Chat record }
 *       '404': { description: Not found }
 *   patch:
 *     summary: Update a chat session
 *     tags: [Chats]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200': { description: Chat updated }
 *   delete:
 *     summary: Delete a chat session
 *     tags: [Chats]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '204': { description: Chat deleted }
 */
router.get('/:id', getChatById);
router.patch('/:id', validate(updateChatSchema), updateChat);
router.delete('/:id', deleteChat);

export default router;
