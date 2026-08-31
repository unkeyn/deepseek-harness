export type OAuthGridLocaleKey =
  | 'title'
  | 'description'
  | 'signIn'
  | 'inProgress'
  | 'notConnected'
  | 'method'
  | 'choose'
  | 'continue'
  | 'cancel'
  | 'openBrowser'
  | 'authorized'
  | 'cancelled'
  | 'failed'
  | 'accounts'
  | 'account'
  | 'addAccount'
  | 'removeAccount'
  | 'removeAccountConfirm'
  | 'noAccounts'
  | 'limits'
  | 'noLimits'
  | 'loadLimits'
  | 'limitStatusOk'
  | 'limitStatusWarning'
  | 'limitStatusExhausted'
  | 'limitStatusUnknown'
  | 'limitUnitPercent'
  | 'resetsAt'
  | 'expandAccounts'
  | 'collapseAccounts'
  | 'hot'
  | 'cooled'
  | 'rankingHint'

export const en: Record<OAuthGridLocaleKey, string> = {
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
  accounts: 'Accounts',
  account: 'Account',
  addAccount: 'Add account',
  removeAccount: 'Remove',
  removeAccountConfirm: 'Remove this account? Tokens on the host stay intact.',
  noAccounts: 'No accounts yet. Sign in to add one.',
  limits: 'Limits',
  noLimits: 'Limits are reported for Anthropic and the Antigravity-style OAuth providers.',
  loadLimits: 'Refresh limits',
  limitStatusOk: 'Healthy',
  limitStatusWarning: 'Near limit',
  limitStatusExhausted: 'Exhausted',
  limitStatusUnknown: 'Unknown',
  limitUnitPercent: '%',
  resetsAt: 'resets',
  expandAccounts: 'Show accounts',
  collapseAccounts: 'Hide accounts',
  hot: 'hot',
  cooled: 'cooled',
  rankingHint: 'Accounts marked "hot" are near their rolling limit and ranked lower.',
}

export const zh: Record<OAuthGridLocaleKey, string> = {
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
  accounts: '账户',
  account: '账户',
  addAccount: '添加账户',
  removeAccount: '移除',
  removeAccountConfirm: '移除该账户？主机端的令牌不会受影响。',
  noAccounts: '尚无账户。请先登录以添加。',
  limits: '使用上限',
  noLimits: 'Anthropic 与 Antigravity 风格 OAuth 提供方会报告使用上限。',
  loadLimits: '刷新上限',
  limitStatusOk: '充足',
  limitStatusWarning: '接近上限',
  limitStatusExhausted: '已耗尽',
  limitStatusUnknown: '未知',
  limitUnitPercent: '%',
  resetsAt: '重置于',
  expandAccounts: '展开账户',
  collapseAccounts: '收起账户',
  hot: '热点',
  cooled: '已冷却',
  rankingHint: '"热点"账户接近滚动上限，优先级会被自动降低。',
}
