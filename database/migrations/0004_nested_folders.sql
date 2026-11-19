-- Folders can contain folders. Cycles are prevented by the application; deleting a folder re-parents its children (done in code).
ALTER TABLE session_folders
  ADD COLUMN parent_id CHAR(36) NULL,
  ADD KEY ix_folders_parent (parent_id),
  ADD CONSTRAINT fk_folders_parent FOREIGN KEY (parent_id) REFERENCES session_folders(id) ON DELETE SET NULL;
