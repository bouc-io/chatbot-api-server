import { z } from "zod";

/**
 * Request body schemas for chatbot-api-server mutating routes.
 * Objects use .passthrough() so unknown keys are preserved while known fields
 * are type-checked. Apply with the validate() middleware.
 */

const metadata = z.record(z.string(), z.unknown());

export const createChatSchema = z
  .object({
    title: z.string().optional(),
    model_id: z.string().optional(),
    summary: z.string().optional(),
  })
  .passthrough();

export const updateChatSchema = z
  .object({ title: z.string().optional(), summary: z.string().optional() })
  .passthrough();

export const streamChatSchema = z
  .object({
    content: z.string().min(1, "content is required"),
    model_id: z.string().optional(),
    think: z.unknown().optional(),
  })
  .passthrough();

export const createMessageSchema = z
  .object({
    role: z.string().min(1, "role is required"),
    content: z.string().min(1, "content is required"),
    metadata: metadata.optional(),
    prompt_tokens: z.number().int().optional(),
    completion_tokens: z.number().int().optional(),
    total_tokens: z.number().int().optional(),
  })
  .passthrough();

export const updateMessageSchema = z
  .object({ content: z.string().min(1, "content is required") })
  .passthrough();

export const submitFeedbackSchema = z
  .object({
    rating: z.string().min(1, "rating is required"),
    comment: z.string().optional(),
  })
  .passthrough();
