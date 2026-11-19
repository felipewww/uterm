#!/usr/bin/env node
// Echo-Term hook forwarder (Claude Code and Codex share this script).
// Contract: read the hook JSON from stdin, forward it to the Echo-Term Unix socket,
// ALWAYS exit 0 with no stdout, and never take longer than ~1.5 s. No audio, no side effects.
import net from 'node:net'
import { join } from 'node:path'

// Monotonic start time (same clock for every hook process on this boot): lets the app restore
// chronological order, because async hook processes finish in arbitrary order.
const startedNs = Number(process.hrtime.bigint())
const key = process.env.ECHO_TERM_SESSION_ID
if (!key) process.exit(0) // not an Echo-Term managed agent: ignore silently

const agent = process.env.ECHO_TERM_AGENT === 'codex' ? 'codex' : 'claude'
const sock =
  process.env.ECHO_TERM_SOCKET ||
  join(process.env.XDG_RUNTIME_DIR || `/tmp/echo-term-${process.getuid?.() ?? 'u'}`, 'echo-term', 'hooks.sock')

const hardStop = setTimeout(() => process.exit(0), 1500)
hardStop.unref()

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => { if (input.length < 1_000_000) input += c })
process.stdin.on('end', () => {
  let payload
  try { payload = JSON.parse(input) } catch { process.exit(0) }
  const line = JSON.stringify({ v: 1, agent, sessionKey: key, seq: startedNs, payload }) + '\n'
  const c = net.createConnection(sock)
  c.on('error', () => process.exit(0)) // app not running: stay non-interfering
  c.on('connect', () => c.end(line, () => process.exit(0)))
})
