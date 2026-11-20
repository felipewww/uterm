-- A terminal remembers the folder it was last in, and the commands the user chose to keep (never the output).
ALTER TABLE sessions ADD COLUMN last_cwd VARCHAR(1024) NULL;

CREATE TABLE IF NOT EXISTS saved_commands (
  id         CHAR(36)      NOT NULL PRIMARY KEY,
  session_id CHAR(36)      NOT NULL,
  label      VARCHAR(80)   NULL,
  command    TEXT          NOT NULL,
  position   INT           NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_saved_commands_session (session_id, position),
  CONSTRAINT fk_saved_commands_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;
