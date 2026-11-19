// Milestone-0 validation for Kiro CLI: run the REAL kiro-cli in a node-pty PTY inside a scratch directory, send one
// tiny no-tool prompt, and report which native session files appear (kinds only, no conversation content).
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/smoke/kiro-smoke.cjs "Reply with exactly: OK" 70
// Resume check: KIRO_CWD=<same dir> KIRO_EXTRA="--resume-id <uuid>" (send an empty prompt by passing '' as first argument).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const pty = require('node-pty')

const [prompt = 'Reply with exactly: OK. Do not use any tools.', waitS = '70'] = process.argv.slice(2)
const sessionsDir = path.join(os.homedir(), '.kiro', 'sessions', 'cli')
const before = new Set(fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir) : [])
const cwd = process.env.KIRO_CWD || fs.mkdtempSync(path.join(os.tmpdir(), 'echo-smoke-kiro-'))
const startedAt = Date.now()
const p = pty.spawn(process.env.KIRO_BIN || 'kiro-cli', ['chat', ...(process.env.KIRO_EXTRA ? process.env.KIRO_EXTRA.split(' ') : [])], { name: 'xterm-256color', cols: 120, rows: 36, cwd,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ECHO_TERM_SESSION_ID: 'smoke' } })
let out = ''
const plain = () => out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
p.onData((d) => { out += d })
const t0 = Date.now()
const log = (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`)

const poll = setInterval(() => {
  const now = fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir) : []
  for (const f of now) if (!before.has(f)) { before.add(f); log(`new session file: ${f.replace(/[0-9a-f-]{36}/, '<uuid>')} (${fs.statSync(path.join(sessionsDir, f)).size} bytes)`) }
}, 500)

setTimeout(() => { log('--- screen after startup ---\n' + plain().slice(-900)) }, 8000)
setTimeout(() => { p.write('\x1b[200~' + prompt + '\x1b[201~'); setTimeout(() => p.write('\r'), 300); log('PROMPT SENT') }, 9000)
setTimeout(() => {
  clearInterval(poll)
  log('--- PTY tail ---\n' + plain().slice(-900))
  for (const f of fs.readdirSync(sessionsDir).filter((x) => x.endsWith('.json'))) {
    const full = path.join(sessionsDir, f)
    if (fs.statSync(full).mtimeMs < startedAt - 1000) continue
    const meta = JSON.parse(fs.readFileSync(full, 'utf8'))
    log(`meta: cwd matches scratch=${meta.cwd === cwd} reason=${meta.session_created_reason} created=${meta.created_at} title=${meta.title}`)
    const jl = full.replace(/\.json$/, '.jsonl')
    if (fs.existsSync(jl)) {
      const kinds = fs.readFileSync(jl, 'utf8').split('\n').filter(Boolean).map((l) => { try { const o = JSON.parse(l); return o.kind + '[' + (o.data.content || []).map((c) => c.kind).join(',') + ']' } catch { return '?' } })
      log('jsonl: ' + kinds.join(' → '))
    }
  }
  log('cwd: ' + cwd)
  p.kill('SIGHUP'); setTimeout(() => process.exit(0), 1500)
}, Number(waitS) * 1000)
