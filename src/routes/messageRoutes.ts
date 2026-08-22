import express from 'express';
import {
  createMessage,
  getMessagesByChatId,
  getMessageById,
  updateMessage,
  deleteMessage,
  submitFeedback,
} from '../controllers/messageController';
import { requireRoles } from '../middleware/auth';
import { AI_APP_ROLES } from '../lib/roles';
import { validate } from '../middleware/validate';
import { createMessageSchema, updateMessageSchema, submitFeedbackSchema } from '../schemas';

const router = express.Router({ mergeParams: true });

router.use(requireRoles(...AI_APP_ROLES));

/**
 * @openapi
 * /v1/chats/{id}/messages:
 *   get:
 *     summary: List messages in a chat
 *     tags: [Messages]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       '200': { description: Message list }
 *   post:
 *     summary: Post a message to a chat (triggers an assistant reply)
 *     tags: [Messages]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string }
 *     responses:
 *       '201': { description: Message created }
 *       '400': { description: Validation error }
 */
router.post('/', validate(createMessageSchema), createMessage);
router.get('/', getMessagesByChatId);
router.get('/:messageId', getMessageById);
router.patch('/:messageId', validate(updateMessageSchema), updateMessage);
router.delete('/:messageId', deleteMessage);
router.post('/:messageId/feedback', validate(submitFeedbackSchema), submitFeedback);

export default router;
