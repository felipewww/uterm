export interface SttStatus { up: boolean }

/** whisper.cpp server client. Expects 16 kHz mono PCM WAV (the renderer produces it). */
export class SttClient {
  constructor(private baseUrl: () => string) {}

  async status(): Promise<SttStatus> {
    try {
      const res = await fetch(`${this.baseUrl()}/health`, { signal: AbortSignal.timeout(1500) })
      return { up: res.ok }
    } catch { return { up: false } }
  }

  async transcribe(wav: Uint8Array): Promise<string> {
    const form = new FormData()
    form.append('file', new Blob([toArrayBuffer(wav)], { type: 'audio/wav' }), 'recording.wav')
    form.append('response_format', 'json')
    form.append('temperature', '0.0')
    const res = await fetch(`${this.baseUrl()}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) })
    if (!res.ok) throw new Error(`STT ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = (await res.json()) as { text?: string; error?: string }
    if (json.error) throw new Error(`STT: ${json.error}`)
    return cleanTranscript(json.text ?? '')
  }
}

/** whisper emits markers like [BLANK_AUDIO] / (music); drop them and normalise whitespace. */
export function cleanTranscript(t: string): string {
  return t.replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE)[^\]]*\]/gi, ' ').replace(/\((music|silence|noise)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ').trim()
}

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}
