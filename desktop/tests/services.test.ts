import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readDesired, setService, writeDesired, SERVICES_FILE } from '../src/main/services'

const root = (compose = true) => { const d = mkdtempSync(join(tmpdir(), 'echo-svc-')); if (compose) writeFileSync(join(d, 'docker-compose.yml'), 'services: {}\n'); return d }

describe('service on/off choice', () => {
  it('defaults to on, reads the file, and keeps the other service when one changes', () => {
    const d = root()
    expect(readDesired(d)).toEqual({ stt: true, tts: true })
    writeDesired(d, { tts: false })
    expect(readFileSync(join(d, SERVICES_FILE), 'utf8')).toBe('stt=on\ntts=off\n')
    expect(readDesired(d)).toEqual({ stt: true, tts: false })
    writeDesired(d, { stt: false })
    expect(readDesired(d)).toEqual({ stt: false, tts: false })
    expect(readDesired(null)).toEqual({ stt: true, tts: true })
  })
})

describe('setService', () => {
  it('stops a service with docker compose, then records it as off', async () => {
    const d = root(); const calls: string[][] = []
    let cwd: string | undefined
    const flags = await setService(d, 'tts', false, async (_f, args, _t, c) => { calls.push(args); cwd = c; return '' }).catch((e) => e as Error)
    if (flags instanceof Error) { expect(flags.message).toMatch(/Docker was not found/); return } // CI without docker
    expect(calls[0]).toEqual(['compose', '--project-directory', d, 'stop', 'tts'])
    expect(cwd).toBe(d) // relative COMPOSE_FILE paths in .env resolve against it
    expect(flags).toEqual({ stt: true, tts: false })
  })
  it('starts with up -d, and does not record anything when docker fails', async () => {
    const d = root(); let n = 0
    const ok = await setService(d, 'stt', true, async (_f, args) => { n++; expect(args.slice(-3)).toEqual(['up', '-d', 'stt']); return '' }).catch((e) => e as Error)
    if (ok instanceof Error) return // no docker here
    expect(n).toBe(1)
    writeDesired(d, { stt: false })
    await expect(setService(d, 'stt', true, async () => { throw new Error('boom\nmore') })).rejects.toThrow('Could not start STT: boom')
    expect(readDesired(d).stt).toBe(false) // the failed start left the choice as it was
  })
  it('refuses when the app is not next to a docker-compose.yml', async () => {
    await expect(setService(root(false), 'tts', false, async () => '')).rejects.toThrow(/not managed from this install/)
    await expect(setService(null, 'tts', false, async () => '')).rejects.toThrow(/not managed/)
  })
})
