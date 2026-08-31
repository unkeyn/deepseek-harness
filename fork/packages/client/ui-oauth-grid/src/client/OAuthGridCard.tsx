import { useEffect, useMemo, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AuthorizationAttemptView, AuthorizationFlowView } from '@deepseek-ai/dsh-fork-authorization-controller/types'
import type { OAuthAccountSnapshot, OAuthAccountView, UsageLimit, UsageReport, UsageStatus } from './types.ts'
import type { OAuthGridCardFace, OAuthGridCardState } from './authorization-grid-controller.ts'
import { deriveStatus, isExhausted, isHot, resolveUsedFraction } from './ranking.ts'
// `* .module.css` is declared as `Record<string, string>` upstream, which
// becomes `string | undefined` under `noUncheckedIndexedAccess`. We re-assert
// the indexer so the call sites stay terse.
import _css from './oauth-grid.module.css'
const css: Record<string, string> = _css as unknown as Record<string, string>

export type OAuthGridCardProps =
  & PropsRuntime<'settings.models.panel'>
  & PropsLocale<'fork.oauth-grid'>
  & InjectFace<OAuthGridCardFace>

/**
 * `* .module.css` is declared as `Record<string, string>` upstream, which
 * becomes `string | undefined` under `noUncheckedIndexedAccess`. We re-assert
 * the indexer as a non-undefined string so the call sites stay terse.
 */
function cls(name: string): string {
  return (css as unknown as Record<string, string>)[name] ?? name
}

/** OAuth provider panel: 3-column grid, horizontal account drawer. */
export function OAuthGridCard(props: OAuthGridCardProps) {
  const state = props.useAuthorization((snapshot: OAuthGridCardState) => snapshot)
  const [methods, setMethods] = useState<Record<string, string>>({})
  const [openProviderKey, setOpenProviderKey] = useState<string | undefined>(undefined)
  const accounts: OAuthAccountSnapshot = state.accounts

  useEffect(() => {
    setMethods((current: Record<string, string>) => {
      const next = { ...current }
      for (const flow of state.flows) if (next[flow.key] === undefined) next[flow.key] = flow.methods[0]?.id ?? ''
      return next
    })
  }, [state.flows])

  // Refresh accounts whenever a provider is opened so the drawer reflects
  // the host store immediately.
  useEffect(() => {
    if (openProviderKey === undefined) return
    void props.refreshAccounts(openProviderKey)
  }, [openProviderKey, props])

  if (!state.loaded || state.flows.length === 0) return null
  return (
    <section className={cls("panel")} aria-labelledby="fork-oauth-grid-title">
      <header className={cls("heading")}>
        <h3 id="fork-oauth-grid-title" className={cls("title")}>{props.t('title')}</h3>
        <p className={cls("description")}>{props.t('description')}</p>
        <p className={cls("rankingHint")}>{props.t('rankingHint')}</p>
      </header>
      <ProviderGrid
        flows={state.flows}
        attempts={state.attempts}
        errors={state.errors}
        accounts={accounts}
        openProviderKey={openProviderKey}
        methods={methods}
        t={props.t}
        onMethod={(flow, value) => setMethods(current => ({ ...current, [flow.key]: value }))}
        onToggle={key => setOpenProviderKey(current => current === key ? undefined : key)}
        onStart={flow => {
          setOpenProviderKey(flow.key)
          props.start(flow, methods[flow.key] ?? flow.methods[0]?.id ?? '')
        }}
        onAnswer={props.answer}
        onCancel={props.cancel}
        onAddAccount={flow => {
          props.start(flow, methods[flow.key] ?? flow.methods[0]?.id ?? '')
        }}
        onRemoveAccount={(providerKey, accountId) => void props.removeAccount(providerKey, accountId)}
        onLoadLimits={(providerKey, accountId) => void props.fetchLimits(providerKey, accountId)}
      />
    </section>
  )
}

interface ProviderGridProps {
  flows: readonly AuthorizationFlowView[]
  attempts: Readonly<Record<string, AuthorizationAttemptView>>
  errors: Readonly<Record<string, string>>
  accounts: OAuthGridCardState['accounts']
  openProviderKey: string | undefined
  methods: Record<string, string>
  t: OAuthGridCardProps['t']
  onMethod: (flow: AuthorizationFlowView, value: string) => void
  onToggle: (providerKey: string) => void
  onStart: (flow: AuthorizationFlowView) => void
  onAnswer: (attemptId: string, value: string) => void
  onCancel: (attemptId: string) => void
  onAddAccount: (flow: AuthorizationFlowView) => void
  onRemoveAccount: (providerKey: string, accountId: string) => void
  onLoadLimits: (providerKey: string, accountId: string) => void
}

function ProviderGrid(props: ProviderGridProps) {
  const openFlow = props.flows.find(flow => flow.key === props.openProviderKey)
  const drawerId = openFlow !== undefined ? `oauth-grid-drawer-${encodeURIComponent(openFlow.key)}` : undefined
  return (
    <div className={cls("gridShell")}>
      <ul className={cls("grid")}>
        {props.flows.map(flow => {
          const attempt = Object.values(props.attempts).find(candidate => candidate.key === flow.key)
          const error = props.errors[flow.key]
          const providerAccounts = props.accounts.accounts.filter(account => account.providerKey === flow.key)
          const providerError = props.accounts.errors[flow.key]
          const providerReport = mostPressuredReport(providerAccounts)
          const status = rowStatus({ attempt, error, accounts: providerAccounts }, props.t)
          return (
            <li key={flow.key} className={cls("cell")}>
              <button
                type="button"
                className={cls("card")}
                aria-expanded={props.openProviderKey === flow.key}
                aria-controls={drawerId}
                onClick={() => props.onToggle(flow.key)}
              >
                <span className={cls("identity")}>
                  <span className={`${cls("dot")} ${status.tone}`} role="img" aria-label={status.label} />
                  <span className={cls("identityText")}>
                    <span className={cls("name")}>{flow.label}</span>
                    <span className={cls("key")}>{flow.key}</span>
                  </span>
                </span>
                <ProviderMeta
                  accountCount={providerAccounts.length}
                  exhausted={isExhausted(providerReport)}
                  hot={isHot(providerReport)}
                  t={props.t}
                />
              </button>
              {error !== undefined ? <p className={cls("error")} role="status">{error}</p> : null}
              {providerError !== undefined && error === undefined
                ? <p className={cls("errorMuted")} role="status">{providerError}</p>
                : null}
            </li>
          )
        })}
      </ul>
      {openFlow !== undefined && drawerId !== undefined
        ? (
          <ProviderDrawer
            drawerId={drawerId}
            flow={openFlow}
            accounts={props.accounts.accounts.filter(account => account.providerKey === openFlow.key)}
            reports={props.accounts.reports}
            attempt={Object.values(props.attempts).find(candidate => candidate.key === openFlow.key)}
            methods={props.methods}
            t={props.t}
            onMethod={value => props.onMethod(openFlow, value)}
            onSignIn={() => props.onStart(openFlow)}
            onAnswer={props.onAnswer}
            onCancel={props.onCancel}
            onAddAccount={() => props.onAddAccount(openFlow)}
            onRemoveAccount={(accountId) => props.onRemoveAccount(openFlow.key, accountId)}
            onLoadLimits={accountId => props.onLoadLimits(openFlow.key, accountId)}
          />
        )
        : null}
    </div>
  )
}

interface ProviderMetaProps {
  accountCount: number
  exhausted: boolean
  hot: boolean
  t: OAuthGridCardProps['t']
}

function ProviderMeta(props: ProviderMetaProps) {
  const { accountCount, exhausted, hot, t } = props
  let hint: string
  let tone = cls("metaIdle")
  if (exhausted) {
    hint = `${t('limitStatusExhausted')} · ${accountCount}`
    tone = cls("metaExhausted")
  } else if (hot) {
    hint = `${t('hot')} · ${accountCount}`
    tone = cls("metaHot")
  } else if (accountCount > 0) {
    hint = `${accountCount} ${t('accounts')}`
    tone = cls("metaHealthy")
  } else {
    hint = t('notConnected')
  }
  return <span className={`${cls("meta")} ${tone}`}>{hint}</span>
}

interface ProviderDrawerProps {
  drawerId: string
  flow: AuthorizationFlowView
  accounts: readonly OAuthAccountView[]
  reports: Readonly<Record<string, UsageReport>>
  attempt: AuthorizationAttemptView | undefined
  methods: Record<string, string>
  t: OAuthGridCardProps['t']
  onMethod: (value: string) => void
  onSignIn: () => void
  onAnswer: (attemptId: string, value: string) => void
  onCancel: (attemptId: string) => void
  onAddAccount: () => void
  onRemoveAccount: (accountId: string) => void
  onLoadLimits: (accountId: string) => void
}

function ProviderDrawer(props: ProviderDrawerProps) {
  const { drawerId, flow, accounts, reports, attempt, methods, t } = props
  const busy = flow.inFlight || (attempt !== undefined && !isTerminal(attempt.status))
  const [answer, setAnswer] = useState('')
  const prompt = attempt?.prompt
  const orderedAccounts = useMemo(() => rankAccounts(accounts, reports), [accounts, reports])
  return (
    <div id={drawerId} className={cls("drawer")} role="region" aria-label={`${flow.label} ${t('accounts')}`}>
      <header className={cls("drawerHeader")}>
        <div className={cls("drawerHeading")}>
          <span className={cls("drawerTitle")}>{flow.label}</span>
          <span className={cls("drawerRoute")}>{flow.key}</span>
        </div>
        <div className={cls("signInRow")}>
          {flow.methods.length > 1
            ? (
              <select className={cls("input")} aria-label={t('method')} value={methods[flow.key] ?? flow.methods[0]?.id ?? ''} disabled={busy} onChange={event => props.onMethod(event.target.value)}>
                {flow.methods.map(method => <option key={method.id} value={method.id}>{method.label}</option>)}
              </select>
            )
            : <span className={cls("methodValue")}>{flow.methods[0]?.label ?? t('method')}</span>}
          <button type="button" className={cls("primaryButton")} disabled={busy} onClick={props.onSignIn}>
            {busy ? t('inProgress') : t('addAccount')}
          </button>
        </div>
      </header>
      {attempt?.notice !== undefined ? <Notice notice={attempt.notice} t={t} /> : null}
      {attempt !== undefined && prompt !== undefined
        ? <Prompt prompt={prompt} answer={answer} onAnswer={setAnswer} onSubmit={() => { props.onAnswer(attempt.attemptId, answer); setAnswer('') }} onCancel={() => props.onCancel(attempt.attemptId)} t={t} />
        : null}
      {attempt?.status === 'authorized' ? <p className={cls("success")} role="status">{t('authorized')}</p> : null}
      {attempt?.status === 'cancelled' ? <p className={cls("muted")} role="status">{t('cancelled')}</p> : null}
      {attempt?.status === 'failed' ? <p className={cls("error")} role="status">{attempt.error ?? t('failed')}</p> : null}
      <div className={cls("accountRow")} role="list" aria-label={t('accounts')}>
        {orderedAccounts.length === 0
          ? <p className={cls("muted")}>{t('noAccounts')}</p>
          : orderedAccounts.map(account => {
            const report = reports[`${account.providerKey}#${account.accountId}`]
            return (
              <AccountCard
                key={account.id}
                account={account}
                report={report}
                onRemove={() => props.onRemoveAccount(account.accountId)}
                onLoadLimits={() => props.onLoadLimits(account.accountId)}
                t={t}
              />
            )
          })}
      </div>
      <footer className={cls("drawerFooter")}>
        <p className={cls("muted")}>{t('noLimits')}</p>
      </footer>
    </div>
  )
}

interface AccountCardProps {
  account: OAuthAccountView
  report: UsageReport | undefined
  onRemove: () => void
  onLoadLimits: () => void
  t: OAuthGridCardProps['t']
}

function AccountCard(props: AccountCardProps) {
  const { account, report, onRemove, onLoadLimits, t } = props
  const exhausted = isExhausted(report)
  const hot = isHot(report)
  const tone = exhausted ? cls("cardExhausted") : hot ? cls("cardHot") : cls("cardOk")
  return (
    <article className={`${cls("cardTile")} ${tone}`} role="listitem" aria-label={account.email ?? account.label ?? account.accountId}>
      <header className={cls("cardHeader")}>
        <span className={cls("cardIdent")}>
          <span className={`${cls("dot")} ${tone}`} aria-hidden="true" />
          <span className={cls("cardName")}>{account.label ?? account.email ?? account.accountId}</span>
        </span>
        <span className={cls("cardStatus")}>{account.status}</span>
      </header>
      {account.email !== undefined ? <p className={cls("cardEmail")}>{account.email}</p> : null}
      <UsageStrip report={report} t={t} />
      <footer className={cls("cardActions")}>
        <button type="button" className={cls("tertiaryButton")} onClick={onLoadLimits}>{t('loadLimits')}</button>
        <button type="button" className={cls("secondaryButton")} onClick={onRemove}>{t('removeAccount')}</button>
      </footer>
    </article>
  )
}

function UsageStrip(props: { report: UsageReport | undefined; t: OAuthGridCardProps['t'] }) {
  const { report, t } = props
  if (report === undefined) {
    return <p className={cls("usageEmpty")}>{t('noLimits')}</p>
  }
  return (
    <ul className={cls("usageList")} aria-label={t('limits')}>
      {report.limits.map(limit => <UsageRow key={limit.id} limit={limit} t={t} />)}
    </ul>
  )
}

function UsageRow(props: { limit: UsageLimit; t: OAuthGridCardProps['t'] }) {
  const { limit, t } = props
  const fraction = resolveUsedFraction(limit)
  const status = limit.status ?? deriveStatus(fraction)
  return (
    <li className={cls("usageRow")}>
      <span className={cls("usageLabel")}>{limit.label}</span>
      <span className={cls("usageBar")} aria-hidden="true">
        <span className={`${cls("usageFill")} ${usageTone(status)}`} style={fillStyle(fraction)} />
      </span>
      <span className={cls("usagePct")}>{formatPct(fraction)}</span>
      <span className={`${cls("usageTag")} ${usageTone(status)}`}>{statusLabel(status, t)}</span>
      {limit.window?.resetsAt !== undefined
        ? <span className={cls("usageReset")}>{formatReset(limit.window.resetsAt)}</span>
        : null}
    </li>
  )
}

interface NoticeProps {
  notice: NonNullable<AuthorizationAttemptView['notice']>
  t: OAuthGridCardProps['t']
}

function Notice(props: NoticeProps) {
  return (
    <div className={cls("notice")} role="status">
      <p>{props.notice.message}</p>
      {props.notice.url !== undefined ? <a href={props.notice.url} target="_blank" rel="noreferrer">{props.t('openBrowser')}</a> : null}
      {props.notice.code !== undefined ? <code>{props.notice.code}</code> : null}
    </div>
  )
}

interface PromptProps {
  prompt: NonNullable<AuthorizationAttemptView['prompt']>
  answer: string
  onAnswer: (value: string) => void
  onSubmit: () => void
  onCancel: () => void
  t: OAuthGridCardProps['t']
}

function Prompt(props: PromptProps) {
  const { prompt, answer, onAnswer, onSubmit, onCancel, t } = props
  return (
    <div className={cls("prompt")}>
      <label className={cls("promptLabel")} htmlFor={`oauth-grid-answer-${prompt.kind}`}>{prompt.message}</label>
      {prompt.kind === 'select'
        ? (
          <select id={`oauth-grid-answer-${prompt.kind}`} className={cls("input")} value={answer} onChange={event => onAnswer(event.target.value)}>
            <option value="">{t('choose')}</option>
            {prompt.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        )
        : (
          <input id={`oauth-grid-answer-${prompt.kind}`} className={cls("input")} type={prompt.kind === 'secret' ? 'password' : 'text'} autoComplete="off" placeholder={prompt.placeholder} value={answer} onChange={event => onAnswer(event.target.value)} />
        )}
      <div className={cls("promptActions")}>
        <button type="button" className={cls("primaryButton")} disabled={answer === ''} onClick={onSubmit}>{t('continue')}</button>
        <button type="button" className={cls("secondaryButton")} onClick={onCancel}>{t('cancel')}</button>
      </div>
    </div>
  )
}

function rowStatus(state: { attempt: AuthorizationAttemptView | undefined; error: string | undefined; accounts: readonly OAuthAccountView[] }, t: OAuthGridCardProps['t']): { label: string | undefined; tone: string } {
  if (state.error !== undefined || state.attempt?.status === 'failed') return { label: t('failed'), tone: cls("dotError") }
  if (state.attempt?.status === 'authorized' || state.accounts.some(a => a.status === 'active')) return { label: t('authorized'), tone: cls("dotSuccess") }
  if ((state.attempt !== undefined && !isTerminal(state.attempt.status)) || state.attempt?.status === 'starting' || state.attempt?.status === 'waiting') return { label: t('inProgress'), tone: cls("dotWaiting") }
  return { label: t('notConnected'), tone: cls("dotIdle") }
}

function isTerminal(status: AuthorizationAttemptView['status']): boolean {
  return status === 'authorized' || status === 'cancelled' || status === 'failed'
}

function mostPressuredReport(accounts: readonly OAuthAccountView[]): UsageReport | undefined {
  let best: UsageReport | undefined
  for (const account of accounts) {
    const report = account.lastReport
    if (report === undefined) continue
    if (best === undefined || compareReports(report, best) < 0) best = report
  }
  return best
}

function compareReports(left: UsageReport, right: UsageReport): number {
  const lHot = isHot(left) ? 1 : 0
  const rHot = isHot(right) ? 1 : 0
  if (lHot !== rHot) return rHot - lHot
  const lEx = isExhausted(left) ? 1 : 0
  const rEx = isExhausted(right) ? 1 : 0
  if (lEx !== rEx) return rEx - lEx
  return 0
}

function rankAccounts(accounts: readonly OAuthAccountView[], reports: Readonly<Record<string, UsageReport>>): readonly OAuthAccountView[] {
  const sorted = [...accounts]
  sorted.sort((left, right) => {
    const lr = reports[`${left.providerKey}#${left.accountId}`]
    const rr = reports[`${right.providerKey}#${right.accountId}`]
    const lScore = scoreAccount(left, lr)
    const rScore = scoreAccount(right, rr)
    if (lScore !== rScore) return lScore - rScore
    return (left.email ?? left.accountId).localeCompare(right.email ?? right.accountId)
  })
  return sorted
}

function scoreAccount(account: OAuthAccountView, report: UsageReport | undefined): number {
  if (report === undefined) return account.status === 'active' ? 4 : 5
  if (isExhausted(report)) return 1
  if (isHot(report)) return 2
  return 3
}

function fillStyle(fraction: number | undefined): { width: string } {
  if (fraction === undefined) return { width: '0%' }
  return { width: `${Math.min(Math.max(fraction, 0), 1) * 100}%` }
}

function formatPct(fraction: number | undefined): string {
  if (fraction === undefined) return '—'
  return `${Math.round(fraction * 100)}%`
}

function formatReset(epochMs: number): string {
  const deltaMs = epochMs - Date.now()
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 'now'
  const minutes = Math.round(deltaMs / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function usageTone(status: UsageStatus | undefined): string {
  switch (status) {
    case 'exhausted': return cls("fillExhausted")
    case 'warning': return cls("fillWarning")
    case 'ok': return cls("fillOk")
    default: return cls("fillUnknown")
  }
}

function statusLabel(status: UsageStatus | undefined, t: OAuthGridCardProps['t']): string {
  switch (status) {
    case 'exhausted': return t('limitStatusExhausted')
    case 'warning': return t('limitStatusWarning')
    case 'ok': return t('limitStatusOk')
    default: return t('limitStatusUnknown')
  }
}
