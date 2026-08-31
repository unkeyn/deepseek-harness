/**
 * The API-key check panel: one CHECK button at the bottom of the Models page
 * that expands into two lists — the batch you paste, and the keys a provider
 * accepted.
 *
 * Keys are rendered as themselves. Everywhere else in the settings surface a
 * key is a write-only field behind a password input, and that is right for a
 * field the user is filling in once. This surface is the other case: the user
 * pastes a batch they already hold, wants to read off which ones work, and
 * wants the list still there when they come back. Masking it would hide the
 * only thing the panel exists to show, so the key is plain text in the list,
 * in the buffer, and in the cache.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { KeyCheckEntry, KeyCheckFace } from './key-check-controller.ts'
import css from './KeyCheckPanel.module.css'

/** Props bound by the Models page footer slot. */
export type KeyCheckPanelProps = PropsRuntime<'settings.models.footer'> & PropsLocale<'fork.keycheck'> & InjectFace<KeyCheckFace>

/**
 * Render the CHECK button and, once it is pressed, the two lists.
 * @param props - slot-delivered runtime, copy, and controller face.
 * @returns the panel.
 */
export function KeyCheckPanel(props: KeyCheckPanelProps) {
  const state = props.useKeyCheck(snapshot => snapshot)
  const valid = state.entries.filter(entry => entry.valid && entry.known)
  const skipped = state.entries.filter(entry => !entry.known)
  const total = state.entries.filter(entry => entry.known).length
  return (
    <div className={css.panel}>
      <button
        type="button"
        className={css.checkButton}
        disabled={state.running}
        aria-expanded={state.open}
        onClick={props.toggle}
      >
        {state.running ? props.t('checking') : props.t('check')}
      </button>
      {state.open
        ? (
          <div className={css.lists}>
            <div className={css.header}>
              <span className={css.title}>{props.t('title')}</span>
              <button type="button" className={css.linkButton} onClick={props.hide}>
                {props.t('hide')}
              </button>
            </div>
            <p className={css.intro}>{props.t('intro')}</p>

            <section className={css.list}>
              <h3 className={css.listLabel}>{props.t('inputLabel')}</h3>
              <textarea
                className={css.buffer}
                value={state.input}
                spellCheck={false}
                autoComplete="off"
                rows={6}
                placeholder={props.t('inputPlaceholder')}
                aria-label={props.t('inputLabel')}
                onChange={(event) => { props.setInput(event.target.value) }}
              />
              <p className={css.hint}>{props.t('inputHint')}</p>
              {state.entries.length > 0
                ? (
                  <ul className={css.rows}>
                    {state.entries.map(entry => (
                      <PastedRow
                        key={entry.id}
                        entry={entry}
                        unavailableText={props.t('unavailable')}
                        pendingText={props.t('pending')}
                      />
                    ))}
                  </ul>
                )
                : null}
              {skipped.length > 0
                ? (
                  <p className={css.warn}>
                    {props.t('filteredCount').replace('{count}', String(skipped.length))}
                  </p>
                )
                : null}
              {!state.ready ? <p className={css.hint}>{props.t('directoryPending')}</p> : null}
            </section>

            <section className={css.list}>
              <h3 className={css.listLabel}>{props.t('resultsLabel')}</h3>
              {valid.length === 0
                ? <p className={css.empty}>{props.t('resultsEmpty')}</p>
                : (
                  <ul className={css.rows}>
                    {valid.map(entry => (
                      <li className={css.row} key={entry.id}>
                        <span className={css.rowProvider}>{entry.provider}</span>
                        <code className={css.rowKey}>{entry.apiKey}</code>
                        <span className={css.valid}>{props.t('valid')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              {total > 0 && state.checkedAt !== null
                ? (
                  <p className={css.hint}>
                    {props.t('resultsCount')
                      .replace('{count}', String(valid.length))
                      .replace('{total}', String(total))}
                  </p>
                )
                : null}
            </section>

            {state.error !== null ? <p role="status" className={css.error}>{state.error}</p> : null}
            <div className={css.actions}>
              <button type="button" className={css.linkButton} onClick={props.clear}>
                {props.t('clear')}
              </button>
            </div>
          </div>
        )
        : null}
    </div>
  )
}

/** One pasted line: the provider, the key as plain text, and why it did not run. */
function PastedRow(props: { entry: KeyCheckEntry; unavailableText: string; pendingText: string }) {
  const { entry } = props
  return (
    <li className={`${css.row} ${entry.known ? '' : css.rowSkipped}`}>
      <span className={css.rowProvider}>{entry.provider}</span>
      <code className={css.rowKey}>{entry.apiKey}</code>
      {entry.known
        ? <span className={css.rowNote}>{entry.error ?? props.pendingText}</span>
        : <span className={css.rowNote}>{props.unavailableText}</span>}
    </li>
  )
}
