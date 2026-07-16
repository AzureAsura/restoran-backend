import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { prisma } from './prisma'
import { env } from '../config/env'

export const auth = betterAuth({
  baseURL: env.betterAuthUrl,
  secret: env.betterAuthSecret,
  trustedOrigins: [env.frontendOrigin],
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    // Staff accounts are provisioned manually (owner provisions cashier/kitchen
    // accounts), not via public self-registration — see backend.md FR-AUTH-02.
    disableSignUp: true,
  },
  user: {
    additionalFields: {
      role: { type: 'string', required: true, input: false, defaultValue: 'cashier' },
      isActive: { type: 'boolean', required: false, input: false, defaultValue: true },
    },
  },
  advanced: {
    // Production: FE & BE are on separate domains (see backend.md NFR-SEC-07),
    // so the session cookie needs SameSite=None + Secure to be sent
    // cross-origin at all (better-auth defaults to SameSite=Lax otherwise).
    // Left untouched in dev — forcing None/Secure over plain http://localhost
    // would make the browser reject the cookie outright (SameSite=None
    // requires Secure, and Secure requires HTTPS), breaking local login.
    defaultCookieAttributes: env.nodeEnv === 'production' ? { sameSite: 'none', secure: true } : {},
  },
})
