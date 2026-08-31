/** Locale bundles for the fork API-key check panel. */

/** Locale keys the key-check panel renders. */
export type KeyCheckLocaleKey =
  | 'check' | 'checking' | 'hide' | 'clear'
  | 'title' | 'intro'
  | 'inputLabel' | 'inputHint' | 'inputPlaceholder'
  | 'resultsLabel' | 'resultsEmpty' | 'resultsCount'
  | 'valid' | 'pending' | 'unavailable'
  | 'filteredCount' | 'noneAvailable' | 'directoryPending'

/** English copy. */
export const en: Record<KeyCheckLocaleKey, string> = {
  check: 'CHECK',
  checking: 'Checking…',
  hide: 'Hide',
  clear: 'Clear',
  title: 'API key check',
  intro: 'Paste a batch of keys to see which ones a provider accepts.',
  inputLabel: 'Keys to check',
  inputHint: 'One per line: provider, then a tab, then the key — e.g. nvidia<TAB>nvapi-…',
  inputPlaceholder: 'nvidia\tnvapi-…',
  resultsLabel: 'Working keys',
  resultsEmpty: 'No keys have been checked yet.',
  resultsCount: '{count} of {total} keys accepted',
  valid: 'valid',
  pending: 'not checked',
  unavailable: 'not available here',
  filteredCount: '{count} line(s) skipped: provider not available here',
  noneAvailable: 'None of these providers are available here.',
  directoryPending: 'Loading the provider list…',
}

/** Simplified-Chinese copy. */
export const zh: Record<KeyCheckLocaleKey, string> = {
  check: 'CHECK',
  checking: '正在检查…',
  hide: '收起',
  clear: '清空',
  title: 'API 密钥检查',
  intro: '粘贴一批密钥，查看哪些被服务商接受。',
  inputLabel: '待检查的密钥',
  inputHint: '每行一条：服务商、制表符、密钥 —— 例如 nvidia<TAB>nvapi-…',
  inputPlaceholder: 'nvidia\tnvapi-…',
  resultsLabel: '可用的密钥',
  resultsEmpty: '尚未检查任何密钥。',
  resultsCount: '{total} 个密钥中有 {count} 个被接受',
  valid: 'valid',
  pending: '未检查',
  unavailable: '此处不可用',
  filteredCount: '已跳过 {count} 行：服务商在此处不可用',
  noneAvailable: '这些服务商在此处均不可用。',
  directoryPending: '正在加载服务商列表…',
}
