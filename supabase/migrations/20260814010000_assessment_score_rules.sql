-- 月度考核：打分规则 + 分项明细
CREATE TABLE IF NOT EXISTS assessment_score_rule (
  id bigserial PRIMARY KEY,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  version int NOT NULL DEFAULT 1,
  updated_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE assessment
  ADD COLUMN IF NOT EXISTS score_detail jsonb NULL;
