-- Per-chat override of the English coach: NULL = follow the global setting, 1 = on, 0 = off.
ALTER TABLE sessions ADD COLUMN english_coach TINYINT(1) NULL;
