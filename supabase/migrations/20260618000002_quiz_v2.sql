-- Quiz v2: add quiz_data column to pages for new page/block format

ALTER TABLE pages ADD COLUMN IF NOT EXISTS quiz_data jsonb;
