/** Caesar cipher over A-Z/a-z; other characters pass through. Negative shifts decode. */
export const caesar = (s, shift) => {
  const k = ((shift % 26) + 26) % 26
  return s.replace(/[a-z]/gi, (c) => {
    const base = c <= 'Z' ? 65 : 97
    return String.fromCharCode(((c.charCodeAt(0) - base + k) % 26) + base)
  })
}
