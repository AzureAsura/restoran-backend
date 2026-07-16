import { schedule } from 'node-cron'
import { flagOverdueBookingsAsNoShow } from '../modules/booking/booking.service'

export function startNoShowCron() {
  schedule('*/15 * * * *', async () => {
    const { flagged } = await flagOverdueBookingsAsNoShow()
    if (flagged > 0) {
      console.log(`[no-show-cron] Flagged ${flagged} booking(s) as no_show.`)
    }
  })
}
