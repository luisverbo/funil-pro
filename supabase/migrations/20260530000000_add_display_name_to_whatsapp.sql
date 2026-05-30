-- Add display_name and description to whatsapp_instances
ALTER TABLE whatsapp_instances
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS description  text;
