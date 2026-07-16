import { Router } from 'express'
import { noStore } from '../../middlewares/no-store'
import { requireRole } from '../../middlewares/require-role'
import { getKitchenQueue, getOrderItemDetailHandler, patchOrderItemStatus } from './kitchen.controller'

export const kitchenRouter = Router()

kitchenRouter.get('/kitchen-queue', requireRole('owner', 'kitchen'), noStore, getKitchenQueue)
kitchenRouter.get('/order-items/:id', requireRole('owner', 'kitchen'), getOrderItemDetailHandler)
kitchenRouter.patch('/order-items/:id', requireRole('owner', 'kitchen'), patchOrderItemStatus)
