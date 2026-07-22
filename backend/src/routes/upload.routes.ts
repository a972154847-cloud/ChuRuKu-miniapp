import { Router, Request, Response } from 'express'
import {
  upload,
  validateImageSize,
  buildFileUrl,
  createThumbnail,
} from '../services/upload.service'
import authRequired from '../middlewares/auth'
import { requireViewer } from '../middlewares/role'

const router = Router()

router.use(authRequired)

/**
 * POST / 单文件上传（editor 及以上）
 * 字段名：file
 */
router.post(
  '/',
  requireViewer,
  upload.single('file'),
  validateImageSize,
  async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ code: 400, message: '未提供文件' })
      return
    }
    const thumbnailUrl = await createThumbnail(req.file)
    res.json({
      code: 0,
      message: 'ok',
      data: {
        url: buildFileUrl(req.file.filename),
        filename: req.file.filename,
        size: req.file.size,
        mimeType: req.file.mimetype,
        thumbnailUrl,
      },
    })
  },
)

/**
 * POST /multiple 多文件上传（editor 及以上，最多 5 个）
 * 字段名：files
 */
router.post(
  '/multiple',
  requireViewer,
  upload.array('files', 5),
  validateImageSize,
  async (req: Request, res: Response) => {
    const files = req.files as Express.Multer.File[]
    if (!files || files.length === 0) {
      res.status(400).json({ code: 400, message: '未提供文件' })
      return
    }
    const list = await Promise.all(
      files.map(async (f) => ({
        url: buildFileUrl(f.filename),
        filename: f.filename,
        size: f.size,
        mimeType: f.mimetype,
        thumbnailUrl: await createThumbnail(f),
      })),
    )
    res.json({
      code: 0,
      message: 'ok',
      data: {
        list,
      },
    })
  },
)

export default router
