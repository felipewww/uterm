/** Which speaker/headset the app plays on ('' = the system default). Applied to every <audio> element and to the synthesised fallback beeps. */
type Sinkable = { setSinkId?: (id: string) => Promise<void>; sinkId?: string }

let wanted = ''
export function setOutputDevice(id: string): void { wanted = id }

/** Points an element at the chosen device. A device that is gone (headset switched off) falls back to the system default. */
export function applyOutput(el: HTMLAudioElement | AudioContext): void {
  const s = el as unknown as Sinkable
  if (typeof s.setSinkId !== 'function' || (s.sinkId ?? '') === wanted) return
  s.setSinkId(wanted).catch(() => { void s.setSinkId?.('').catch(() => undefined) })
}
