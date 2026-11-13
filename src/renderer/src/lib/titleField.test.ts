import { describe, expect, it } from 'vitest'
import { shownTitle, titleToSave, type TitleField } from './titleField'

const AI_TITLE = 'Cat when the build passes'
const idle: TitleField = { state: 'idle' }
const typed = (text: string): TitleField => ({ state: 'editing', text })

describe('title field', () => {
  // The bug: a new meme opens Info with the empty title field focused. The AI title arrived,
  // but the field kept showing the empty text from the moment of focus.
  it('shows the AI title that arrives while the field is focused but not typed in', () => {
    expect(shownTitle(idle, AI_TITLE)).toBe(AI_TITLE)
    expect(titleToSave(idle, AI_TITLE)).toBeNull()
  })

  it('keeps what the user types when the AI title arrives later, and saves it', () => {
    expect(shownTitle(typed('my title'), AI_TITLE)).toBe('my title')
    expect(titleToSave(typed('my title'), AI_TITLE)).toBe('my title')
  })

  it('saves nothing when the typed text ends up equal to the saved title', () => {
    expect(titleToSave(typed(` ${AI_TITLE} `), AI_TITLE)).toBeNull()
  })
})
