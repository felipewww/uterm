import type { SessionView } from '@shared/types'

/** The sessions list as a tree: folders are containers that hold their sessions and sub-folders. */
export type SidebarNode =
  | { kind: 'folder'; key: string; id: string; name: string; count: number; collapsed: boolean; children: SidebarNode[] }
  | { kind: 'new'; key: string; parentId: string | null }
  | { kind: 'empty'; key: string; folderId: string }
  | { kind: 'session'; key: string; s: SessionView }
