-- The TTS service owns voice audio; this table mirrors profiles so sessions can reference them.
INSERT IGNORE INTO voice_profiles (id, name, is_default) VALUES ('default', 'Default', 1);
