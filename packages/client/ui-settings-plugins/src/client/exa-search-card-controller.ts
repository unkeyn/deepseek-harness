/**
 * The Exa search provider's card: its endpoint, its per-request search budget,
 * and the key — which is written through the credentials domain, never into
 * the settings section, so the literal never rides a response.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm, numberField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/** Namespace of the Exa search provider. */
export const EXA_SEARCH_NS = 'web-search-exa'

/** The search-provider fields this card edits. */
export interface ExaSearchSettings {
  /** Exa API key. Falls back to `$EXA_API_KEY`. Empty → unavailable. */
  apiKey?: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Retrieval mode sent as Exa's `type`. Defaults to `auto`. */
  searchType?: 'auto' | 'keyword' | 'neural'
  /** Default result count when a request carries no `maxResults`. Omitted = none. */
  numResults?: number
  /** Highlight sentences requested per result. Defaults to 1. */
  highlightsPerResult?: number
}

/** What the Exa search card renders. */
export interface ExaSearchCardState extends CardShell {
  /** Provider endpoint. */
  baseURL: CardFieldState
  /** Retrieval mode. */
  searchType: CardFieldState
  /** Default result count. */
  numResults: CardFieldState
  /** Highlight sentences per result. */
  highlightsPerResult: CardFieldState
  /** The staged credential, which starts blank on every load. */
  apiKey: CardFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable: boolean
}

/** The registration-side face the Exa search card's slot entry injects. */
export interface ExaSearchCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useExaSearchCard. */
    exaSearchCard: SnapshotStore<ExaSearchCardState>
  }
}

/** Bridges the `web-search-exa` scope and the credentials domain onto the card. */
export class ExaSearchCardController {
  private readonly form: CardForm<ExaSearchSettings>
  private readonly store: SnapshotStore<ExaSearchCardState>
  private credential: { ref: string; configured: boolean; writable: boolean } = { ref: '', configured: false, writable: true }

  /**
   * @param scope - the bound settings scope for the `web-search-exa` namespace.
   * @param api - wire face used for the credential the section references.
   */
  constructor(
    private readonly scope: SettingsScope<ExaSearchSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.form = new CardForm(
      scope,
      [textField('baseURL'), textField('searchType'), numberField('numResults'), numberField('highlightsPerResult')],
      [{ field: 'apiKey', write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => { void this.readCredential() })
    void this.readCredential()
  }

  private projection(): ExaSearchCardState {
    return {
      ...this.form.shell(),
      baseURL: this.form.field('baseURL'),
      searchType: this.form.field('searchType'),
      numResults: this.form.field('numResults'),
      highlightsPerResult: this.form.field('highlightsPerResult'),
      apiKey: this.form.field('apiKey'),
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
    }
  }

  /**
   * Ask the credentials domain about the reference the section currently names.
   *
   * The answer is stored with the reference it describes: `apiKeyEnv` can
   * change between the request and its response, and two reads can settle out
   * of order, so a response is published only while it still answers for the
   * reference in force.
   */
  private async readCredential(): Promise<void> {
    // Exa uses apiKey directly, no env reference by default
    const ref = 'EXA_API_KEY'
    if (ref !== this.credential.ref) {
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({ refs: [ref] })
    } catch (_credentialReadFailure) {
      return
    }
    if (!response.result.ok || ref !== refOf(this.scope.getSnapshot())) return
    const view = response.result.value.credentials[ref]
    const next: { ref: string; configured: boolean; writable: boolean } = {
      ref,
      configured: view?.configured ?? false,
      writable: view?.writable ?? true,
    }
    if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
    this.credential = next
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to the reference this card watches.
   *
   * A key can be written from somewhere else — the Models page addresses the
   * same reference — and the settings section does not change when it is, so
   * without this the badge keeps reporting a state the Host already replaced.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): ExaSearchCardFace {
    return { hooks: { exaSearchCard: this.store }, ...this.form.actions() }
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    try {
      await this.api.credentials.set({ ref: refOf(this.scope.getSnapshot()), value })
    } catch (_credentialWriteFailure) {
    }
    await this.readCredential()
    return this.credential.configured
  }
}

/**
 * The credential reference the section names, or the provider's default.
 * @param snapshot - the current scope snapshot.
 * @returns the reference to address.
 */
function refOf(_snapshot: SettingsScopeSnapshot<ExaSearchSettings>): string {
  // Exa uses apiKey directly
  return 'EXA_API_KEY'
}
