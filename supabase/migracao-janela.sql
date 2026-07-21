-- ── TRAJETÓRIA DA ODD ───────────────────────────────────────────────────────
-- Pilar timing: o mesmo jogo é reanalisado D+3, D+2, D+1, D+0. Guardar como a linha
-- se moveu é o que permite saber se pegamos preço bom ou se o mercado corrigiu contra.
create table if not exists public.odds_trajetoria (
  jogo_id          text not null,
  mercado          text not null,
  partida          text,
  liga             text,
  data_jogo        date,
  primeira_odd     numeric(8,3) not null,
  primeira_vista_em timestamptz not null default now(),
  melhor_odd       numeric(8,3) not null,
  melhor_vista_em  timestamptz not null default now(),
  odd_atual        numeric(8,3) not null,
  n_observacoes    int not null default 1,
  atualizado_em    timestamptz not null default now(),
  primary key (jogo_id, mercado)
);
alter table public.odds_trajetoria enable row level security;
drop policy if exists odds_trajetoria_autenticado on public.odds_trajetoria;
create policy odds_trajetoria_autenticado on public.odds_trajetoria
  for all to authenticated using (true) with check (true);

-- Registra uma observação de odd. A lógica de "primeira" e "melhor" mora aqui, num lugar
-- só — se ficasse no motor, cada caminho (cron, botão, refit) poderia divergir.
create or replace function public.registrar_odd(
  p_jogo_id text, p_mercado text, p_odd numeric,
  p_partida text default null, p_liga text default null, p_data_jogo date default null
) returns void language sql security definer set search_path to public as $$
  insert into odds_trajetoria as t
    (jogo_id, mercado, partida, liga, data_jogo, primeira_odd, melhor_odd, odd_atual)
  values (p_jogo_id, p_mercado, p_partida, p_liga, p_data_jogo, p_odd, p_odd, p_odd)
  on conflict (jogo_id, mercado) do update set
    odd_atual       = excluded.odd_atual,
    melhor_odd      = greatest(t.melhor_odd, excluded.odd_atual),
    melhor_vista_em = case when excluded.odd_atual > t.melhor_odd then now() else t.melhor_vista_em end,
    n_observacoes   = t.n_observacoes + 1,
    atualizado_em   = now();
$$;
