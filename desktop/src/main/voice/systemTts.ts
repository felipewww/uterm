import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run, which } from '../agents/exec'

type Exec = (file: string, args: string[], timeoutMs: number) => Promise<string>

/**
 * Text-to-speech built into the operating system, used when the local Docker voice is not there: macOS `say` (any Mac), or
 * `espeak-ng` on Linux when installed. Returns a WAV. The temporary audio file is deleted right away.
 */
export class SystemTts {
  constructor(private exec: Exec = run, private platform: NodeJS.Platform = process.platform, private find: (c: string) => Promise<string | null> = which) {}

  async available(): Promise<boolean> {
    if (this.platform === 'darwin') return !!(await this.find('say')) && !!(await this.find('afconvert'))
    return !!(await this.find('espeak-ng'))
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<Uint8Array> {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 4000)
    if (!clean) throw new Error('Nothing to say')
    const dir = mkdtempSync(join(tmpdir(), 'uterm-tts-'))
    try {
      if (signal?.aborted) throw new Error('aborted')
      if (this.platform === 'darwin') {
        const say = (await this.find('say')) ?? 'say'; const conv = (await this.find('afconvert')) ?? 'afconvert'
        const aiff = join(dir, 'out.aiff'); const wav = join(dir, 'out.wav')
        await this.exec(say, ['-o', aiff, '--', clean], 60000) // "--": the text can never be read as an option
        await this.exec(conv, ['-f', 'WAVE', '-d', 'LEI16@24000', '-c', '1', aiff, wav], 30000)
        return new Uint8Array(readFileSync(wav))
      }
      const esp = await this.find('espeak-ng')
      if (!esp) throw new Error('No system voice found (install espeak-ng, or use a cloud voice)')
      const wav = join(dir, 'out.wav')
      await this.exec(esp, ['-w', wav, '--', clean], 60000)
      return new Uint8Array(readFileSync(wav))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
}
