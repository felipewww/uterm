-- User-made folders to organise sessions. Flat (no nesting). Deleting a folder keeps its sessions (they become unfiled).
CREATE TABLE IF NOT EXISTS session_folders (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  name       VARCHAR(80)  NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

ALTER TABLE sessions
  ADD COLUMN folder_id CHAR(36) NULL,
  ADD KEY ix_sessions_folder (folder_id),
  ADD CONSTRAINT fk_sessions_folder FOREIGN KEY (folder_id) REFERENCES session_folders(id) ON DELETE SET NULL;
