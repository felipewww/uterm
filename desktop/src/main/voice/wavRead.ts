/** Reads a PCM WAV (8/16/32-bit int or 32-bit float) into mono Float32 at the requested rate. Throws on anything else. */
export function wavToMonoFloat(wav: Uint8Array, targetRate = 16000): Float32Array {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
  if (wav.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file')
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null
  let dataOff = -1, dataLen = 0
  for (let o = 12; o + 8 <= wav.byteLength;) {
    const id = tag(o); const size = v.getUint32(o + 4, true)
    if (id === 'fmt ') fmt = { format: v.getUint16(o + 8, true), channels: v.getUint16(o + 10, true), rate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) }
    else if (id === 'data') { dataOff = o + 8; dataLen = Math.min(size, wav.byteLength - dataOff); break }
    o += 8 + size + (size & 1)
  }
  if (!fmt || dataOff < 0) throw new Error('Unreadable WAV')
  const { format, channels, rate, bits } = fmt
  const bytes = bits / 8
  if (!((format === 1 && [8, 16, 32].includes(bits)) || (format === 3 && bits === 32)) || channels < 1) throw new Error('Unsupported WAV format')
  const frames = Math.floor(dataLen / (bytes * channels))
  const mono = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) {
      const p = dataOff + (i * channels + c) * bytes
      sum += format === 3 ? v.getFloat32(p, true) : bits === 16 ? v.getInt16(p, true) / 32768 : bits === 8 ? (v.getUint8(p) - 128) / 128 : v.getInt32(p, true) / 2147483648
    }
    mono[i] = sum / channels
  }
  if (rate === targetRate) return mono
  const outLen = Math.floor((frames * targetRate) / rate); const out = new Float32Array(outLen); const k = rate / targetRate
  for (let i = 0; i < outLen; i++) { const x = i * k; const a = Math.floor(x); const b = Math.min(a + 1, frames - 1); out[i] = mono[a]! + (mono[b]! - mono[a]!) * (x - a) }
  return out
}
