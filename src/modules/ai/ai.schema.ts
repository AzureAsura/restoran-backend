import { z } from 'zod'

const phoneRegex = /^08\d{8,11}$/

export const chatHistoryTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1),
})

export const chatMessageSchema = z.object({
  message: z.string().trim().min(1, 'Message is required.').max(1000, 'Message must be 1000 characters or fewer.'),
  customer_phone: z
    .string()
    .trim()
    .regex(phoneRegex, 'Phone number must be in Indonesian format (e.g. 081234567890).')
    .optional(),
  session_id: z.uuid('Invalid session ID.').optional(),
  history: z.array(chatHistoryTurnSchema).max(20, 'History is limited to 20 turns.').optional(),
})

export type ChatMessageInput = z.infer<typeof chatMessageSchema>
