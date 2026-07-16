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
