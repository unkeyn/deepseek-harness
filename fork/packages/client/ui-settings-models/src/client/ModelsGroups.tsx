import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import css from './ModelsSection.module.css'

/** One tab on the Models page. */
export interface ModelsSettingsTab {
  id: string
  title: string
  /** Kept for extension metadata and accessible documentation. */
  description?: string
  /** Called only after the group is opened for the first time. */
  render?: (() => ReactNode) | undefined
}

export interface ModelsSettingsTabsProps {
  tabs: readonly ModelsSettingsTab[]
  initialActiveId?: string
  unavailableText: string
  ariaLabel: string
}

/** Render Models tabs with the same tab behavior as the Plugins settings page. */
export function ModelsSettingsTabs(props: ModelsSettingsTabsProps) {
  const tabsId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const initialActiveId = props.initialActiveId ?? props.tabs[0]?.id
  const [activeId, setActiveId] = useState<string | undefined>(initialActiveId)
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<string>>(() => (
    initialActiveId === undefined ? new Set() : new Set([initialActiveId])
  ))
  const active = props.tabs.find(tab => tab.id === activeId)?.id ?? props.tabs[0]?.id

  useEffect(() => {
    if (active === undefined) return
    setVisitedIds(previous => previous.has(active) ? previous : new Set([...previous, active]))
  }, [active])

  if (props.tabs.length === 0) return <p className={css['empty']}>{props.unavailableText}</p>

  return (
    <>
      <div className={css['modelTabs']} role="tablist" aria-label={props.ariaLabel}>
        {props.tabs.map((tab, index) => {
          const selected = tab.id === active
          return (
            <button
              key={tab.id}
              ref={(element) => { tabRefs.current[index] = element }}
              id={`${tabsId}-tab-${tab.id}`}
              type="button"
              role="tab"
              className={css['modelTab']}
              aria-selected={selected}
              aria-controls={`${tabsId}-panel-${tab.id}`}
              data-active={selected ? 'true' : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => { setActiveId(tab.id) }}
              onKeyDown={(event) => {
                let nextIndex: number
                switch (event.key) {
                  case 'ArrowRight': nextIndex = (index + 1) % props.tabs.length; break
                  case 'ArrowLeft': nextIndex = (index - 1 + props.tabs.length) % props.tabs.length; break
                  case 'Home': nextIndex = 0; break
                  case 'End': nextIndex = props.tabs.length - 1; break
                  default: return
                }
                event.preventDefault()
                const nextTab = props.tabs[nextIndex]
                const nextButton = tabRefs.current[nextIndex]
                if (nextTab === undefined || nextButton == null) return
                setActiveId(nextTab.id)
                nextButton.focus()
              }}
            >
              {tab.title}
            </button>
          )
        })}
      </div>
      {props.tabs
        .filter(tab => tab.id === active || visitedIds.has(tab.id))
        .map(tab => {
          const selected = tab.id === active
          return (
            <div
              key={tab.id}
              id={`${tabsId}-panel-${tab.id}`}
              className={css['modelTabPanel']}
              role="tabpanel"
              aria-labelledby={`${tabsId}-tab-${tab.id}`}
              hidden={!selected}
            >
              {tab.render === undefined ? <p className={css['empty']}>{props.unavailableText}</p> : tab.render()}
            </div>
          )
        })}
    </>
  )
}
