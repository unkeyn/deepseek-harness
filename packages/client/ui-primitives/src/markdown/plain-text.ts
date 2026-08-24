/**
 * Markdown-to-plain-text projection for compact summaries and labels.
 * Parsing shares the renderer's streaming GFM grammar ({@link parseGfm}), so
 * the projection strips exactly the markup the renderer would draw; raw HTML
 * stays literal, links keep their labels, images keep alt text, and code
 * keeps its source text.
 */

import { parseGfm } from './parse.ts'

/** Amount of parsed Markdown content returned by the extractor. */
export type MarkdownPlainTextMode = 'all' | 'first-line' | 'first-paragraph'

/** Options for {@link extractMarkdownPlainText}. */
export interface MarkdownPlainTextOptions {
  /** Projection boundary; defaults to the complete document. */
  mode?: MarkdownPlainTextMode
}

interface MarkdownNode {
  type: string
  value?: string
  alt?: string
  children?: MarkdownNode[]
}

function inlineText(node: MarkdownNode): string {
  switch (node.type) {
    case 'text':
    case 'inlineCode':
    case 'code':
      return node.value ?? ''
    case 'image':
    case 'imageReference':
      return node.alt ?? ''
    case 'break':
      return '\n'
    case 'html':
      return node.value ?? ''
    default:
      return node.children?.map(inlineText).join('') ?? ''
  }
}

function compactInline(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function blockText(node: MarkdownNode): string {
  switch (node.type) {
    case 'root':
    case 'blockquote':
      return node.children?.map(blockText).filter(Boolean).join('\n\n') ?? ''
    case 'paragraph':
    case 'heading':
      return compactInline(inlineText(node))
    case 'code':
      return node.value?.trim() ?? ''
    case 'list':
      return node.children?.map(blockText).filter(Boolean).join('\n') ?? ''
    case 'listItem':
      return node.children?.map(blockText).filter(Boolean).join(' ') ?? ''
    case 'table':
      return node.children?.map(blockText).filter(Boolean).join('\n') ?? ''
    case 'tableRow':
      return node.children?.map(blockText).join('\t') ?? ''
    case 'tableCell':
      return compactInline(inlineText(node))
    case 'html':
      return node.value ?? ''
    case 'thematicBreak':
    case 'definition':
      return ''
    default:
      return compactInline(inlineText(node))
  }
}

function findFirstParagraph(node: MarkdownNode): string | undefined {
  if (node.type === 'paragraph') {
    const text = compactInline(inlineText(node))
    if (text !== '') return text
  }
  for (const child of node.children ?? []) {
    const text = findFirstParagraph(child)
    if (text !== undefined) return text
  }
  return undefined
}

function fullText(root: MarkdownNode): string {
  return blockText(root)
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Parse GFM Markdown, remove its presentation markup, and preserve raw HTML literally.
 * @param markdown - Markdown source.
 * @param options - Optional extraction boundary.
 * @returns Plain text for the whole document, first visible line, or first semantic paragraph.
 */
export function extractMarkdownPlainText(
  markdown: string,
  options: MarkdownPlainTextOptions = {},
): string {
  const { mode = 'all' } = options
  const root = parseGfm(markdown) as MarkdownNode
  const all = fullText(root)
  switch (mode) {
    case 'all':
      return all
    case 'first-line':
      return all.split('\n').find(line => line !== '') ?? ''
    case 'first-paragraph':
      return findFirstParagraph(root) ?? all.split('\n').find(line => line !== '') ?? ''
  }
}

/**
 * The raw first line of authored text — the settled summary line of a
 * reasoning block. Unlike the plain-text projection this keeps the markup,
 * for callers that render the line as markdown themselves.
 * @param text - Authored block text.
 * @returns The text up to (excluding) the first newline.
 */
export function firstRawLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/**
 * The raw trailing line of authored text — the followed summary line while a
 * reasoning block streams. Trailing whitespace is dropped so a just-emitted
 * newline does not blank the summary.
 * @param text - Authored block text.
 * @returns The text after the last newline of the whitespace-trimmed text.
 */
export function latestRawLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}
