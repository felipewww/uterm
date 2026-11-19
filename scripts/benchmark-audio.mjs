#!/usr/bin/env node
// Real-model benchmark for the local STT (whisper.cpp small.en) and TTS (Chatterbox Turbo, CPU) services.
// Usage: node scripts/benchmark-audio.mjs   (services must be running; see ./scripts/dev.sh)
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const TTS = process.env.TTS_URL ?? 'http://127.0.0.1:18090'
const STT = process.env.STT_URL ?? 'http://127.0.0.1:18080'
const ms = (t0) => Math.round(performance.now() - t0)
const fmt = (n, d = 2) => Number(n).toFixed(d)

async function synth(text, voice = 'default') {
  const t0 = performance.now()
  const r = await fetch(`${TTS}/synthesize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice_id: voice }) })
  if (!r.ok) throw new Error(`synthesize ${r.status} ${await r.text()}`)
  const wav = new Uint8Array(await r.arrayBuffer())
  return { wav, wall: ms(t0), gen: Number(r.headers.get('x-gen-seconds')), audio: Number(r.headers.get('x-audio-seconds')) }
}

const ready = await (await fetch(`${TTS}/ready`)).json()
console.log(`TTS ready=${ready.ready} model load=${fmt(ready.load_seconds, 1)}s sample_rate=${ready.sample_rate}`)

const texts = {
  short: 'The implementation is complete.',
  sentence: 'I found a problem with token expiration, so I will try a different approach.',
  paragraph: 'The authentication changes are complete. All twenty four tests passed, and I fixed the token refresh issue. I recommend reviewing the cache configuration before deploying.'
}
await synth('Warm up.') // first call includes lazy initialisation
const rows = []
for (const [name, text] of Object.entries(texts)) {
  const runs = []
  for (let i = 0; i < 3; i++) runs.push(await synth(text))
  const best = runs.reduce((a, b) => (a.wall < b.wall ? a : b))
  const avgWall = runs.reduce((s, r) => s + r.wall, 0) / runs.length
  rows.push({ name, chars: text.length, audio: best.audio, wallBest: best.wall, wallAvg: Math.round(avgWall), rtf: best.gen / best.audio })
}
console.log('\nTTS (default voice, CPU) — 3 runs each after warm-up')
console.log('text       chars  audio_s  wall_best_ms  wall_avg_ms  RTF(gen/audio)')
for (const r of rows) console.log(`${r.name.padEnd(10)} ${String(r.chars).padStart(5)}  ${fmt(r.audio).padStart(7)}  ${String(r.wallBest).padStart(12)}  ${String(r.wallAvg).padStart(11)}  ${fmt(r.rtf, 3).padStart(8)}`)

// Voice cloning + switching: make a reference clip from the default voice (no external audio needed).
const ref = await synth('This is a short reference recording that is used to create a second voice profile for benchmarking the switching latency.')
const form = new FormData()
form.append('name', `bench-${Date.now()}`)
form.append('file', new Blob([ref.wav], { type: 'audio/wav' }), 'ref.wav')
let t0 = performance.now()
const created = await (await fetch(`${TTS}/voices`, { method: 'POST', body: form })).json()
console.log(`\nvoice profile created in ${ms(t0)} ms (conditioning computed once, cached)`)
const a = await synth(texts.sentence, 'default'); const b = await synth(texts.sentence, created.id)
const a2 = await synth(texts.sentence, 'default'); const b2 = await synth(texts.sentence, created.id)
console.log(`voice switching (wall ms): default=${a.wall} -> cloned=${b.wall} -> default=${a2.wall} -> cloned=${b2.wall}`)
const differ = Buffer.compare(Buffer.from(a.wav.slice(44, 4044)), Buffer.from(b.wav.slice(44, 4044))) !== 0
console.log(`cloned voice output differs from default voice output: ${differ}`)
await fetch(`${TTS}/voices/${created.id}`, { method: 'DELETE' })

// STT round trip: transcribe our own synthesized audio (converted to 16 kHz mono by ffmpeg inside the tts container).
const sample = await synth(texts.paragraph)
writeFileSync('/tmp/echo-bench-24k.wav', sample.wav)
let wav16
try {
  wav16 = execFileSync('ffmpeg', ['-v', 'error', '-i', '/tmp/echo-bench-24k.wav', '-ar', '16000', '-ac', '1', '-f', 'wav', '-'], { maxBuffer: 50e6 })
} catch {
  wav16 = execFileSync('docker', ['compose', 'exec', '-T', 'tts', 'sh', '-c', 'ffmpeg -v error -i - -ar 16000 -ac 1 -f wav -'], { input: sample.wav, maxBuffer: 50e6 })
}
const sf = new FormData()
sf.append('file', new Blob([wav16], { type: 'audio/wav' }), 'a.wav'); sf.append('response_format', 'json'); sf.append('temperature', '0.0')
const sttRuns = []
for (let i = 0; i < 3; i++) {
  t0 = performance.now()
  const r = await (await fetch(`${STT}/inference`, { method: 'POST', body: sf })).json()
  sttRuns.push({ wall: ms(t0), text: String(r.text ?? '').trim() })
}
console.log(`\nSTT (whisper.cpp small.en, CPU) on ${fmt(sample.audio, 1)} s of audio: ${sttRuns.map((r) => r.wall).join(', ')} ms  (RTF ${fmt(sttRuns[1].wall / 1000 / sample.audio, 3)})`)
console.log(`transcript: "${sttRuns[0].text}"`)
console.log(`original  : "${texts.paragraph}"`)
