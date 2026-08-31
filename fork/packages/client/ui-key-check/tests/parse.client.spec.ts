// @vitest-environment jsdom
/** Reading a page of pasted `provider<TAB>key` lines into rows. */

import { describe, expect, it } from 'vitest'
import { parseInput, parseLine } from '../src/client/key-check-controller.ts'

describe('parseLine', () => {
  it('splits a tab-separated line into provider and key', () => {
    expect(parseLine('nvidia\tnvapi-abc')).toEqual({ provider: 'nvidia', apiKey: 'nvapi-abc' })
  })

  it('splits on whitespace when a chat client has re-wrapped the tab', () => {
    expect(parseLine('nvidia nvapi-abc')).toEqual({ provider: 'nvidia', apiKey: 'nvapi-abc' })
  })

  it('keeps a key that itself contains a space', () => {
    expect(parseLine('nvidia nvapi-abc def')).toEqual({ provider: 'nvidia', apiKey: 'nvapi-abc def' })
  })

  it('trims the line and both fields', () => {
    expect(parseLine('  nvidia \t nvapi-abc  ')).toEqual({ provider: 'nvidia', apiKey: 'nvapi-abc' })
  })

  it('drops a blank line', () => {
    expect(parseLine('')).toBeUndefined()
    expect(parseLine('   ')).toBeUndefined()
  })

  it('drops a line with no separator, or with an empty field', () => {
    expect(parseLine('nvidia')).toBeUndefined()
    expect(parseLine('\tnvapi-abc')).toBeUndefined()
    expect(parseLine('nvidia\t')).toBeUndefined()
  })
})

describe('parseInput', () => {
  const providers = [{ provider: 'nvidia', displayName: 'NVIDIA' }, { provider: 'openai', displayName: 'OpenAI' }]

  it('marks each line known or unknown by the provider directory', () => {
    const entries = parseInput('nvidia\tnvapi-a\nnot-a-provider\tkey-b', providers)
    expect(entries.map(entry => entry.known)).toEqual([true, false])
  })

  it('matches a provider id without regard to case', () => {
    expect(parseInput('NVIDIA\tnvapi-a', providers)[0]?.known).toBe(true)
  })

  it('keeps paste order and skips blank lines', () => {
    const entries = parseInput('\nnvidia\tnvapi-a\n\nopenai\tsk-b\n', providers)
    expect(entries.map(entry => entry.provider)).toEqual(['nvidia', 'openai'])
  })

  it('starts every row unvalidated', () => {
    const row = parseInput('nvidia\tnvapi-a', providers)[0]
    expect(row?.valid).toBe(false)
    expect(row?.error).toBeUndefined()
  })

  it('filters every line out when the directory is empty', () => {
    expect(parseInput('nvidia\tnvapi-a', []).every(entry => !entry.known)).toBe(true)
  })

  it('gives each row a stable id within the panel', () => {
    expect(parseInput('nvidia\ta\nopenai\tb', providers).map(entry => entry.id)).toEqual(['row-0', 'row-1'])
  })
})
