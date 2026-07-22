-- ============================================================================
-- BELLA BETS — migração "APOSTAS" (22/07)
-- Aba Apostas (acompanhar) + desfazer/corrigir em qualquer estado + rascunho persistente.
-- Aplicar no SQL editor do projeto bella-bets (wsbhfljopcdynwnoioxx). Idempotente.
-- ============================================================================

-- 1) bilhetes.resultado passa a aceitar 'cancelada'.
--    "Não apostei" e "desfazer" NÃO deletam a linha — gravam 'cancelada' (auditoria).
--    A aposta cancelada some da aba Apostas e não afeta banca nem estatísticas.
alter table public.bilhetes drop constraint if exists bilhetes_resultado_check;
alter table public.bilhetes add constraint bilhetes_resultado_check
  check (resultado in ('pendente','ganhou','perdeu','cancelada'));

-- 2) AUDITORIA — cada mudança de estado vira uma linha, com timestamp.
--    registrada→cancelada, ganhou→perdeu (corrigir), pendente→ganhou, etc.
create table if not exists public.bilhete_eventos (
  id           uuid primary key default gen_random_uuid(),
  bilhete_id   uuid not null references public.bilhetes(id) on delete cascade,
  de           text,
  para         text not null,
  em           timestamptz not null default now()
);
create index if not exists bilhete_eventos_bilhete_idx on public.bilhete_eventos (bilhete_id, em);
alter table public.bilhete_eventos enable row level security;
drop policy if exists bilhete_eventos_autenticado on public.bilhete_eventos;
create policy bilhete_eventos_autenticado on public.bilhete_eventos
  for all to authenticated using (true) with check (true);

-- 3) RASCUNHO persistente dos campos da Início (odd da casa + stake).
--    Bug que resolve: no iPhone o PWA recarrega ao alternar apps (conferir a odd na casa e
--    voltar), e os campos digitados sumiam. Salvar no Supabase — não localStorage — sincroniza
--    iPhone↔PC. A chave é a MESMA identidade de entrada da Início: data + conjunto de
--    (partida·mercado) ordenado. Degenera em (data, jogo, mercado) para entrada simples.
--    Morre sozinho: apagado ao registrar (no app) e varrido após 48h pelo cron abaixo.
create table if not exists public.rascunhos (
  chave         text primary key,
  data          date not null,
  partida       text,
  mercado       text,
  odd_casa      text,
  stake         numeric(12,2),
  atualizado_em timestamptz not null default now()
);
create index if not exists rascunhos_atualizado_idx on public.rascunhos (atualizado_em);
alter table public.rascunhos enable row level security;
drop policy if exists rascunhos_autenticado on public.rascunhos;
create policy rascunhos_autenticado on public.rascunhos
  for all to authenticated using (true) with check (true);

-- 4) CRON — varredura de rascunhos vencidos (48h), diária 12:05 UTC (junto do analisar).
--    Requer pg_cron (já habilitado pelo cron.sql). Se rodar fora do editor com pg_cron ausente,
--    ignore este bloco — o app também apaga o rascunho ao registrar.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('bella-bets-limpar-rascunhos')
      where exists (select 1 from cron.job where jobname = 'bella-bets-limpar-rascunhos');
    perform cron.schedule('bella-bets-limpar-rascunhos', '5 12 * * *',
      $cron$ delete from public.rascunhos where atualizado_em < now() - interval '48 hours'; $cron$);
  end if;
end $$;
