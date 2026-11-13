/**
 * The Info panel title field. It shows the saved title, which the AI can fill at any time,
 * until the user types. Focus alone changes nothing: `idle` → type → `editing` → blur → `idle`.
 */
export type TitleField = { state: 'idle' } | { state: 'editing'; text: string }

export const shownTitle = (field: TitleField, saved: string): string =>
  field.state === 'editing' ? field.text : saved

/** What blur saves: the typed text when it differs from the saved title, else nothing. */
export const titleToSave = (field: TitleField, saved: string): string | null =>
  field.state === 'editing' && field.text.trim() !== saved.trim() ? field.text : null
