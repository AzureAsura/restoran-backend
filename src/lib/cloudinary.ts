import { v2 as cloudinary } from 'cloudinary'
import { env } from '../config/env'

cloudinary.config({
  cloud_name: env.cloudinaryCloudName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
})

export function uploadMenuImage(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: 'megatha/menu' }, (error, result) => {
      if (error || !result) {
        return reject(error ?? new Error('Cloudinary upload failed.'))
      }
      resolve(result.secure_url)
    })
    stream.end(buffer)
  })
}

// Derives the public_id Cloudinary needs for deletion from the secure_url we
// stored (schema only keeps the URL, not public_id) — safe because every
// upload goes through uploadMenuImage above with no transformations, so the
// URL shape is always .../upload/v<version>/megatha/menu/<id>.<ext>.
function publicIdFromUrl(url: string): string | null {
  try {
    const { hostname, pathname } = new URL(url)
    if (!hostname.includes('res.cloudinary.com')) return null

    const uploadIndex = pathname.indexOf('/upload/')
    if (uploadIndex === -1) return null

    const afterUpload = pathname.slice(uploadIndex + '/upload/'.length)
    const withoutVersion = afterUpload.replace(/^v\d+\//, '')
    return withoutVersion.replace(/\.[^./]+$/, '')
  } catch {
    return null
  }
}

// Best-effort: called after the owning DB row has already changed, so a
// failure here only leaves an orphaned asset (logged) rather than risking
// inconsistent app state.
export async function deleteMenuImage(imageUrl: string): Promise<void> {
  const publicId = publicIdFromUrl(imageUrl)
  if (!publicId) return

  try {
    await cloudinary.uploader.destroy(publicId)
  } catch (error) {
    console.error(`[cloudinary] Failed to delete asset ${publicId}:`, error)
  }
}
