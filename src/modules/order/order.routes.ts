import { Router } from 'express'
import { noStore } from '../../middlewares/no-store'
import { requireRole } from '../../middlewares/require-role'
import {
  getOrderBillHandler,
  getOrders,
  patchOrderPaymentStatus,
  postOrder,
  postPayOrdersBatch,
} from './order.controller'

export const orderRouter = Router()

orderRouter.get('/', requireRole('owner', 'cashier'), noStore, getOrders)
orderRouter.post('/', requireRole('owner', 'cashier'), postOrder)
orderRouter.post('/pay-batch', requireRole('owner', 'cashier'), postPayOrdersBatch)
orderRouter.get('/:id/bill', requireRole('owner', 'cashier'), getOrderBillHandler)
orderRouter.patch('/:id', requireRole('owner', 'cashier'), patchOrderPaymentStatus)
