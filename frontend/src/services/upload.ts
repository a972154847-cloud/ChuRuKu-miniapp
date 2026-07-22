import Taro from '@tarojs/taro'

const BASE_URL = (typeof TARO_APP_API_BASE_URL !== 'undefined' && TARO_APP_API_BASE_URL)
  ? TARO_APP_API_BASE_URL.replace(/\/api$/, '')
  : 'http://localhost:3000'

export interface UploadResult {
  url: string
  thumbnailUrl?: string | null
  filename: string
  size: number
  mimeType: string
}

export function resolveFileUrl(url?: string | null): string {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  return BASE_URL + url
}

export async function uploadFile(filePath: string): Promise<UploadResult> {
  const token = Taro.getStorageSync('token')
  // P2-6: 加 30s 超时，避免弱网下永久 pending
  let res
  try {
    res = await Taro.uploadFile({
      url: BASE_URL + '/api/upload',
      filePath,
      name: 'file',
      header: token ? { Authorization: `Bearer ${token}` } : {},
      timeout: 30000,
    })
  } catch (err: any) {
    // Taro.uploadFile 网络失败时 reject 的是 { errMsg: 'uploadFile:fail ...' }，不是 Error 实例
    const errMsg = err?.errMsg || err?.message || '网络请求失败'
    throw new Error(`上传失败：${errMsg}`)
  }
  if (res.statusCode >= 400) {
    let msg = '上传失败'
    try {
      const err = JSON.parse(res.data || '{}')
      msg = err.message || msg
    } catch {
    }
    throw new Error(msg)
  }
  const body = JSON.parse(res.data)
  if (body && body.code === 0 && body.data) {
    return body.data as UploadResult
  }
  throw new Error(body && body.message ? body.message : '上传失败')
}

export default { uploadFile, resolveFileUrl }
