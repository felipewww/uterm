export type AgentType = 'claude' | 'codex' | 'kiro' | 'shell'
export const AGENT_TYPES: readonly AgentType[] = ['claude', 'codex', 'kiro', 'shell']
/** The agents (everything except the plain terminal): what can be a default agent, imported, or spoken to. */
export const CODING_AGENTS: readonly AgentType[] = ['claude', 'codex', 'kiro']
/** Display names: `label` for headers and pickers, `short` for dense rows. */
export const AGENT_LABELS: Record<AgentType, { label: string; short: string }> = {
  claude: { label: 'Claude Code', short: 'Claude' },
  codex: { label: 'Codex CLI', short: 'Codex' },
  kiro: { label: 'Kiro CLI', short: 'Kiro' },
  shell: { label: 'Terminal', short: 'Shell' }
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
  /** user folder this session is filed in, or null */
  folderId: string | null
  /** Claude config folder (CLAUDE_CONFIG_DIR) this session runs with; null = the environment default */
  configDir: string | null
  /** English coach for this chat: null = follow the global setting, true/false = override it */
  englishCoach: boolean | null
  /** Plain terminals: the folder the shell was last in, so reopening it starts there */
  lastCwd: string | null
}

/** The coach is on for a chat when its own choice says so, else when the global setting does. */
export const coachOnFor = (globalOn: boolean, override: boolean | null | undefined): boolean => override ?? globalOn

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
  /** Who transcribes recordings. Voice OUTPUT has no provider setting: the provider is part of the voice id (see shared/voices.ts). */
  sttProvider: SpeechProvider
  openaiTtsModel: string
  openaiSttModel: string
  geminiTtsModel: string
  geminiSttModel: string
  /** delivery style for cloud voices, written as an instruction */
  cloudVoiceStyle: string
  /** Show a more natural (B2–C1) English version of what you said, next to the transcription, before you send it. Needs an OpenAI key. */
  englishCoach: boolean
  englishCoachModel: string
  /** a short sound when an agent needs you or finishes while you are not looking at it */
  notifySounds: boolean
  notifyOnAttention: boolean
  notifyOnDone: boolean
  /** 0-1 */
  notifyVolume: number
  /** terminal app used by "Open in system terminal": auto, or one of the known apps */
  externalTerminal: string
  /** a short sound when recording starts and stops */
  recordCues: boolean
}

export type SpeechProvider = 'local' | 'openai' | 'gemini'
export const SPEECH_PROVIDERS: SpeechProvider[] = ['local', 'openai', 'gemini']

export interface UsageRow { provider: string; kind: string; calls: number; costUsd: number; audioSeconds: number; chars: number; unpriced: number }
export interface UsageSummary { today: UsageRow[]; month: UsageRow[]; all: UsageRow[] }

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
  injectSpeechInstructions: true,
  sttProvider: 'local',
  openaiTtsModel: 'gpt-4o-mini-tts',
  openaiSttModel: 'gpt-4o-mini-transcribe',
  geminiTtsModel: 'gemini-2.5-flash-preview-tts',
  geminiSttModel: 'gemini-2.5-flash',
  cloudVoiceStyle: 'Say in a warm, friendly, upbeat way, like a helpful teammate',
  englishCoach: false, // opt-in: it sends what you type or say to OpenAI
  englishCoachModel: 'gpt-4o-mini',
  notifySounds: true,
  notifyOnAttention: true,
  notifyOnDone: true,
  notifyVolume: 0.5,
  externalTerminal: 'auto',
  recordCues: true
}

export interface ServiceStatus { stt: boolean; tts: boolean; ttsReady: boolean; db: boolean }
