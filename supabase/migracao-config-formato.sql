-- ============================================================================
-- BELLA BETS — migração "FORMATO UNIFICADO DO CONFIG" (22/07)
-- Converte os filtros de natureza percentual pro formato % INTEIRO (o motor passa a ler assim,
-- ver _shared/filtros.js) e remove o campo MORTO da duplicidade do mando.
-- Aplicar JUNTO com o deploy do motor. Idempotente (guarda pelo formato antigo).
-- ============================================================================

-- Multiplicador (1.03 → 3) pra ev_minimo/ev_minimo_antecipado; fração (0.35 → 35) pro resto.
-- A guarda `ev_minimo < 2` garante que só converte quando ainda está no formato ANTIGO — rodar
-- de novo depois (ev_minimo = 3) não re-converte.
update public.config
set filtros = (filtros
  || jsonb_build_object(
       'ev_minimo',             round(((filtros->>'ev_minimo')::numeric - 1) * 100),
       'ev_minimo_antecipado',  round(((filtros->>'ev_minimo_antecipado')::numeric - 1) * 100),
       'ev_teto_suspeito',      round((filtros->>'ev_teto_suspeito')::numeric * 100),
       'confianca_maxima_ev',   round((filtros->>'confianca_maxima_ev')::numeric * 100),
       'escanteios_prob_minima',round((filtros->>'escanteios_prob_minima')::numeric * 100),
       'confianca_maxima_prob', round((filtros->>'confianca_maxima_prob')::numeric * 100)
     ))
  - 'amostra_minima_mando'   -- campo MORTO: o motor lê mando_minimo (5); este 6 nunca era usado
where id = 1
  and (filtros->>'ev_minimo')::numeric < 2;  -- só no formato antigo (1.03); não re-converte 3
