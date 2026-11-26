import { spawn } from 'node-pty'
import { describe, expect, it } from 'vitest'
import { busyFromStat, isBusy } from '../src/main/busy'

describe('busy terminals', () => {
  it('reads the foreground group from /proc stat, whatever the process name holds', () => {
    expect(busyFromStat('100 (bash) S 1 100 100 34816 100 4194304')).toBe(false)
    expect(busyFromStat('100 (my (odd) sh) S 1 100 100 34816 250 4194304')).toBe(true)
    expect(busyFromStat('100 (bash) S 1 100 100 0 -1 4194304')).toBe(false) // no terminal
  })

  it('follows a real shell: idle, running a command, idle again', async () => {
    const shell = spawn('/bin/bash', ['--norc', '--noprofile', '-i'], { cols: 80, rows: 24, env: { PATH: process.env.PATH ?? '' } })
    shell.onData(() => {})
    const until = async (want: boolean) => {
      for (let i = 0; i < 100; i++) { if (await isBusy(shell.pid) === want) return true; await new Promise((r) => setTimeout(r, 50)) }
      return false
    }
    try {
      expect(await until(false)).toBe(true)
      shell.write('sleep 1\r')
      expect(await until(true)).toBe(true)
      expect(await until(false)).toBe(true)
    } finally { shell.kill('SIGKILL') }
  }, 15000)
})
