-- ============================================================================
-- BELLA BETS — migração "APOSTA DO MAIKON (FARO)" — Parte B
-- O faro do capitão ganha porta própria: registrar QUALQUER mercado avaliado, mesmo o que o
-- método não aprovou, com o snapshot do que o método diria — pra saber CONTRA O QUÊ o faro acertou.
-- Aplicar no SQL editor do bella-bets (wsbhfljopcdynwnoioxx). Idempotente.
-- ============================================================================

-- Proveniência da entrada. 'metodo' = fluxo normal da Início (default, retrocompatível com tudo
-- que já existe); 'maikon_faro' = registrado por convicção própria fora do método; 'analistas' =
-- entrada ressuscitada pelo consenso dos analistas (Parte A, cláusula da ressurreição).
alter table public.bilhetes
  add column if not exists origem text not null default 'metodo';

do $$ begin
  alter table public.bilhetes drop constraint if exists bilhetes_origem_check;
  alter table public.bilhetes add constraint bilhetes_origem_check
    check (origem in ('metodo','maikon_faro','analistas'));
end $$;

-- Foto do estado do MÉTODO no momento do faro: veredito (aprovada|radar|reprovada|aguarda_odd|
-- sem_modelo), motivo, D-N até o jogo, odd justa, prob do modelo, nota. É o que permite medir o
-- faro CONTRA o método — o breakdown por "motivo contrariado" sai daqui.
alter table public.bilhetes
  add column if not exists snapshot_metodo jsonb;

create index if not exists bilhetes_origem_idx on public.bilhetes (origem);

comment on column public.bilhetes.origem is
  'Proveniência: metodo (fluxo normal) · maikon_faro (convicção própria) · analistas (ressurreição).';
comment on column public.bilhetes.snapshot_metodo is
  'Estado do método no momento do faro (veredito, motivo, D-N, odd justa, prob, nota). Ver Parte B.';
