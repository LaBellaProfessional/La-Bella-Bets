-- ============================================================================
-- BELLA BETS — schema do projeto Supabase (novo, exclusivo)
-- Substitui os JSONs de /data. RLS ligado em tudo: só usuário autenticado lê/escreve.
-- ============================================================================

-- ── CONFIG: linha única (banca, stakes, filtros, ligas) ─────────────────────
create table if not exists public.config (
  id                        int primary key default 1 check (id = 1),
  banca                     numeric(12,2) not null default 1000,
  stake_padrao_pct          numeric(5,2)  not null default 3,
  stake_confianca_maxima_pct numeric(5,2) not null default 5,
  teto_exposicao_diaria_pct numeric(5,2)  not null default 8,
  filtros                   jsonb not null default '{}'::jsonb,
  pesos_heuristica          jsonb not null default '{}'::jsonb,
  dixon_coles               jsonb not null default '{}'::jsonb,
  mercados_em_bilhete       jsonb not null default '[]'::jsonb,
  ligas                     jsonb not null default '[]'::jsonb,
  atualizado_em             timestamptz not null default now()
);
comment on table public.config is 'Linha única (id=1) com todos os parâmetros do método — era o config.json.';

-- ── HISTORICO_TIMES: cache de jogos. Jogo encerrado é imutável ──────────────
create table if not exists public.historico_times (
  time_nome     text primary key,
  jogos         jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.historico_ligas (
  liga_id       int primary key,
  nome          text not null,
  season        int,
  jogos         jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now()
);
comment on table public.historico_ligas is 'Temporada encerrada por liga — base do ajuste do Dixon-Coles.';

create table if not exists public.historico_h2h (
  par           text primary key,          -- "casaId-foraId"
  jogos         jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now()
);

-- ── MODELO_PARAMS: parâmetros do Dixon-Coles já ajustados ───────────────────
-- Ajustar 10 ligas dentro de uma edge function estoura o tempo limite. O fit roda
-- semanalmente e grava aqui; o dia a dia só LÊ os parâmetros (barato e rápido).
create table if not exists public.modelo_params (
  liga          text primary key,
  disponivel    boolean not null default false,
  motivo        text,
  n_jogos       int not null default 0,
  ataque        jsonb not null default '{}'::jsonb,
  defesa        jsonb not null default '{}'::jsonb,
  mando         numeric(8,5),
  rho           numeric(8,5),
  ajustado_em   timestamptz not null default now()
);

-- ── ANALISES: uma linha por dia, payload completo ───────────────────────────
create table if not exists public.analises (
  data          date primary key,
  modo          text not null check (modo in ('demo','real')),
  gerado_em     timestamptz not null default now(),
  resumo        jsonb not null default '{}'::jsonb,
  payload       jsonb not null,            -- jogos, pernas, motivos, config_efetivo, bilhetes
  criado_em     timestamptz not null default now()
);

-- ── BILHETES: registro + segmentação pro breakdown ──────────────────────────
create table if not exists public.bilhetes (
  id              uuid primary key default gen_random_uuid(),
  data            date not null,
  registrado_em   timestamptz not null default now(),
  pernas          jsonb not null,
  n_pernas        int not null default 0,
  odd_total       numeric(8,3) not null,
  prob_combinada  numeric(6,5),
  ev_pct          numeric(8,3),
  stake_sugerido  numeric(12,2),
  stake_real      numeric(12,2) not null,
  resultado       text not null default 'pendente' check (resultado in ('pendente','ganhou','perdeu')),
  retorno_rs      numeric(12,2) not null default 0,
  banca_depois    numeric(12,2),
  -- segmentação (breakdown): preenchida no registro, evita reprocessar jsonb depois
  ligas           text[] not null default '{}',
  mercados        text[] not null default '{}',
  faixa_odd       text,
  confianca       text,
  resolvido_em    timestamptz
);
create index if not exists bilhetes_data_idx on public.bilhetes (data desc);
create index if not exists bilhetes_resultado_idx on public.bilhetes (resultado);

-- ── EXECUCOES: rastro de cada rodada do motor (cota das APIs, erros) ────────
create table if not exists public.execucoes (
  id            uuid primary key default gen_random_uuid(),
  funcao        text not null,
  disparo       text not null default 'manual' check (disparo in ('manual','cron')),
  iniciado_em   timestamptz not null default now(),
  terminado_em  timestamptz,
  ok            boolean,
  req_football  int default 0,
  req_odds      int default 0,
  detalhe       jsonb
);

-- ============================================================================
-- RLS — nada é legível sem sessão. Uso próprio, usuário único.
-- ============================================================================
alter table public.config            enable row level security;
alter table public.historico_times   enable row level security;
alter table public.historico_ligas   enable row level security;
alter table public.historico_h2h     enable row level security;
alter table public.modelo_params     enable row level security;
alter table public.analises          enable row level security;
alter table public.bilhetes          enable row level security;
alter table public.execucoes         enable row level security;

do $$
declare t text;
begin
  foreach t in array array['config','historico_times','historico_ligas','historico_h2h',
                           'modelo_params','analises','bilhetes','execucoes']
  loop
    execute format($f$
      drop policy if exists %1$s_autenticado on public.%1$I;
      create policy %1$s_autenticado on public.%1$I
        for all to authenticated using (true) with check (true);
    $f$, t);
  end loop;
end $$;

-- service_role (edge functions) ignora RLS por padrão — o motor escreve por ali.

-- ── seed da config (idempotente) ────────────────────────────────────────────
insert into public.config (id) values (1) on conflict (id) do nothing;
