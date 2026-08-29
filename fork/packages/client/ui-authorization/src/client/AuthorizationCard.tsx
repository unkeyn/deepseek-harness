import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthorizationAttemptView, AuthorizationFlowView } from '@deepseek-ai/dsh-fork-authorization-controller/types'
import type { AuthorizationCardFace } from './authorization-controller.ts'
import css from './authorization-card.module.css'

export type AuthorizationCardProps = PropsRuntime<'settings.models.panel'> & PropsLocale<'fork.authorization'> & InjectFace<AuthorizationCardFace>

/** Current Models-page OAuth card. Values are write-only and never reflected from the Host. */
export function AuthorizationCard(props: AuthorizationCardProps) {
  const state = props.useAuthorization(snapshot => snapshot)
  const [methods, setMethods] = useState<Record<string, string>>({})
  const [openFlowKey, setOpenFlowKey] = useState<string | undefined>(undefined)
  useEffect(() => {
    setMethods(current => {
      const next = { ...current }
      for (const flow of state.flows) if (next[flow.key] === undefined) next[flow.key] = flow.methods[0]?.id ?? ''
      return next
    })
  }, [state.flows])

  if (!state.loaded || state.flows.length === 0) return null
  return (
    <section className={css.panel} aria-labelledby="fork-authorization-title">
      <div className={css.heading}>
        <h3 id="fork-authorization-title" className={css.title}>{props.t('title')}</h3>
        <p className={css.description}>{props.t('description')}</p>
      </div>
      <ul className={css.rows}>
        {state.flows.map(flow => {
          const attempt = Object.values(state.attempts).find(candidate => candidate.key === flow.key)
          const error = state.errors[flow.key]
          return (
            <FlowRow
              key={flow.key}
              flow={flow}
              open={openFlowKey === flow.key}
              {...attempt === undefined ? {} : { attempt }}
              {...error === undefined ? {} : { error }}
              method={methods[flow.key] ?? flow.methods[0]?.id ?? ''}
              t={props.t}
              onToggle={() => setOpenFlowKey(current => current === flow.key ? undefined : flow.key)}
              onMethod={value => setMethods(current => ({ ...current, [flow.key]: value }))}
              onStart={() => {
                setOpenFlowKey(flow.key)
                props.start(flow, methods[flow.key] ?? flow.methods[0]?.id ?? '')
              }}
              onAnswer={props.answer}
              onCancel={props.cancel}
            />
          )
        })}
      </ul>
    </section>
  )
}

function FlowRow(props: {
  flow: AuthorizationFlowView
  open: boolean
  attempt?: AuthorizationAttemptView
  error?: string
  method: string
  t: AuthorizationCardProps['t']
  onToggle: () => void
  onMethod: (value: string) => void
  onStart: () => void
  onAnswer: (attemptId: string, value: string) => void
  onCancel: (attemptId: string) => void
}) {
  const [answer, setAnswer] = useState('')
  const { flow, attempt } = props
  const busy = flow.inFlight || (attempt !== undefined && !isTerminal(attempt.status))
  const prompt = attempt?.prompt
  const status = rowStatus(props, busy, props.t)
  const detailsId = `oauth-flow-${encodeURIComponent(flow.key)}`
  return (
    <li className={css.rowCard}>
      <div className={css.rowHead}>
        <button
          type="button"
          className={css.expandButton}
          aria-expanded={props.open}
          aria-controls={detailsId}
          onClick={props.onToggle}
        >
          <span className={css.rowIdentity}>
            <span className={`${css.statusDot} ${status.tone}`} role="img" aria-label={status.label} />
            <span className={css.rowIdentityText}>
              <span className={css.rowName}>{flow.label}</span>
              <span className={css.rowKey}>{flow.key}</span>
            </span>
          </span>
          <span className={`${css.chevron} ${props.open ? css.chevronOpen : ''}`} aria-hidden="true" />
        </button>
      </div>
      {props.open
        ? (
          <div id={detailsId} className={css.editor}>
            <div className={css.editorHeader}>
              <span className={css.editorTitle}>{flow.label}</span>
              <span className={css.editorRoute}>{flow.key}</span>
            </div>
            <div className={css.signInRow}>
              {flow.methods.length > 1
                ? <select className={css.input} aria-label={props.t('method')} value={props.method} disabled={busy} onChange={event => props.onMethod(event.target.value)}>
                    {flow.methods.map(method => <option key={method.id} value={method.id}>{method.label}</option>)}
                  </select>
                : <span className={css.methodValue}>{flow.methods[0]?.label ?? props.t('method')}</span>}
              <button type="button" className={css.primaryButton} disabled={busy || props.method === ''} onClick={props.onStart}>
                {busy ? props.t('inProgress') : props.t('signIn')}
              </button>
            </div>
            {attempt?.notice !== undefined
              ? <Notice notice={attempt.notice} t={props.t} />
              : null}
            {attempt !== undefined && prompt !== undefined
              ? (
                <div className={css.prompt}>
                  <label className={css.promptLabel} htmlFor={`oauth-answer-${attempt.attemptId}`}>{prompt.message}</label>
                  {prompt.kind === 'select'
                    ? <select id={`oauth-answer-${attempt.attemptId}`} className={css.input} value={answer} onChange={event => setAnswer(event.target.value)}>
                        <option value="">{props.t('choose')}</option>
                        {prompt.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                      </select>
                    : <input id={`oauth-answer-${attempt.attemptId}`} className={css.input} type={prompt.kind === 'secret' ? 'password' : 'text'} autoComplete="off" placeholder={prompt.placeholder} value={answer} onChange={event => setAnswer(event.target.value)} />}
                  <div className={css.promptActions}>
                    <button type="button" className={css.primaryButton} disabled={answer === ''} onClick={() => { props.onAnswer(attempt.attemptId, answer); setAnswer('') }}>{props.t('continue')}</button>
                    <button type="button" className={css.secondaryButton} onClick={() => props.onCancel(attempt.attemptId)}>{props.t('cancel')}</button>
                  </div>
                </div>
              )
              : null}
            {attempt?.status === 'authorized' ? <p className={css.success} role="status">{props.t('authorized')}</p> : null}
            {attempt?.status === 'cancelled' ? <p className={css.muted} role="status">{props.t('cancelled')}</p> : null}
            {attempt?.status === 'failed' ? <p className={css.error} role="status">{attempt.error ?? props.t('failed')}</p> : null}
            {props.error !== undefined ? <p className={css.error} role="status">{props.error}</p> : null}
          </div>
        )
        : null}
    </li>
  )
}

function rowStatus(props: { attempt?: AuthorizationAttemptView; error?: string }, busy: boolean, t: AuthorizationCardProps['t']): { label: string | undefined; tone: string | undefined } {
  if (props.error !== undefined || props.attempt?.status === 'failed') return { label: t('failed'), tone: css.statusDotError }
  if (props.attempt?.status === 'authorized') return { label: t('authorized'), tone: css.statusDotSuccess }
  if (busy) return { label: t('inProgress'), tone: css.statusDotWaiting }
  return { label: t('notConnected'), tone: css.statusDotIdle }
}

function Notice(props: { notice: NonNullable<AuthorizationAttemptView['notice']>; t: AuthorizationCardProps['t'] }) {
  return (
    <div className={css.notice} role="status">
      <p>{props.notice.message}</p>
      {props.notice.url !== undefined ? <a href={props.notice.url} target="_blank" rel="noreferrer">{props.t('openBrowser')}</a> : null}
      {props.notice.code !== undefined ? <code>{props.notice.code}</code> : null}
    </div>
  )
}

function isTerminal(status: AuthorizationAttemptView['status']): boolean {
  return status === 'authorized' || status === 'cancelled' || status === 'failed'
}
