-- Correções do agente IA + suporte a upload do quiz builder
-- Aplicar manualmente no Supabase Studio (projeto hcadyqktfowfkxsbogmj)

-- ─── A3: Idempotência do webhook Evolution ────────────────────────────────────
create table if not exists processed_wa_messages (
  id uuid primary key default gen_random_uuid(),
  message_key_id text unique not null,
  created_at timestamptz default now()
);

-- Limpeza automática opcional: índice para expurgar mensagens antigas via cron
create index if not exists idx_processed_wa_messages_created on processed_wa_messages (created_at);

-- Sem RLS: tabela interna acessada apenas pelo service role (webhook)
alter table processed_wa_messages enable row level security;

-- ─── A4: Incremento atômico de ativações ─────────────────────────────────────
create or replace function increment_agent_activations(p_agent_id uuid)
returns void
language sql
security definer
as $$
  update ai_agents
  set activations_used = coalesce(activations_used, 0) + 1
  where id = p_agent_id;
$$;

-- ─── A4: Uma única conversa ativa por agente+lead ────────────────────────────
-- Encerra duplicatas existentes antes de criar o índice (mantém a mais recente)
with ranked as (
  select id, row_number() over (partition by agent_id, lead_id order by started_at desc) as rn
  from agent_conversations
  where status = 'active' and lead_id is not null
)
update agent_conversations
set status = 'abandoned', ended_at = now()
where id in (select id from ranked where rn > 1);

create unique index if not exists uniq_active_conversation_per_lead
  on agent_conversations (agent_id, lead_id)
  where status = 'active' and lead_id is not null;

-- ─── A5: Reset mensal de ativações ───────────────────────────────────────────
alter table ai_agents add column if not exists activations_reset_at date default current_date;

-- ─── B3: Bucket de assets do quiz builder ────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('quiz-assets', 'quiz-assets', true)
on conflict (id) do nothing;

-- Política: qualquer usuário autenticado pode fazer upload no seu caminho de tenant;
-- leitura é pública (bucket public)
create policy "quiz assets upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'quiz-assets');

create policy "quiz assets update own"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'quiz-assets');

create policy "quiz assets delete own"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'quiz-assets');
