// @vitest-environment jsdom
// MarkdownInline / renderInlineLine: the phrasing-only seat used by flow-row
// summaries. Pins real emphasis/code/link rendering, the untrusted-output
// policy, and the drop-non-paragraph contract.
import { StrictMode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownInline } from '@deepseek-ai/dsh-client-ui-primitives'
import { renderInlineLine } from '../src/markdown/render.tsx'

afterEach(cleanup)

function mount(text: string): HTMLElement {
  const { container } = render(<StrictMode><MarkdownInline text={text} /></StrictMode>)
  return container
}

describe('MarkdownInline', () => {
  it('renders emphasis and strong as elements, never literal markers', () => {
    const container = mount('**Verifying** the *build* status')
    expect(container.querySelector('strong')?.textContent).toBe('Verifying')
    expect(container.querySelector('em')?.textContent).toBe('build')
    expect(container.textContent).not.toContain('**')
    expect(container.textContent).toBe('Verifying the build status')
  })

  it('keeps inline code chrome inside the line', () => {
    const container = mount('runs `pnpm test` first')
    expect(container.querySelector('code')?.textContent).toBe('pnpm test')
  })

  it('allows an absolute https link and keeps its label', () => {
    const container = mount('see [the docs](https://example.com/a) here')
    const anchor = container.querySelector('a')
    expect(anchor?.getAttribute('href')).toBe('https://example.com/a')
    expect(anchor?.textContent).toBe('the docs')
  })

  it('leaves a javascript: destination inert', () => {
    const container = mount('[click](javascript:alert(1))')
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('click')
  })

  it('stays a literal for raw html input', () => {
    const container = mount('<img src=x onerror=alert(1)>hi')
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('renders nothing for blank or non-paragraph input', () => {
    expect(mount('').textContent).toBe('')
    expect(mount('   ').textContent).toBe('')
    // A heading line is block content: dropped rather than rendered as chrome.
    expect(mount('# Heading only').textContent).toBe('')
  })

  it('joins multi-paragraph input with a single space', () => {
    const container = mount('first\n\nsecond')
    expect(container.textContent).toBe('first second')
  })
})

describe('renderInlineLine', () => {
  it('returns plain strings untouched by element wrappers', () => {
    expect(renderInlineLine('plain words')).toEqual(['plain words'])
  })
})
