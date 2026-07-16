import { app } from '../src/app'

// Vercel serverless entry. The Express app is the request handler.
// node-cron is intentionally NOT started here — serverless processes are
// frozen between invocations, so the no-show job runs via Vercel Cron
// hitting POST /internal/cron/no-show (see vercel.json) instead.
export default app
