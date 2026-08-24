/** Freebuff OAuth panel rendered inside the shared Models settings surface. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCheckOutline14, IconPlayOutline16, IconRefreshOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FreebuffOAuthFace, FreebuffOAuthState } from './controller.ts'
import type { FreebuffOAuthLocaleKey } from './locales.ts'
import css from './FreebuffOAuthTab.module.css'

/** Props bound by the `settings.models.panel` slot. */
export type FreebuffOAuthTabProps =
  PropsRuntime<'settings.models.panel'>
  & PropsLocale<'settings.oauth'>
  & InjectFace<FreebuffOAuthFace>

/** Render the Host-owned Freebuff OAuth controls. */
export function FreebuffOAuthTab(props: FreebuffOAuthTabProps) {
  const { t } = props
  const state = props.useOauth(snapshot => snapshot)
  const connected = state.status === 'connected'
  const pending = state.loginUrl !== undefined
  const busy = state.status === 'loading' || state.status === 'waiting'

  return (
    <div className={css.panel}>
      <div className={css.header}>
        <div>
          <p className={css.eyebrow}>Freebuff</p>
          <h3 className={css.title}>{t('title')}</h3>
          <p className={css.description}>{t('description')}</p>
        </div>
        <div className={css.headerActions}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('refresh')}
            title={t('refresh')}
            disabled={busy}
            onClick={props.refresh}
          >
            <IconRefreshOutline14 />
          </button>
        </div>
      </div>

      <div className={css.status} data-status={state.status} role="status">
        <span className={css.statusDot} aria-hidden="true" />
        <span>{statusLabel(t, state.status)}</span>
        {connected ? <IconCheckOutline14 className={css.statusIcon} /> : null}
      </div>

      {state.account !== undefined ? (
        <div className={css.account}>
          <span className={css.accountLabel}>{t('account')}</span>
          <strong>{state.account.displayName ?? state.account.accountId}</strong>
        </div>
      ) : null}

      {state.status === 'error' ? <p className={css.error}>{state.error ?? t('loginFailed')}</p> : null}

      {state.desktopError !== undefined ? <p className={css.error}>{state.desktopError}</p> : null}

      <div className={css.actions}>
        <button
          type="button"
          className={css.secondary}
          disabled={state.desktopStatus === 'opening'}
          onClick={props.openDesktop}
        >
          <IconPlayOutline16 className={css.actionIcon} />
          {state.desktopStatus === 'opening' ? t('openingDesktop') : t('openDesktop')}
        </button>
        {state.status === 'signed-out' || state.status === 'error' ? (
          <button type="button" className={css.primary} onClick={props.beginLogin}>
            {t('signIn')}
          </button>
        ) : null}
        {pending ? (
          <>
            <a className={css.secondary} href={state.loginUrl} target="_blank" rel="noreferrer">
              {t('openFreebuff')}
            </a>
            <button type="button" className={css.primary} disabled={busy} onClick={props.completeLogin}>
              {state.status === 'waiting' ? t('waiting') : t('completeLogin')}
            </button>
          </>
        ) : null}
        {connected ? (
          <button type="button" className={css.secondary} onClick={props.logout}>
            {t('logout')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function statusLabel(t: (key: FreebuffOAuthLocaleKey) => string, status: FreebuffOAuthState['status']): string {
  switch (status) {
    case 'loading': return t('waiting')
    case 'signed-out': return t('signedOut')
    case 'pending': return t('pending')
    case 'connected': return t('connected')
    case 'waiting': return t('waiting')
    case 'error': return t('error')
  }
}
