/**
 * One-line assistant-authored markdown rendered as phrasing content, for
 * summary seats inside flow rows (the Think row's collapsed line). Emphasis,
 * inline code, links, and inline math render for real — a raw `**` never
 * reaches the user. Block constructs are dropped by the underlying renderer;
 * the caller's span owns display (ellipsis, color).
 */

import { memo, useMemo } from 'react'
import { renderInlineLine } from './render.tsx'

/**
 * Render one line of untrusted assistant-authored markdown as inline React
 * elements with no wrapper of its own.
 * @param props - The markdown line; blank or non-paragraph input renders nothing.
 * @returns The phrasing content fragment.
 */
export const MarkdownInline = memo(function MarkdownInline({ text }: { text: string }) {
  const children = useMemo(() => renderInlineLine(text), [text])
  return <>{children}</>
})
