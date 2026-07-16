import type { auth } from '../lib/auth'

type AuthSession = typeof auth.$Infer.Session

declare global {
  namespace Express {
    interface Request {
      user?: AuthSession['user']
      session?: AuthSession['session']
    }
  }
}

export {}
