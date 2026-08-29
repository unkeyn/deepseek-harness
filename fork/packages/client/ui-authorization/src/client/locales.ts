export type AuthorizationLocaleKey = 'title' | 'description' | 'signIn' | 'inProgress' | 'notConnected' | 'method' | 'choose' | 'continue' | 'cancel' | 'openBrowser' | 'authorized' | 'cancelled' | 'failed'

export const en: Record<AuthorizationLocaleKey, string> = {
  title: 'OAuth accounts',
  description: 'Sign in to providers that use browser authorization. Credentials stay in the secure host store.',
  signIn: 'Sign in',
  inProgress: 'Waiting…',
  notConnected: 'Not connected',
  method: 'Authorization method',
  choose: 'Choose…',
  continue: 'Continue',
  cancel: 'Cancel',
  openBrowser: 'Open in browser',
  authorized: 'Connected.',
  cancelled: 'Authorization cancelled.',
  failed: 'Authorization failed.',
}

export const zh: Record<AuthorizationLocaleKey, string> = {
  title: 'OAuth 账户',
  description: '对需要浏览器授权的提供方登录。凭据保留在安全的主机存储中。',
  signIn: '登录',
  inProgress: '等待中…',
  notConnected: '未连接',
  method: '授权方式',
  choose: '选择…',
  continue: '继续',
  cancel: '取消',
  openBrowser: '在浏览器中打开',
  authorized: '已连接。',
  cancelled: '授权已取消。',
  failed: '授权失败。',
}
