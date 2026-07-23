-- ============================================================================
-- BELLA BETS — migração "CONCILIAÇÃO COM A CASA" — Parte 2
-- Princípio (igual ao labella): o saldo da casa é autoritativo; casar e unificar, nunca duplicar.
-- O ajuste da banca vira um evento auditado em bilhete_eventos, com valores antes/depois.
-- Aplicar no SQL editor do bella-bets. Idempotente.
-- ============================================================================

-- Um ajuste de banca não está preso a um bilhete: bilhete_id passa a aceitar NULL e ganha um
-- `tipo` pra distinguir 'resultado' (transição de aposta, o que já existia) de 'ajuste_banca'.
alter table public.bilhete_eventos alter column bilhete_id drop not null;
alter table public.bilhete_eventos add column if not exists tipo text not null default 'resultado';

do $$ begin
  alter table public.bilhete_eventos drop constraint if exists bilhete_eventos_tipo_check;
  alter table public.bilhete_eventos add constraint bilhete_eventos_tipo_check
    check (tipo in ('resultado','ajuste_banca'));
end $$;

comment on column public.bilhete_eventos.tipo is
  'resultado (transição de aposta) | ajuste_banca (conciliação com a casa — de/para em R$, detalhe com saldo).';
