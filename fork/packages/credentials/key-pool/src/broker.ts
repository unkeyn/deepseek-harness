/** Pool broker that can republish its redacted snapshot after config syncs. */
import { PoolCredentialBroker } from '@deepseek-ai/dsh-fork-credential-broker-pool'

/** Pool-backed credential broker owned by the key-pool plugin composition. */
export class KeyPoolBroker extends PoolCredentialBroker {
  /** Republish the redacted snapshot after the store membership changed underneath. */
  republishSnapshot(): void {
    this.publishStoreSnapshot()
  }
}

export default KeyPoolBroker
