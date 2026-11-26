import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** The encryption the operating system gives the app (Electron's safeStorage: Keychain on macOS, the keyring on Linux, DPAPI on Windows). */
export interface Crypto {
  available(): Promise<boolean>
  encrypt(plain: string): Promise<Buffer>
  /** `shouldReEncrypt`: the system rotated its key, so the stored value should be written again */
  decrypt(data: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
}

export type SecretName = 'openai' | 'gemini'
export const SECRET_NAMES: SecretName[] = ['openai', 'gemini']

/**
 * API keys typed in Settings. Stored encrypted in their own file (never in the database, never in the environment of agents or terminals);
 * only the main process ever reads them back. Without OS encryption nothing is written to disk: the key lasts for this run only.
 */
export class SecretStore {
  private data: Partial<Record<SecretName, string>> = {} // base64 of the encrypted value
  private plain: Partial<Record<SecretName, string>> = {} // memory of the main process only
  private canPersist = false

  constructor(private file: string, private crypto: Crypto) {
    try {
      if (existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
        for (const n of SECRET_NAMES) if (typeof parsed[n] === 'string') this.data[n] = parsed[n] as string
      }
    } catch { /* unreadable file: start empty, the user can type the key again */ }
  }

  /** Asks the system for its encryption and opens the saved keys. Call once, before reading any. */
  async load(): Promise<void> {
    this.canPersist = await this.crypto.available().catch(() => false)
    if (!this.canPersist) return
    let renewed = false
    for (const n of SECRET_NAMES) {
      const enc = this.data[n]
      if (!enc) continue
      try {
        const { result, shouldReEncrypt } = await this.crypto.decrypt(Buffer.from(enc, 'base64'))
        const v = result.trim()
        if (!v) continue
        this.plain[n] = v
        if (shouldReEncrypt) { this.data[n] = (await this.crypto.encrypt(v)).toString('base64'); renewed = true }
      } catch { /* cannot be opened now: the stored value stays as it is */ }
    }
    if (renewed) this.flush()
  }

  /** Can keys be kept across restarts on this machine? */
  persistent(): boolean { return this.canPersist }

  get(name: SecretName): string | null { return this.plain[name] ?? null }

  has(name: SecretName): boolean { return !!this.get(name) }

  /** Resolves false when the key could only be kept for this session. */
  async set(name: SecretName, value: string): Promise<boolean> {
    const v = value.trim()
    if (!v) { this.remove(name); return true }
    if (!this.canPersist) { this.plain[name] = v; return false }
    this.data[name] = (await this.crypto.encrypt(v)).toString('base64')
    this.plain[name] = v
    this.flush()
    return true
  }

  remove(name: SecretName): void {
    delete this.data[name]; delete this.plain[name]
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
