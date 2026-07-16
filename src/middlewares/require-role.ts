import type { NextFunction, Request, Response } from 'express'

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.user?.role

    if (!role || !roles.includes(role)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You do not have access to perform this action.' },
      })
    }

    next()
  }
}
