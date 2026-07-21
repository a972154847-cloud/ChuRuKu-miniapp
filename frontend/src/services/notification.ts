import Taro from '@tarojs/taro'

/** 本地存储 key：是否已请求过订阅授权 */
const HAS_REQUESTED_SUBSCRIBE_KEY = 'has_requested_subscribe'

/**
 * 请求微信订阅消息授权（小程序端原生能力）
 * - H5 端无此 API，自动降级为 no-op 返回 false
 * - 用户授权后可由后端推送订阅消息
 * @param templateIds 微信小程序后台申请的订阅消息模板 ID 列表
 * @returns 是否请求成功且至少有一个模板被接受
 */
export async function requestSubscribeMessage(
  templateIds: string[]
): Promise<boolean> {
  if (!templateIds || templateIds.length === 0) {
    return false
  }

  // H5 端无 requestSubscribeMessage，降级
  if (typeof Taro.requestSubscribeMessage !== 'function') {
    console.warn('[notification] 当前环境不支持 requestSubscribeMessage，跳过')
    return false
  }

  try {
    const res = await (Taro.requestSubscribeMessage as Function)({
      tmplIds: templateIds
    }) as Record<string, string>
    // 任一模板被接受即视为成功
    const accepted = templateIds.some((id) => res[id] === 'accept')
    if (accepted) {
      Taro.setStorageSync(HAS_REQUESTED_SUBSCRIBE_KEY, '1')
    }
    return accepted
  } catch (e) {
    // 用户拒绝或环境异常，静默处理（不阻塞主流程）
    console.warn('[notification] requestSubscribeMessage 失败:', e)
    return false
  }
}

/**
 * 是否已请求过订阅授权（本地标记）
 * 用于避免每次提交记录都弹窗打扰用户
 */
export function getSubscribeStatus(): boolean {
  try {
    return Taro.getStorageSync(HAS_REQUESTED_SUBSCRIBE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 标记已请求过订阅授权（用于外部在确认弹窗后手动标记）
 */
export function markSubscribeRequested(): void {
  try {
    Taro.setStorageSync(HAS_REQUESTED_SUBSCRIBE_KEY, '1')
  } catch {
    // ignore
  }
}
