/** Locale strings for the Freebuff OAuth tab. */

/** Keys rendered by the OAuth tab. */
export type FreebuffOAuthLocaleKey =
  | 'tab' | 'title' | 'description' | 'signedOut' | 'connected' | 'pending'
  | 'waiting' | 'error' | 'signIn' | 'openFreebuff' | 'completeLogin' | 'logout'
  | 'refresh' | 'account' | 'loginFailed' | 'statusUnavailable' | 'cancelled'
  | 'openDesktop' | 'openingDesktop'

/** English copy. */
export const en: Record<FreebuffOAuthLocaleKey, string> = {
  tab: 'OAuth',
  title: 'Freebuff',
  description: 'Connect Freebuff to use its available models in this harness.',
  signedOut: 'Not connected',
  connected: 'Connected',
  pending: 'Login ready',
  waiting: 'Waiting for approval…',
  error: 'Connection unavailable',
  signIn: 'Sign in with Freebuff',
  openFreebuff: 'Open Freebuff',
  completeLogin: 'Finish sign-in',
  logout: 'Disconnect',
  refresh: 'Refresh status',
  account: 'Account',
  loginFailed: 'Freebuff login could not be completed.',
  statusUnavailable: 'Freebuff OAuth is unavailable in this deployment.',
  cancelled: 'Login cancelled.',
  openDesktop: 'Open Harness Desktop',
  openingDesktop: 'Opening Harness Desktop…',
}

/** Simplified Chinese copy. */
export const zh: Record<FreebuffOAuthLocaleKey, string> = {
  tab: 'OAuth',
  title: 'Freebuff',
  description: '连接 Freebuff，在此 Harness 中使用可用模型。',
  signedOut: '未连接',
  connected: '已连接',
  pending: '登录已准备',
  waiting: '等待授权…',
  error: '连接不可用',
  signIn: '使用 Freebuff 登录',
  openFreebuff: '打开 Freebuff',
  completeLogin: '完成登录',
  logout: '断开连接',
  refresh: '刷新状态',
  account: '账户',
  loginFailed: 'Freebuff 登录未完成。',
  statusUnavailable: '此部署未启用 Freebuff OAuth。',
  cancelled: '登录已取消。',
  openDesktop: '打开 Harness Desktop',
  openingDesktop: '正在打开 Harness Desktop…',
}
