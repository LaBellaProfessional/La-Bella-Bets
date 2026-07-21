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
