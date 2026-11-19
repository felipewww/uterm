import { chmodSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import net from 'node:net'
import { HookEnvelope, MAX_HOOK_BYTES } from './schemas'

export type HookHandler = (env: HookEnvelope) => void

/**
 * Unix-domain-socket receiver for hook scripts. Socket and its directory are
 * owner-only (0600/0700). Every line is validated; garbage is dropped quietly.
 */
export class HookServer {
  private server: net.Server | undefined

  constructor(private path: string, private handler: HookHandler) {}

  async start(): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    chmodSync(dirname(this.path), 0o700)
    if (existsSync(this.path)) unlinkSync(this.path) // stale socket from a crashed run
    this.server = net.createServer((conn) => {
      let buf = ''
      conn.setEncoding('utf8')
      conn.setTimeout(3000, () => conn.destroy())
      conn.on('data', (chunk: string) => {
        buf += chunk
        if (buf.length > MAX_HOOK_BYTES) { conn.destroy(); return }
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          this.accept(buf.slice(0, nl))
          buf = buf.slice(nl + 1)
        }
      })
      conn.on('end', () => { if (buf.trim()) this.accept(buf); buf = '' })
      conn.on('error', () => undefined)
    })
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.path, () => { chmodSync(this.path, 0o600); resolve() })
    })
  }

  private accept(line: string): void {
    let json: unknown
    try { json = JSON.parse(line) } catch { return }
    const parsed = HookEnvelope.safeParse(json)
    if (!parsed.success) return
    try { this.handler(parsed.data) } catch (err) { console.error('[hooks] handler failed:', (err as Error).message) }
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()))
    try { if (existsSync(this.path)) unlinkSync(this.path) } catch { /* ignore */ }
  }
}
