import express from 'express';
import { getUserUsage } from '../controllers/usageController';
import { requireRoles } from '../middleware/auth';

const router = express.Router();

// Any authenticated user may view their own usage
router.use(requireRoles());

/**
 * @openapi
 * /v1/usage:
 *   get:
 *     summary: Get the current user's aggregate usage
 *     tags: [Usage]
 *     responses:
 *       '200': { description: Usage summary }
 *       '403': { description: Forbidden }
 */
router.get('/', getUserUsage);

export default router;
