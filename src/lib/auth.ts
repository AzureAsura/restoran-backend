import { prisma } from './prisma'
import { env } from '../config/env'

// better-auth ships ESM-only (no `require`-able build). This project compiles
// to CommonJS, and Vercel's serverless Node loader can't require() an ESM
// module — so it's loaded via dynamic import() instead, and the built
// instance is memoized so it's only constructed once per warm function.
async function buildAuth() {
  const { betterAuth } = await import('better-auth')
  const { prismaAdapter } = await import('better-auth/adapters/prisma')

  return betterAuth({
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
    session: {
      // Admin dashboard was hitting Neon 3x per navigation (proxy middleware +
      // layout prefetch + requireAuth all call getSession independently, none
      // cached). This signs a session snapshot into a short-lived cookie so
      // getSession verifies locally instead of round-tripping the DB every
      // time — DB is only re-hit once maxAge expires.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
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
}

export type Auth = Awaited<ReturnType<typeof buildAuth>>

let authPromise: Promise<Auth> | undefined

export function getAuth(): Promise<Auth> {
  if (!authPromise) authPromise = buildAuth()
  return authPromise
}
