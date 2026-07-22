-- ============================================================================
-- BELLA BETS — DDL versionada das tabelas do MOTOR criadas via painel (22/07)
-- `historico_escanteios` e `sugestoes_liquidadas` foram criadas fora do repo. Este arquivo é o
-- DDL REAL extraído do banco vivo (wsbhfljopcdynwnoioxx) — colunas, índices, PK/UNIQUE e RLS —
-- pra que reconstruir o banco do zero pelos `supabase/*.sql` não deixe as duas de fora.
-- Idempotente. Escrita nas duas é só via service_role (edge functions); o dash só LÊ (policy SELECT).
-- ============================================================================

-- ── HISTORICO_ESCANTEIOS: cache de escanteios por jogo encerrado (imutável) ──
create table if not exists public.historico_escanteios (
  fixture_id    bigint primary key,
  liga_id       integer not null,
  data          date not null,
  casa          text not null,
  fora          text not null,
  esc_casa      integer not null,
  esc_fora      integer not null,
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_esc_casa on public.historico_escanteios using btree (casa);
create index if not exists idx_esc_fora on public.historico_escanteios using btree (fora);
create index if not exists idx_esc_data on public.historico_escanteios using btree (data desc);
alter table public.historico_escanteios enable row level security;
drop policy if exists leitura_autenticada on public.historico_escanteios;
create policy leitura_autenticada on public.historico_escanteios
  for select to authenticated using (true);

-- ── SUGESTOES_LIQUIDADAS: paper trading (calibração + ROI virtual + nota por faixa) ──
-- Chave de negócio: UNIQUE (jogo_id, mercado) — o upsert diário do analisar bate nela.
create table if not exists public.sugestoes_liquidadas (
  id               uuid primary key default gen_random_uuid(),
  data             date not null,
  jogo_id          text not null,
  partida          text not null,
  liga             text not null,
  casa             text not null,
  fora             text not null,
  mercado          text not null,
  rotulo           text not null,
  familia          text not null,
  linha            numeric,
  odd_referencia   numeric not null,
  odd_e_mercado    boolean not null default true,
  prob_modelo      numeric not null,
  confianca        text not null,
  radar            boolean not null default false,
  horizonte_dias   integer not null default 0,
  status           text not null default 'pendente',
  gols_casa        integer,
  gols_fora        integer,
  escanteios_total integer,
  liquidado_em     timestamptz,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  config_snapshot  jsonb,
  nota             integer,          -- nota de confiança 0-100 (ver migracao-nota.sql / _shared/nota.js)
  nota_componentes jsonb,
  unique (jogo_id, mercado)
);
create index if not exists idx_sug_status on public.sugestoes_liquidadas using btree (status);
create index if not exists idx_sug_data on public.sugestoes_liquidadas using btree (data desc);
alter table public.sugestoes_liquidadas enable row level security;
drop policy if exists sug_leitura on public.sugestoes_liquidadas;
create policy sug_leitura on public.sugestoes_liquidadas
  for select to authenticated using (true);
