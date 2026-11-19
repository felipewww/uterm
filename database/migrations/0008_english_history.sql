-- Every "what I said / the more natural version" pair, for later review. event_id links to the Activity message (no FK: events are written asynchronously).
CREATE TABLE IF NOT EXISTS english_history (
  id         CHAR(36)     NOT NULL PRIMARY KEY,
  session_id CHAR(36)     NOT NULL,
  event_id   CHAR(36)     NULL,
  original   TEXT         NOT NULL,
  natural_text TEXT       NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_english_history_time (created_at),
  KEY ix_english_history_event (event_id),
  CONSTRAINT fk_english_history_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;
