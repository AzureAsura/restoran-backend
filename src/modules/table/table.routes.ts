import { Router } from 'express'
import { requireRole } from '../../middlewares/require-role'
import { closeTableHandler, deleteTableHandler, getTables, patchTable, postTable } from './table.controller'

export const tableRouter = Router()

tableRouter.get('/', requireRole('owner', 'cashier'), getTables)
tableRouter.post('/', requireRole('owner'), postTable)
tableRouter.patch('/:id', requireRole('owner'), patchTable)
// Cashier-reachable: closes out all paid active orders at this table and
// frees it. Deliberately separate from the owner-only PATCH above (which
// edits table name/area/capacity) so cashier gets exactly this one action.
tableRouter.post('/:id/close', requireRole('owner', 'cashier'), closeTableHandler)
tableRouter.delete('/:id', requireRole('owner'), deleteTableHandler)
