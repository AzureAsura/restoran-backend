import { Router } from 'express'
import multer from 'multer'
import { requireRole } from '../../middlewares/require-role'
import { AppError } from '../../utils/app-error'
import { deleteMenuItemHandler, getAdminMenu, getMenu, patchMenuItem, postMenuItem } from './menu.controller'
import { deleteCategoryHandler, getCategories, patchCategory, postCategory } from './menu-category.controller'

export const menuRouter = Router()

menuRouter.get('/', getMenu)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new AppError(400, 'INVALID_FILE', 'File must be an image.'))
    }
    cb(null, true)
  },
})

export const adminMenuRouter = Router()

adminMenuRouter.get('/', requireRole('owner', 'cashier'), getAdminMenu)
adminMenuRouter.post('/', requireRole('owner'), upload.single('image'), postMenuItem)
adminMenuRouter.patch('/:id', requireRole('owner'), upload.single('image'), patchMenuItem)
adminMenuRouter.delete('/:id', requireRole('owner'), deleteMenuItemHandler)

export const adminMenuCategoryRouter = Router()

adminMenuCategoryRouter.get('/', requireRole('owner', 'cashier'), getCategories)
adminMenuCategoryRouter.post('/', requireRole('owner'), upload.single('image'), postCategory)
adminMenuCategoryRouter.patch('/:id', requireRole('owner'), upload.single('image'), patchCategory)
adminMenuCategoryRouter.delete('/:id', requireRole('owner'), deleteCategoryHandler)
