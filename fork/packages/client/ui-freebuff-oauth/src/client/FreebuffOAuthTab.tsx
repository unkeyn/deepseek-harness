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
  const error = state.error ?? state.desktopError

  return (
    <div className={css.panel}>
      <div className={css.header}>
        <div>
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
        {state.account !== undefined
          ? <span className={css.statusAccount}>{state.account.displayName ?? state.account.accountId}</span>
          : null}
      </div>

      {error !== undefined ? <p className={css.error}>{error}</p> : null}

      <div className={css.actions}>
        {pending
          ? (
            <>
              <button type="button" className={css.primary} disabled={busy} onClick={props.completeLogin}>
                {state.status === 'waiting' ? t('waiting') : t('completeLogin')}
              </button>
              <a className={css.secondary} href={state.loginUrl} target="_blank" rel="noreferrer">
                {t('openFreebuff')}
              </a>
              <DesktopButton props={props} />
            </>
          )
          : connected
            ? (
              <button type="button" className={css.secondary} onClick={props.logout}>
                {t('logout')}
              </button>
            )
            : (
              <>
                <button type="button" className={css.primary} onClick={props.beginLogin}>
                  {t('signIn')}
                </button>
                <DesktopButton props={props} />
              </>
            )}
      </div>
    </div>
  )
}

function DesktopButton({ props }: { props: FreebuffOAuthTabProps }) {
  const { t } = props
  const opening = props.useOauth(snapshot => snapshot.desktopStatus === 'opening')
  return (
    <button type="button" className={css.secondary} disabled={opening} onClick={props.openDesktop}>
      <IconPlayOutline16 className={css.actionIcon} />
      {opening ? t('openingDesktop') : t('openDesktop')}
    </button>
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
