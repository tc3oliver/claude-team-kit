/** Run-length encoding: "aaabcc" <-> "3a1b2c". Input to decode must be well formed. */
export const encode = (s) => s.replace(/(.)\1*/gsu, (run, ch) => `${[...run].length}${ch}`)
export const decode = (s) => s.replace(/(\d+)(\D)/gsu, (_, n, ch) => ch.repeat(Number(n)))
