import type { NextFunction, Request, Response } from 'express'
import { fromNodeHeaders } from 'better-auth/node'
import { auth } from '../lib/auth'

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const result = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })

  if (!result) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Session is invalid or has expired.' },
    })
  }

  req.user = result.user
  req.session = result.session
  next()
}
