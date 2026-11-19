let current: { audio: HTMLAudioElement; url: string; requestId: string } | null = null

function release(notifyMain: boolean): void {
  if (!current) return
  const { audio, url, requestId } = current
  current = null
  audio.pause(); URL.revokeObjectURL(url)
  if (notifyMain) void window.echo.voice.audioEnded({ requestId })
}

/** Plays WAV chunks pushed by main and reports completion; main owns queueing. */
export function installAudioPlayer(): () => void {
  const offPlay = window.echo.events.onAudioPlay(({ requestId, data, speed }) => {
    release(false)
    const url = URL.createObjectURL(new Blob([data], { type: 'audio/wav' }))
    const audio = new Audio(url)
    audio.playbackRate = speed
    audio.preservesPitch = true
    current = { audio, url, requestId }
    audio.onended = () => release(true)
    audio.onerror = () => release(true)
    audio.play().catch(() => release(true))
  })
  const offStop = window.echo.events.onAudioStop(() => release(false))
  return () => { offPlay(); offStop(); release(false) }
}
