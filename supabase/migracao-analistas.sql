-- ============================================================================
-- BELLA BETS — migração "CAMADA DE ANALISTAS" — Parte A
-- Une o que a máquina não vê (contexto humano de canais do YouTube) ao motor, MEDIDO como todos
-- os outros: cada analista tem placar próprio, cada palpite liquida contra o placar real, e o peso
-- se recalibra sozinho. Nada empurra a nota pra confiança máxima; a dúvida freia mais que o
-- entusiasmo empurra. Aplicar no SQL editor do bella-bets (wsbhfljopcdynwnoioxx). Idempotente.
-- ============================================================================

-- ── ANALISTAS: um canal do YouTube (peso 2..15, nunca zera — direito à dúvida) ───────────────
create table if not exists public.analistas (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  canal_youtube text not null,               -- @handle (ex.: @freitastipster)
  url           text not null,
  channel_id    text,                        -- UC... (descoberto na 1ª ingestão, chaveia o RSS)
  ativo         boolean not null default true,
  peso_atual    numeric(4,1) not null default 8 check (peso_atual >= 2 and peso_atual <= 15),
  observacao    text,                        -- ex.: "cobre Série B e Sula com dados estruturados"
  criado_em     timestamptz not null default now(),
  unique (canal_youtube)
);
comment on table public.analistas is 'Canais de análise (YouTube). peso_atual 2..15 recalibrado a cada 30 palpites; nunca zera.';

-- ── ANALISTA_CONTEUDOS: um vídeo ingerido (transcrição bruta + estado do processamento) ──────
create table if not exists public.analista_conteudos (
  id               uuid primary key default gen_random_uuid(),
  analista_id      uuid not null references public.analistas(id) on delete cascade,
  video_id         text not null,
  video_titulo     text,
  data_video       timestamptz,
  url              text,
  transcricao_bruta text,
  -- ciclo de vida: novo → (sem transcrição | extraido | erro). Falha nunca derruba o pipeline.
  status           text not null default 'novo' check (status in ('novo','sem_transcricao','extraido','erro')),
  erro             text,
  custo            jsonb,                     -- { modelo, input_tokens, output_tokens, usd } da extração
  processado_por   text not null default 'pipeline',  -- 'pipeline' | 'manual_bootstrap'
  ingerido_em      timestamptz not null default now(),
  processado_em    timestamptz,
  unique (video_id)
);
create index if not exists idx_conteudo_analista on public.analista_conteudos (analista_id);
create index if not exists idx_conteudo_status on public.analista_conteudos (status);

-- ── ANALISTA_EXTRACOES: cada fato / opinião / dado citado extraído de um vídeo ────────────────
-- BILHETE MÚLTIPLO vira várias linhas (uma por seleção). FORMATO DO FREITAS: bloco MENOR →
-- conviccao 'alta', bloco MAIOR → 'media'. jogo_ref/partida ficam null quando não dá pra casar
-- com um fixture da janela — a linha entra assim mesmo (conta no placar do analista se tiver
-- mercado_alvo e casar depois).
create table if not exists public.analista_extracoes (
  id            uuid primary key default gen_random_uuid(),
  conteudo_id   uuid not null references public.analista_conteudos(id) on delete cascade,
  analista_id   uuid not null references public.analistas(id) on delete cascade,  -- denormalizado p/ placar
  jogo_ref      text,                        -- "AAAA-MM-DD|Casa x Fora" quando mapeável
  jogo_data     date,
  partida       text,
  jogo_id       text,                        -- id do fixture quando casado com a janela
  tipo          text not null check (tipo in ('fato','opiniao','dado_citado')),
  categoria     text not null check (categoria in
                  ('desfalque','escalacao','tecnico','clima','viagem','moral','palpite','estatistica')),
  texto_resumo  text not null,
  mercado_alvo  text,                        -- chave canônica do mercado quando houver (senão null)
  direcao       text check (direcao in ('a_favor','contra','neutro')),
  conviccao     text check (conviccao in ('baixa','media','alta')),
  -- proveniência da extração: 'pipeline' (Haiku automático) ou 'manual_bootstrap' (processada à
  -- mão numa validação sem a chave). Distingue o que a máquina extraiu do que foi semeado.
  processado_por text not null default 'pipeline',
  criado_em     timestamptz not null default now()
);
create index if not exists idx_extracao_conteudo on public.analista_extracoes (conteudo_id);
create index if not exists idx_extracao_analista on public.analista_extracoes (analista_id);
create index if not exists idx_extracao_jogo on public.analista_extracoes (jogo_data, partida);
create index if not exists idx_extracao_tipo on public.analista_extracoes (tipo, categoria);

-- ── ANALISTA_PALPITES_LIQUIDADOS: espelho de sugestoes_liquidadas p/ opiniões COM mercado_alvo ─
-- Liquidação automática no cron diário: acerto por analista, e ROI virtual onde havia odd de
-- mercado. Mercados fora do nosso motor (cartões, escanteios HT) entram com odd_e_mercado=false —
-- contam no acerto, não no ROI.
create table if not exists public.analista_palpites_liquidados (
  id               uuid primary key default gen_random_uuid(),
  extracao_id      uuid not null references public.analista_extracoes(id) on delete cascade,
  analista_id      uuid not null references public.analistas(id) on delete cascade,
  data             date not null,
  jogo_id          text,
  partida          text not null,
  casa             text,
  fora             text,
  mercado          text not null,
  rotulo           text,
  familia          text,
  linha            numeric,
  direcao          text not null default 'a_favor',
  conviccao        text not null default 'media',
  no_nosso_motor   boolean not null default true,   -- false p/ cartões, escanteios HT, etc.
  odd_referencia   numeric,                          -- odd de mercado quando disponível
  odd_e_mercado    boolean not null default false,
  peso_no_registro numeric(4,1),                     -- peso do analista quando o palpite entrou
  status           text not null default 'pendente' check (status in ('pendente','ganhou','perdeu','sem_liquidacao')),
  gols_casa        integer,
  gols_fora        integer,
  escanteios_total integer,
  liquidado_em     timestamptz,
  criado_em        timestamptz not null default now(),
  unique (extracao_id)
);
create index if not exists idx_palpite_analista on public.analista_palpites_liquidados (analista_id);
create index if not exists idx_palpite_status on public.analista_palpites_liquidados (status);
create index if not exists idx_palpite_data on public.analista_palpites_liquidados (data desc);

-- ── VIEW: placar por analista (acerto, nº palpites, ROI virtual, peso) ────────────────────────
create or replace view public.analista_placar as
select
  a.id,
  a.nome,
  a.canal_youtube,
  a.ativo,
  a.peso_atual,
  count(p.id) filter (where p.status in ('ganhou','perdeu'))                        as n_liquidados,
  count(p.id) filter (where p.status = 'ganhou')                                    as n_ganhou,
  count(p.id) filter (where p.status = 'pendente')                                  as n_pendentes,
  case when count(p.id) filter (where p.status in ('ganhou','perdeu')) > 0
       then round(count(p.id) filter (where p.status = 'ganhou')::numeric
                  / count(p.id) filter (where p.status in ('ganhou','perdeu')), 4)
       else null end                                                               as acerto,
  -- ROI virtual só onde havia odd de mercado de verdade (odd_e_mercado): ganho = odd-1, perda = -1.
  coalesce(sum(
    case when p.odd_e_mercado and p.status = 'ganhou' then p.odd_referencia - 1
         when p.odd_e_mercado and p.status = 'perdeu' then -1
         else 0 end), 0)                                                            as lucro_virtual,
  count(p.id) filter (where p.odd_e_mercado and p.status in ('ganhou','perdeu'))    as n_com_odd
from public.analistas a
left join public.analista_palpites_liquidados p on p.analista_id = a.id
group by a.id, a.nome, a.canal_youtube, a.ativo, a.peso_atual;

comment on view public.analista_placar is
  'Placar por analista: n liquidados, acerto, lucro virtual (só onde havia odd de mercado), peso.';

-- ============================================================================
-- RLS — leitura autenticada em tudo; escrita da camada de ingestão é via service_role (bypassa
-- RLS). O dash gerencia analistas (add/remover/ativar) → policy de escrita só em `analistas`.
-- ============================================================================
alter table public.analistas                    enable row level security;
alter table public.analista_conteudos           enable row level security;
alter table public.analista_extracoes           enable row level security;
alter table public.analista_palpites_liquidados enable row level security;

drop policy if exists analistas_rw on public.analistas;
create policy analistas_rw on public.analistas
  for all to authenticated using (true) with check (true);

do $$
declare t text;
begin
  foreach t in array array['analista_conteudos','analista_extracoes','analista_palpites_liquidados']
  loop
    execute format($f$
      drop policy if exists %1$s_leitura on public.%1$I;
      create policy %1$s_leitura on public.%1$I for select to authenticated using (true);
    $f$, t);
  end loop;
end $$;

-- ── SEED dos 4 canais iniciais (idempotente por canal_youtube) ────────────────────────────────
insert into public.analistas (nome, canal_youtube, url, observacao) values
  ('Boleiros Tips',        '@BOLEIROSTIPS',    'https://youtube.com/@BOLEIROSTIPS',    null),
  ('Guilherme Delpino',    '@guilhermedelpino','https://youtube.com/@guilhermedelpino', null),
  ('Léo Freitas',          '@freitastipster',  'https://youtube.com/@freitastipster',
     'Cobre Série B e Sula com dados estruturados (previsões por mercado, média do árbitro, escanteios por parte). Fonte mais próxima de FATO — usa blocos MENOR/MAIOR.'),
  ('Canal do Theo Borges', '@TheoBorges',      'https://youtube.com/@TheoBorges',      null)
on conflict (canal_youtube) do nothing;
