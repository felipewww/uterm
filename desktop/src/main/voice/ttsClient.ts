export interface TtsStatus { up: boolean; ready: boolean }

/** HTTP client for the local Chatterbox service. Failures never propagate beyond the audio path. */
export class TtsClient {
  constructor(private baseUrl: () => string) {}

  async status(): Promise<TtsStatus> {
    try {
      const h = await fetch(`${this.baseUrl()}/health`, { signal: AbortSignal.timeout(1500) })
      if (!h.ok) return { up: false, ready: false }
      const r = await fetch(`${this.baseUrl()}/ready`, { signal: AbortSignal.timeout(1500) })
      return { up: true, ready: r.ok }
    } catch { return { up: false, ready: false } }
  }

  async synthesize(text: string, voiceId: string, signal: AbortSignal): Promise<Uint8Array> {
    const res = await fetch(`${this.baseUrl()}/synthesize`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, voice_id: voiceId }), signal
    })
    if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return new Uint8Array(await res.arrayBuffer())
  }

  async listVoices(): Promise<Array<{ id: string; name: string }>> {
    const res = await fetch(`${this.baseUrl()}/voices`, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) throw new Error(`TTS ${res.status}`)
    return ((await res.json()) as { voices: Array<{ id: string; name: string }> }).voices
  }

  async createVoice(name: string, wav: Uint8Array, filename = 'reference.wav'): Promise<{ id: string; name: string }> {
    const form = new FormData()
    form.append('name', name)
    form.append('file', new Blob([toArrayBuffer(wav)]), filename)
    const res = await fetch(`${this.baseUrl()}/voices`, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) })
    if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return (await res.json()) as { id: string; name: string }
  }

  async deleteVoice(id: string): Promise<void> {
    const res = await fetch(`${this.baseUrl()}/voices/${encodeURIComponent(id)}`, { method: 'DELETE', signal: AbortSignal.timeout(4000) })
    if (!res.ok && res.status !== 404) throw new Error(`TTS ${res.status}`)
  }
}

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}
