const TABLE = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]

/** 1..3999 -> Roman numeral. Throws RangeError outside that range. */
export const toRoman = (n) => {
  if (!Number.isInteger(n) || n < 1 || n > 3999) throw new RangeError('1..3999 only')
  let out = ''
  for (const [v, sym] of TABLE) while (n >= v) { out += sym; n -= v }
  return out
}

export const fromRoman = (s) => {
  let total = 0
  for (let i = 0; i < s.length; i++) {
    const cur = TABLE.find(([, sym]) => sym === s[i])?.[0] ?? NaN
    const next = TABLE.find(([, sym]) => sym === s[i + 1])?.[0] ?? 0
    total += cur < next ? -cur : cur
  }
  return total
}
