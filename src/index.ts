import { app } from './app'
import { env } from './config/env'
import { startNoShowCron } from './jobs/no-show-cron'

startNoShowCron()

app.listen(env.port, () => {
  console.log(`Backend listening on port ${env.port}`)
})
