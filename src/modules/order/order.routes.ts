import { Router } from 'express'
import { noStore } from '../../middlewares/no-store'
import { requireRole } from '../../middlewares/require-role'
import { getOrderBillHandler, getOrders, patchOrderPaymentStatus, postOrder } from './order.controller'

export const orderRouter = Router()

orderRouter.get('/', requireRole('owner', 'cashier'), noStore, getOrders)
orderRouter.post('/', requireRole('owner', 'cashier'), postOrder)
orderRouter.get('/:id/bill', requireRole('owner', 'cashier'), getOrderBillHandler)
orderRouter.patch('/:id', requireRole('owner', 'cashier'), patchOrderPaymentStatus)
