import type { Auth } from '../lib/auth'

type AuthSession = Auth['$Infer']['Session']

declare global {
  namespace Express {
    interface Request {
      user?: AuthSession['user']
      session?: AuthSession['session']
    }
  }
}

export {}
