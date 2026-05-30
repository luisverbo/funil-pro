ALTER TABLE funnel_blocks DROP CONSTRAINT IF EXISTS funnel_blocks_block_type_check;

ALTER TABLE funnel_blocks ADD CONSTRAINT funnel_blocks_block_type_check
  CHECK (block_type IN (
    'entry', 'message', 'condition', 'delay',
    'tag', 'sale', 'cart_abandoned',
    'form', 'page', 'agent'
  ));
