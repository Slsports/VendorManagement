import { describe, expect, it } from 'vitest'
import { bySection, HELP_SECTIONS, parseArticle, parseBlocks, parseInline, searchHelp, slugOf } from './help'
import { helpArticles } from './helpArticles'

const a = parseArticle('tasks--add', `---
title: Add a task
section: Tasks
keywords: to-do, reminder
who: Everyone
---
Intro line.

## How to
1. Click **Tasks**.
2. Click **New task**
   and type it.

## Good to know
- See [Mail](/mail).
`)

describe('help articles', () => {
  it('reads the header and body', () => {
    expect(a).toMatchObject({ slug: 'tasks--add', title: 'Add a task', section: 'Tasks', keywords: ['to-do', 'reminder'], who: 'Everyone' })
    expect(a.body.startsWith('Intro line.')).toBe(true)
    expect(slugOf('/docs/help/tasks--add.md')).toBe('tasks--add')
  })
  it('turns the body into blocks', () => {
    expect(parseBlocks(a.body)).toEqual([
      { kind: 'p', text: 'Intro line.' },
      { kind: 'h2', text: 'How to' },
      { kind: 'ol', items: ['Click **Tasks**.', 'Click **New task** and type it.'] },
      { kind: 'h2', text: 'Good to know' },
      { kind: 'ul', items: ['See [Mail](/mail).'] },
    ])
  })
  it('reads bold and links', () => {
    expect(parseInline('Click **Save** or see [Mail](/mail).')).toEqual([
      { kind: 'text', text: 'Click ' }, { kind: 'bold', text: 'Save' }, { kind: 'text', text: ' or see ' },
      { kind: 'link', text: 'Mail', to: '/mail' }, { kind: 'text', text: '.' },
    ])
  })
  it('searches every word, title first', () => {
    const b = parseArticle('mail--reply', '---\ntitle: Reply to an email\nsection: Mail\nkeywords: answer\n---\nRemind the vendor.')
    expect(searchHelp([a, b], 'remind').map((x) => x.slug)).toEqual(['tasks--add', 'mail--reply'])
    expect(searchHelp([a, b], 'answer email').map((x) => x.slug)).toEqual(['mail--reply'])
    expect(searchHelp([a, b], 'add reply')).toEqual([])
    expect(searchHelp([a, b], '  ')).toEqual([])
  })
})

describe('the Knowledge Base files', () => {
  it('every article has a title, a known section and a body', () => {
    expect(helpArticles.length).toBeGreaterThan(0)
    for (const h of helpArticles) {
      expect(h.title, h.slug).not.toBe(h.slug)
      expect(HELP_SECTIONS as readonly string[], h.slug).toContain(h.section)
      expect(h.body.length, h.slug).toBeGreaterThan(20)
    }
    expect(new Set(helpArticles.map((h) => h.slug)).size).toBe(helpArticles.length)
    expect(bySection(helpArticles).length).toBeGreaterThan(0)
  })
})
