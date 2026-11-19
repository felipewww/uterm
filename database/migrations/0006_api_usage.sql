-- One row per cloud speech call (OpenAI / Gemini). Costs are ESTIMATES computed by the app from reported usage and list prices.
CREATE TABLE IF NOT EXISTS api_usage (
  id            CHAR(36)      NOT NULL PRIMARY KEY,
  provider      VARCHAR(16)   NOT NULL,
  model         VARCHAR(80)   NOT NULL,
  kind          VARCHAR(8)    NOT NULL,
  chars         INT           NULL,
  audio_seconds DECIMAL(10,2) NULL,
  input_tokens  INT           NULL,
  output_tokens INT           NULL,
  cost_usd      DECIMAL(12,6) NULL,
  session_id    CHAR(36)      NULL,
  created_at    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_api_usage_time (created_at),
  KEY ix_api_usage_provider (provider, created_at)
) ENGINE=InnoDB;
