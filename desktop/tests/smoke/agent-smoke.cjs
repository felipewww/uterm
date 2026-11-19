// Milestone-0 validation: run a REAL agent CLI in a node-pty PTY, receive its hooks over the
// Unix socket, and print what arrives. Run with Electron's ABI (node-pty is built for it):
//   ELECTRON_RUN_AS_NODE=1 npx electron tests/smoke/agent-smoke.cjs claude "Say hello in one short sentence." 90
const net = require('node:net')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const pty = require('node-pty')

const [agent = 'claude', prompt = 'Say hello in one short sentence.', waitS = '90', cwdArg] = process.argv.slice(2)
const repo = path.resolve(__dirname, '..', '..', '..')
const sessionId = crypto.randomUUID()
const sockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-smoke-'))
const sock = path.join(sockDir, 'hooks.sock')
const cwd = cwdArg || fs.mkdtempSync(path.join(os.tmpdir(), 'echo-smoke-cwd-'))
const events = []

const server = net.createServer((c) => {
  let b = ''
  c.on('data', (d) => { b += d })
  c.on('end', () => b.trim().split('\n').forEach((l) => { try { const o = JSON.parse(l); events.push(o); const p = o.payload; console.log('HOOK', p.hook_event_name, JSON.stringify(p).slice(0, 220)) } catch {} }))
})
server.listen(sock)

const script = path.join(repo, 'hooks', 'claude', 'hook.mjs')
let file, args
if (agent === 'claude') {
  const tpl = fs.readFileSync(path.join(repo, 'hooks', 'claude', 'hooks.template.json'), 'utf8').replaceAll('__HOOK_SCRIPT__', script)
  const settings = path.join(sockDir, 'settings.json'); fs.writeFileSync(settings, tpl)
  file = 'claude'; args = ['--settings', settings, '--session-id', sessionId]
} else { file = 'codex'; args = [] }

const p = pty.spawn(file, args, { name: 'xterm-256color', cols: 120, rows: 36, cwd,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ECHO_TERM_SESSION_ID: sessionId, ECHO_TERM_AGENT: agent, ECHO_TERM_SOCKET: sock } })
let out = ''
let sent = false
p.onData((d) => {
  out += d
  const plain = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
  // Scratch directory only: choose "Yes, I trust this folder" (second option) in the throwaway cwd.
  if (/trust/i.test(plain.slice(-900)) && /Enter\s*to\s*confirm/i.test(plain.slice(-900)) && !p._trustSent) { p._trustSent = true; setTimeout(() => { p.write('\x1b[B'); setTimeout(() => p.write('\r'), 300) }, 500) }
})
setTimeout(() => { p.write('\x1b[200~' + prompt + '\x1b[201~'); setTimeout(() => p.write('\r'), 200); sent = true; console.log('PROMPT SENT') }, 9000)
setTimeout(() => {
  const plain = out.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
  console.log('--- PTY TAIL ---\n' + plain.slice(-700))
  console.log('--- SUMMARY --- events:', events.map((e) => e.payload.hook_event_name).join(','))
  if (process.env.SMOKE_OUT) fs.writeFileSync(process.env.SMOKE_OUT, JSON.stringify(events, null, 1))
  console.log('prompt sent:', sent, 'cwd:', cwd, 'session:', sessionId)
  p.kill('SIGHUP'); setTimeout(() => { server.close(); process.exit(0) }, 1500)
}, Number(waitS) * 1000)
