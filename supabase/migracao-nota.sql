-- ============================================================================
-- BELLA BETS — migração "NOTA DE CONFIANÇA" (22/07)
-- Nota 0-100 determinística por sugestão, pro corte por faixa na calibração.
-- Aplicar no SQL editor do bella-bets (wsbhfljopcdynwnoioxx). Idempotente.
-- ============================================================================

-- A nota vive na análise (payload.pernas[].nota) e aqui, pra o breakdown por faixa (80+/60-79/<60)
-- na aba Histórico: acerto real vs prometido e ROI virtual por faixa, com dados reais.
alter table public.sugestoes_liquidadas add column if not exists nota int;
alter table public.sugestoes_liquidadas add column if not exists nota_componentes jsonb;

comment on column public.sugestoes_liquidadas.nota is
  'Nota de confiança 0-100 (solidez da oportunidade, não chance de ganhar). Ver _shared/nota.js.';
