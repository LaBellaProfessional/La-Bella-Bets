-- Cron diário do BELLA BETS: 09:00 America/Sao_Paulo = 12:00 UTC (13:00 UTC no horário de verão).
-- Rodar DEPOIS de subir as functions. Requer as extensões pg_cron e pg_net.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('bella-bets-analisar-diario')
  where exists (select 1 from cron.job where jobname = 'bella-bets-analisar-diario');

select cron.schedule(
  'bella-bets-analisar-diario',
  '0 12 * * *',
  $$
  select net.http_post(
    url     := 'https://wsbhfljopcdynwnoioxx.supabase.co/functions/v1/analisar',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || current_setting('app.service_key', true)),
    body    := jsonb_build_object('disparo','cron')
  );
  $$
);

-- Refit semanal do Dixon-Coles (domingo 08:00 SP = 11:00 UTC): o ajuste é caro,
-- a análise diária só lê os parâmetros de modelo_params.
select cron.schedule(
  'bella-bets-refit-semanal',
  '0 11 * * 0',
  $$
  select net.http_post(
    url     := 'https://wsbhfljopcdynwnoioxx.supabase.co/functions/v1/bootstrap',
    headers := jsonb_build_object(
                 'Content-Type','application/json',
                 'Authorization','Bearer ' || current_setting('app.service_key', true)),
    body    := jsonb_build_object('refit', true, 'disparo','cron')
  );
  $$
);

select jobid, jobname, schedule, active from cron.job order by jobname;

-- 21/07: coleta semanal de escanteios, domingo 10:30 UTC (07:30 SP), meia hora antes do
-- refit do Dixon-Coles. Uma invocação com lote 60 cobre a semana com folga: as 3 ligas somam
-- ~30 jogos novos por rodada, e a function é idempotente (jogo já coletado não volta a ser
-- buscado). O bootstrap inicial de 446 jogos foi feito manualmente.
select cron.schedule('bella-bets-escanteios-semanal', '30 10 * * 0', $$
  select net.http_post(
    url:='https://wsbhfljopcdynwnoioxx.supabase.co/functions/v1/bootstrap-escanteios',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
      (select decrypted_secret from vault.decrypted_secrets where name='bella_service_key')),
    body:=jsonb_build_object('ligas',jsonb_build_array(72,71,98),'por_liga',150,'lote',60,'disparo','cron'));
$$);

-- 22/07: liquidação diária das sugestões (paper trading), 12:30 UTC (09:30 SP), 30 min
-- depois do analisar. Liquida contra o placar real; busca por ID de fixture (não por data,
-- que cairia na armadilha de fuso). Idempotente: só toca em status='pendente'.
select cron.schedule('bella-bets-liquidar-sugestoes', '30 12 * * *', $$
  select net.http_post(
    url:='https://wsbhfljopcdynwnoioxx.supabase.co/functions/v1/liquidar-sugestoes',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
      (select decrypted_secret from vault.decrypted_secrets where name='bella_service_key')),
    body:=jsonb_build_object('disparo','cron'));
$$);
