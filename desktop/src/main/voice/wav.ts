/** Appends `ms` of silence to a PCM WAV (any channel count / bit depth). Returns the input unchanged if it is not a plain PCM WAV. */
export function appendSilence(wav: Uint8Array, ms: number): Uint8Array {
  if (ms <= 0 || wav.length < 44) return wav
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const tag = (o: number) => String.fromCharCode(wav[o]!, wav[o + 1]!, wav[o + 2]!, wav[o + 3]!)
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return wav
  let fmt: { rate: number; channels: number; bits: number; pcm: boolean } | null = null
  for (let o = 12; o + 8 <= wav.length;) {
    const size = v.getUint32(o + 4, true)
    if (tag(o) === 'fmt ') fmt = { pcm: v.getUint16(o + 8, true) === 1, channels: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) }
    if (tag(o) === 'data') {
      if (!fmt?.pcm || o + 8 + size !== wav.length) return wav // only a data chunk at the very end is handled
      const frame = fmt.channels * (fmt.bits / 8)
      const extra = Math.round((fmt.rate * ms) / 1000) * frame
      const out = new Uint8Array(wav.length + extra) // zero-filled = silence for signed PCM
      out.set(wav)
      const ov = new DataView(out.buffer)
      ov.setUint32(4, out.length - 8, true)
      ov.setUint32(o + 4, size + extra, true)
      return out
    }
    o += 8 + size + (size % 2)
  }
  return wav
}

/** Natural pause after a spoken chunk, from how its text ends. */
export function pauseAfter(chunk: string): number {
  const t = chunk.trimEnd()
  if (/[.!?…]["')\]]*$/.test(t)) return /[?!]["')\]]*$/.test(t) ? 340 : 300
  if (/[,;:]$/.test(t)) return 160
  return 120
}
