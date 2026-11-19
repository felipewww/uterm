CREATE TABLE IF NOT EXISTS voice_profiles (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  name          VARCHAR(80)  NOT NULL,
  is_default    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_voice_profiles_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  id                    CHAR(36)     NOT NULL PRIMARY KEY,
  agent_type            VARCHAR(32)  NOT NULL,
  native_session_id     VARCHAR(128) NULL,
  title                 VARCHAR(160) NOT NULL,
  working_directory     VARCHAR(1024) NOT NULL,
  transcript_path       VARCHAR(1024) NULL,
  voice_profile_id      CHAR(36)     NULL,
  playback_speed        DECIMAL(3,2) NULL,
  foreground_voice_mode VARCHAR(16)  NULL,
  background_voice_mode VARCHAR(16)  NULL,
  created_at            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_activity_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  archived_at           TIMESTAMP(3) NULL,
  UNIQUE KEY uq_sessions_agent_native (agent_type, native_session_id),
  KEY ix_sessions_last_activity (last_activity_at),
  KEY ix_sessions_archived (archived_at),
  CONSTRAINT fk_sessions_voice FOREIGN KEY (voice_profile_id) REFERENCES voice_profiles(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS settings (
  setting_key   VARCHAR(64)  NOT NULL PRIMARY KEY,
  setting_value JSON         NOT NULL,
  updated_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS agent_events (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  session_id    CHAR(36)     NOT NULL,
  event_type    VARCHAR(48)  NOT NULL,
  turn_id       VARCHAR(128) NULL,
  payload       JSON         NOT NULL,
  occurred_at   TIMESTAMP(3) NOT NULL,
  KEY ix_agent_events_session_time (session_id, occurred_at),
  CONSTRAINT fk_agent_events_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS spoken_messages (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  session_id    CHAR(36)     NOT NULL,
  event_id      CHAR(36)     NOT NULL,
  voice_profile_id CHAR(36)  NULL,
  priority      TINYINT      NOT NULL,
  text          TEXT         NOT NULL,
  spoken_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_spoken_session_time (session_id, spoken_at),
  CONSTRAINT fk_spoken_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;
