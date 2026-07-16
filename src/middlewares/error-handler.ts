import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../utils/app-error'

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, error: { code: err.code, message: err.message } })
  }

  console.error(err)
  const message = err instanceof Error ? err.message : 'Internal server error'
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } })
}
