import { Router } from 'express'
import { postChatMessage } from './ai.controller'

export const aiRouter = Router()

aiRouter.post('/chat', postChatMessage)
