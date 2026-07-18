import type { Request, Response } from 'express'
import { chatMessageSchema } from './ai.schema'
import { handleChatMessage } from './ai.service'

export async function postChatMessage(req: Request, res: Response) {
  const parsed = chatMessageSchema.safeParse(req.body)

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
    })
  }

  const data = await handleChatMessage(parsed.data)
  res.json({ success: true, data })
}
