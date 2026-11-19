-- Which Claude config folder (CLAUDE_CONFIG_DIR) a session runs with, e.g. a second account. NULL = whatever the app's environment says.
ALTER TABLE sessions ADD COLUMN config_dir VARCHAR(1024) NULL;
