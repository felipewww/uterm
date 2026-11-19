export type AgentType = 'claude' | 'codex' | 'kiro'
export const AGENT_TYPES: readonly AgentType[] = ['claude', 'codex', 'kiro']
/** Display names: `label` for headers and pickers, `short` for dense rows. */
export const AGENT_LABELS: Record<AgentType, { label: string; short: string }> = {
  claude: { label: 'Claude Code', short: 'Claude' },
  codex: { label: 'Codex CLI', short: 'Codex' },
  kiro: { label: 'Kiro CLI', short: 'Kiro' }
}

export type RuntimeState =
  | 'STARTING' | 'IDLE' | 'WORKING' | 'WAITING_FOR_INPUT'
  | 'WAITING_FOR_PERMISSION' | 'ERROR' | 'CLOSED'

export type VoiceMode = 'silent' | 'essential' | 'balanced' | 'conversational'
export const VOICE_MODES: readonly VoiceMode[] = ['silent', 'essential', 'balanced', 'conversational']

/** Spoken-content categories, ordered by priority (1 = most urgent). */
export type SpeechKind = 'question' | 'permission' | 'blocker' | 'final' | 'progress'

export interface SessionRecord {
  id: string
  agentType: AgentType
  nativeSessionId: string | null
  title: string
  workingDirectory: string
  transcriptPath: string | null
  voiceProfileId: string | null
  playbackSpeed: number | null
  foregroundVoiceMode: VoiceMode | null
  backgroundVoiceMode: VoiceMode | null
  createdAt: number
  lastActivityAt: number
  archivedAt: number | null
  /** user folder this session is filed in, or null */
  folderId: string | null
  /** Claude config folder (CLAUDE_CONFIG_DIR) this session runs with; null = the environment default */
  configDir: string | null
}

export interface FolderRecord { id: string; name: string; parentId: string | null; createdAt: number }

/** Persisted record + runtime-only state (never stored). */
export interface SessionView extends SessionRecord {
  runtimeState: RuntimeState
  running: boolean
  needsAttention: boolean
  muted: boolean
  speaking: boolean
}

/** What the speech queue is doing now; drives the "generating audio" indicator in Activity. */
export interface AudioState {
  speakingSessionId: string | null
  speakingEventId: string | null
  queued: number
  /** generating = the voice is being synthesised (nothing audible yet); playing = audio is coming out */
  phase: 'idle' | 'generating' | 'playing'
  /** when the current phase began (ms epoch) */
  since: number
  queuedEventIds: string[]
}

export interface VoiceProfile { id: string; name: string }

export interface AppSettings {
  defaultAgent: AgentType
  defaultVoiceId: string
  defaultPlaybackSpeed: number
  defaultForegroundMode: VoiceMode
  defaultBackgroundMode: VoiceMode
  recordShortcut: string
  autoSubmitTranscription: boolean
  microphoneId: string
  sttUrl: string
  ttsUrl: string
  queueMaxItems: number
  progressExpiryMs: number
  speechMaxChars: number
  globalMute: boolean
  /** Append the speech-friendly instructions (<voice> summaries) to new Claude sessions. */
  injectSpeechInstructions: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultAgent: 'claude',
  defaultVoiceId: 'default',
  defaultPlaybackSpeed: 1,
  defaultForegroundMode: 'balanced',
  defaultBackgroundMode: 'silent',
  recordShortcut: 'Control+Shift+Space',
  autoSubmitTranscription: false,
  microphoneId: '',
  sttUrl: 'http://127.0.0.1:18080',
  ttsUrl: 'http://127.0.0.1:18090',
  queueMaxItems: 8,
  progressExpiryMs: 20000,
  speechMaxChars: 400,
  globalMute: false,
  injectSpeechInstructions: true
}

export interface ServiceStatus { stt: boolean; tts: boolean; ttsReady: boolean; db: boolean }
