import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** The encryption the operating system gives the app (Electron's safeStorage: Keychain on macOS, the keyring on Linux, DPAPI on Windows). */
export interface Crypto {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export type SecretName = 'openai' | 'gemini'
export const SECRET_NAMES: SecretName[] = ['openai', 'gemini']

/**
 * API keys typed in Settings. Stored encrypted in their own file (never in the database, never in the environment of agents or terminals);
 * only the main process ever reads them back. Without OS encryption nothing is written to disk: the key lasts for this run only.
 */
export class SecretStore {
  private data: Partial<Record<SecretName, string>> = {} // base64 of the encrypted value
  private session: Partial<Record<SecretName, string>> = {} // plain, memory only (no OS encryption available)

  constructor(private file: string, private crypto: Crypto) {
    try {
      if (existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
        for (const n of SECRET_NAMES) if (typeof parsed[n] === 'string') this.data[n] = parsed[n] as string
      }
    } catch { /* unreadable file: start empty, the user can type the key again */ }
  }

  /** Can keys be kept across restarts on this machine? */
  persistent(): boolean { return this.crypto.available() }

  get(name: SecretName): string | null {
    const mem = this.session[name]
    if (mem) return mem
    const enc = this.data[name]
    if (!enc || !this.crypto.available()) return null
    try { return this.crypto.decrypt(Buffer.from(enc, 'base64')).trim() || null } catch { return null }
  }

  has(name: SecretName): boolean { return !!this.get(name) }

  /** Returns false when the key could only be kept for this session. */
  set(name: SecretName, value: string): boolean {
    const v = value.trim()
    if (!v) { this.remove(name); return true }
    if (!this.crypto.available()) { this.session[name] = v; return false }
    this.data[name] = this.crypto.encrypt(v).toString('base64')
    delete this.session[name]
    this.flush()
    return true
  }

  remove(name: SecretName): void {
    delete this.data[name]; delete this.session[name]
    this.flush()
  }

  private flush(): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 })
    renameSync(tmp, this.file)
    try { chmodSync(this.file, 0o600) } catch { /* not supported on this file system */ }
  }
}
