import type { AgentType, FolderRecord, SessionRecord } from '@shared/types'

export interface NewSession {
  agentType: AgentType
  title: string
  workingDirectory: string
  nativeSessionId?: string | null
  transcriptPath?: string | null
  voiceProfileId?: string | null
  configDir?: string | null
}

export interface SessionRepository {
  create(s: NewSession): Promise<SessionRecord>
  get(id: string): Promise<SessionRecord | null>
  list(): Promise<SessionRecord[]>
  update(id: string, patch: Partial<Pick<SessionRecord,
    'title' | 'voiceProfileId' | 'playbackSpeed' | 'foregroundVoiceMode' | 'backgroundVoiceMode' | 'transcriptPath' | 'englishCoach' | 'lastCwd'>>): Promise<void>
  setNativeSessionId(id: string, nativeId: string): Promise<'ok' | 'duplicate'>
  touch(id: string, at?: number): Promise<void>
  /** Removes the session and (by cascade) its stored activity and spoken messages. */
  delete(id: string): Promise<void>
  findByNative(agent: AgentType, nativeId: string): Promise<SessionRecord | null>
  listFolders(): Promise<FolderRecord[]>
  createFolder(name: string, parentId?: string | null): Promise<FolderRecord>
  renameFolder(id: string, name: string): Promise<void>
  setFolderParent(id: string, parentId: string | null): Promise<void>
  /** Children (folders and sessions) move up to the deleted folder's parent. */
  deleteFolder(id: string): Promise<void>
  setFolder(sessionId: string, folderId: string | null): Promise<void>
}
