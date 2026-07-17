import 'dotenv/config'

export const env = {
  port: process.env.PORT ?? '4000',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
  betterAuthSecret: process.env.BETTER_AUTH_SECRET ?? '',
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:4000',
  cronSecret: process.env.CRON_SECRET ?? '',
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
}
