import { wavToMonoFloat } from './wavRead'

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text?: string } | Array<{ text?: string }>>

/**
 * Speech-to-text that runs inside the app, with no Docker and no network call for the audio: Whisper through ONNX Runtime
 * (transformers.js). The model (~80 MB, quantised) is loaded on first use; if it is bundled with the app it is read from there,
 * otherwise it is downloaded once to the app's data folder. Audio stays in memory.
 */
export class NativeStt {
  private asr: Promise<Asr> | null = null
  constructor(private cacheDir: string, private model = 'onnx-community/whisper-base', private loader: () => Promise<Asr> = () => this.load()) {}

  private async load(): Promise<Asr> {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = this.cacheDir
    const asr = await pipeline('automatic-speech-recognition', this.model, { dtype: 'q8' })
    return asr as unknown as Asr
  }

  /** Starts loading the model in the background (so the first recording does not wait for it). Errors surface on the first transcription. */
  warm(): void { void (this.asr ??= this.loader()).catch(() => { this.asr = null }) }

  async transcribe(wav: Uint8Array): Promise<string> {
    const audio = wavToMonoFloat(wav, 16000)
    if (audio.length < 1600) return '' // shorter than 0.1 s: nothing to hear
    this.asr ??= this.loader()
    let asr: Asr
    try { asr = await this.asr } catch (err) { this.asr = null; throw new Error(`Speech recognition could not start: ${(err as Error).message}`) }
    const out = await asr(audio, { task: 'transcribe', chunk_length_s: 30 })
    const text = Array.isArray(out) ? out.map((o) => o.text ?? '').join(' ') : out.text ?? ''
    return cleanTranscript(text)
  }
}

/** whisper emits markers like [BLANK_AUDIO] / (music); drop them and normalise whitespace. */
export function cleanTranscript(t: string): string {
  return t.replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE)[^\]]*\]/gi, ' ').replace(/\((music|silence|noise)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ').trim()
}
