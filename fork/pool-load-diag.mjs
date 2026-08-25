import { Context } from '@deepseek-ai/cordis'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import Pool from '@deepseek-ai/dsh-fork-web-search-pool'

const ctx = new Context()
await ctx.plugin(SettingsFile)
ctx.provide('credentials', {
  resolve: async () => undefined,
  describe: async () => ({ configured: false, writable: true }),
  set: async () => {},
  unset: async () => {},
})
ctx.provide('web', { registerSearchProvider: () => () => {}, registerFetchProvider: () => () => {} })
ctx.provide('tools', { register: () => () => {} })
ctx.provide('systemPrompt', { section: () => () => {} })

process.on('unhandledRejection', (error) => {
  console.log('UNHANDLED REJECTION:', error)
})

try {
  await ctx.plugin(Pool, {})
  console.log('pool applied OK')
} catch (error) {
  console.log('APPLY FAILED:', error)
}

await new Promise(resolve => setTimeout(resolve, 1500))
const settings = ctx.get('settings')
const registered = settings.describe().map(descriptor => descriptor.ns)
console.log('namespaces:', registered.join(', '))
console.log('has web-search-pool:', registered.includes('web-search-pool'))
process.exit(0)
