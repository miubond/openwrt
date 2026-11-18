/** UTF-8 MD5，与原厂 bundle 里的 md5(明文密码) 一致。 */
export function md5Hex(input: string): string {
  const bytes = utf8Bytes(input)
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  const lo = bitLen >>> 0
  const hi = Math.floor(bitLen / 0x100000000)
  for (let i = 0; i < 4; i++) bytes.push((lo >>> (8 * i)) & 0xff)
  for (let i = 0; i < 4; i++) bytes.push((hi >>> (8 * i)) & 0xff)

  let a = 0x67452301
  let b = 0xefcdab89
  let c = 0x98badcfe
  let d = 0x10325476

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(16)
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4
      words[i] =
        (bytes[j]! |
          (bytes[j + 1]! << 8) |
          (bytes[j + 2]! << 16) |
          (bytes[j + 3]! << 24)) >>>
        0
    }
    let aa = a
    let bb = b
    let cc = c
    let dd = d
    for (let i = 0; i < 64; i++) {
      let f = 0
      let g = 0
      if (i < 16) {
        f = (bb & cc) | (~bb & dd)
        g = i
      } else if (i < 32) {
        f = (dd & bb) | (~dd & cc)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = bb ^ cc ^ dd
        g = (3 * i + 5) % 16
      } else {
        f = cc ^ (bb | ~dd)
        g = (7 * i) % 16
      }
      const next = add(bb, rotl(add(add(aa, f), add(K[i]!, words[g]!)), S[i]!))
      aa = dd
      dd = cc
      cc = bb
      bb = next
    }
    a = add(a, aa)
    b = add(b, bb)
    c = add(c, cc)
    d = add(d, dd)
  }

  return [a, b, c, d].map(wordToHex).join('')
}

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
  14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
]

const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000))

function add(x: number, y: number): number {
  return (x + y) >>> 0
}

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0
}

function wordToHex(word: number): string {
  let hex = ''
  for (let i = 0; i < 4; i++) hex += ((word >>> (8 * i)) & 0xff).toString(16).padStart(2, '0')
  return hex
}

function utf8Bytes(input: string): number[] {
  const bytes: number[] = []
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code & 0x3ff) << 10) + (next & 0x3ff)
        i++
      }
    }
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return bytes
}
