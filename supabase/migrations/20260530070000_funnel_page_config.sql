ALTER TABLE funnels 
  ADD COLUMN IF NOT EXISTS page_template text DEFAULT 'minimal',
  ADD COLUMN IF NOT EXISTS page_config jsonb DEFAULT '{}';
