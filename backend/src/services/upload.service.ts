import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { config } from '../config'

// 确保上传目录存在（模块加载时执行）
fs.mkdirSync(config.uploadDir, { recursive: true })
const thumbnailDir = path.join(config.uploadDir, 'thumbs')
fs.mkdirSync(thumbnailDir, { recursive: true })

// P0-5: mimetype 白名单 + 扩展名白名单双重校验，防 mimetype 伪造
const ALLOWED_MIME = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  video: ['video/mp4'],
}

// 扩展名白名单（小写，含点号）；与 ALLOWED_MIME 对应
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4']

// mimetype 到扩展名的映射：文件名根据 mimetype 重命名，不保留原扩展名（防伪造）
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_VIDEO_SIZE = 10 * 1024 * 1024 // 10MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    // P0-5: 文件名扩展名强制根据 mimetype 映射，不保留原扩展名（防伪造）
    const ext = MIME_TO_EXT[file.mimetype]
    if (!ext) {
      cb(new Error('不支持的文件类型：' + file.mimetype), '')
      return
    }
    cb(null, `${randomUUID()}.${ext}`)
  },
})

function fileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile?: boolean) => void,
) {
  const all = [...ALLOWED_MIME.image, ...ALLOWED_MIME.video]
  // P0-5: mimetype 校验
  if (!all.includes(file.mimetype)) {
    cb(new Error('不支持的文件类型：' + file.mimetype))
    return
  }
  // P0-5: 扩展名校验（防 mimetype 伪造：攻击者可伪造 Content-Type 但难伪造扩展名白名单）
  const ext = path.extname(file.originalname).toLowerCase()
  if (!ALLOWED_EXT.includes(ext)) {
    cb(new Error('不支持的文件扩展名：' + ext))
    return
  }
  cb(null, true)
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_VIDEO_SIZE },
})

/**
 * 中间件：图片大小校验
 * multer 全局上限 10MB，这里对图片额外限制 5MB
 */
export function validateImageSize(req: any, res: any, next: any) {
  const files: Express.Multer.File[] = req.file ? [req.file] : req.files || []
  for (const f of files) {
    if (ALLOWED_MIME.image.includes(f.mimetype) && f.size > MAX_IMAGE_SIZE) {
      res.status(400).json({ code: 400, message: `图片大小不能超过 5MB：${f.originalname}` })
      return
    }
  }
  next()
}

export function buildFileUrl(filename: string): string {
  return `/uploads/${filename}`
}

function getThumbnailFilename(filename: string): string {
  return `${path.parse(filename).name}.webp`
}

export function buildThumbnailUrl(filename: string): string {
  return `/uploads/thumbs/${getThumbnailFilename(filename)}`
}

/**
 * 上传原图保留用于预览；缩略图只用于列表和详情页的首次展示。
 * 解码失败不影响上传，调用方会回退到原图。
 */
export async function createThumbnail(file: Express.Multer.File): Promise<string | null> {
  if (!ALLOWED_MIME.image.includes(file.mimetype)) {
    return null
  }

  const outputPath = path.join(thumbnailDir, getThumbnailFilename(file.filename))
  try {
    await sharp(file.path, { animated: false })
      .rotate()
      .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toFile(outputPath)
    return buildThumbnailUrl(file.filename)
  } catch (error) {
    console.warn(
      `[upload] thumbnail generation failed for ${file.filename}:`,
      (error as Error).message,
    )
    return null
  }
}

/** 仅对已生成的本地缩略图返回 URL，历史图片未批处理前不会出现 404。 */
export function getThumbnailUrlIfExists(url: string, kind: string): string | null {
  if (kind === 'video' || !url.startsWith('/uploads/')) {
    return null
  }
  const filename = path.posix.basename(url)
  if (
    !filename ||
    url !== buildFileUrl(filename) ||
    !/^[a-zA-Z0-9-]+\.(jpe?g|png|gif|webp)$/i.test(filename)
  ) {
    return null
  }
  const thumbnailPath = path.join(thumbnailDir, getThumbnailFilename(filename))
  return fs.existsSync(thumbnailPath) ? buildThumbnailUrl(filename) : null
}

export const PHOTO_LIMIT = 3
export const VIDEO_LIMIT = 1

export default {
  upload,
  validateImageSize,
  buildFileUrl,
  buildThumbnailUrl,
  createThumbnail,
  getThumbnailUrlIfExists,
  PHOTO_LIMIT,
  VIDEO_LIMIT,
}
