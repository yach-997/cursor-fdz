-- AI 硬规则表（Preview/Supabase 可用；服务启动时也会 CREATE IF NOT EXISTS + 种子）
CREATE TABLE IF NOT EXISTS ai_hard_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(32) NOT NULL UNIQUE,
  name varchar(64) NOT NULL,
  match_mode varchar(32) NOT NULL DEFAULT 'title_includes',
  match_pattern varchar(255) NOT NULL,
  prompt_text text NOT NULL,
  json_schema_hint text NULL,
  enabled boolean NOT NULL DEFAULT true,
  enforce_mode varchar(16) NOT NULL DEFAULT 'strict',
  version int NOT NULL DEFAULT 1,
  change_note text NULL,
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
