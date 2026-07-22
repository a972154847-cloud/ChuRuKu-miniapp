import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import db from '../src/db'
import { config } from '../src/config'

const thumbnailDir = path.join(config.uploadDir, 'thumbs')
fs.mkdirSync(thumbnailDir, { recursive: true })

type PhotoRow = { url: string; kind: string }

async function main() {
  const photos = db
    .prepare("SELECT url, kind FROM record_photos WHERE kind <> 'video' ORDER BY id ASC")
    .all() as PhotoRow[]
  const uniqueUrls = Array.from(new Set(photos.map((photo) => photo.url)))
  let created = 0
  let skipped = 0
  let failed = 0

  for (const url of uniqueUrls) {
    if (!url.startsWith('/uploads/')) {
      skipped++
      continue
    }
    const filename = path.posix.basename(url)
    if (
      url !== `/uploads/${filename}` ||
      !/^[a-zA-Z0-9-]+\.(jpe?g|png|gif|webp)$/i.test(filename)
    ) {
      skipped++
      continue
    }
    const sourcePath = path.join(config.uploadDir, filename)
    const outputPath = path.join(thumbnailDir, `${path.parse(filename).name}.webp`)
    if (!fs.existsSync(sourcePath) || fs.existsSync(outputPath)) {
      skipped++
      continue
    }
    try {
      await sharp(sourcePath, { animated: false })
        .rotate()
        .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 72 })
        .toFile(outputPath)
      created++
    } catch (error) {
      failed++
      console.warn(`[thumbnail] failed: ${filename}: ${(error as Error).message}`)
    }
  }

  console.log(JSON.stringify({ total: uniqueUrls.length, created, skipped, failed }))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.close())
