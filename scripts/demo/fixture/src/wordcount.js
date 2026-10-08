/** Count words, ignoring punctuation and case: returns a Map sorted by count desc, then word. */
export const wordCount = (text) => {
  const counts = new Map()
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1)
  return new Map([...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
}
