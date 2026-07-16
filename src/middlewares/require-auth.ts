import type { NextFunction, Request, Response } from 'express'
import { getAuth } from '../lib/auth'

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const { fromNodeHeaders } = await import('better-auth/node')
  const auth = await getAuth()
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
