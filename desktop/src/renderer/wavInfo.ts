/** Length in seconds of a PCM WAV held in memory. Falls back to a 44-byte header guess if the chunk layout is unusual. */
export function wavDuration(buf: ArrayBuffer): number {
  const v = new DataView(buf)
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
  if (buf.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return 0
  let bytesPerSec = 0
  for (let o = 12; o + 8 <= buf.byteLength;) {
    const size = v.getUint32(o + 4, true)
    if (tag(o) === 'fmt ') bytesPerSec = v.getUint32(o + 12, true) * v.getUint16(o + 10, true) * (v.getUint16(o + 22, true) / 8)
    if (tag(o) === 'data') {
      const bytes = Math.min(size, buf.byteLength - o - 8) || buf.byteLength - o - 8
      return bytesPerSec > 0 ? bytes / bytesPerSec : 0
    }
    o += 8 + size + (size % 2)
  }
  return 0
}

export const mmss = (sec: number): string => {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
