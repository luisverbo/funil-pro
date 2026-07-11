-- Agendamento de reuniões pelo agente IA
alter table ai_agents add column if not exists scheduling_config jsonb;

create table if not exists agent_meetings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  agent_id uuid not null references ai_agents(id) on delete cascade,
  lead_id uuid,
  conversation_id uuid,
  scheduled_at timestamptz not null,
  duration_minutes int not null default 30,
  status text not null default 'confirmed',   -- confirmed | cancelled | done
  topic text,
  created_at timestamptz default now()
);

-- Anti double-booking: um slot confirmado por agente
create unique index if not exists agent_meetings_slot_uniq
  on agent_meetings(agent_id, scheduled_at) where status = 'confirmed';

create index if not exists agent_meetings_agent_idx on agent_meetings(agent_id, scheduled_at);

alter table agent_meetings enable row level security;
do $$ begin
  create policy tenant_meetings on agent_meetings for all
    using (tenant_id = current_tenant_id());
exception when duplicate_object then null; end $$;
