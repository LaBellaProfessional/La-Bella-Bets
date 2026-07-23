import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularNota } from '../supabase/functions/_shared/nota.js';

// Perna "um olho só": sem odd de mercado, sem Dixon-Coles, não escanteio (o caso Santa Fe x Caracas).
const umOlho = {
  mercado: 'dupla_chance_fora', sem_odd_referencia: true,
  prob_heuristica: 0.90, prob_dixon_coles: null, prob_final: 0.86,
  amostra_mando: 6, horizonte_dias: 0, ev_pct: null,
};

test('NOTA — "um olho só" (sem odd + sem DC + não escanteio) nunca passa de 40', () => {
  const { nota } = calcularNota(umOlho, { mandoPleno: 7 });
  assert.ok(nota <= 40, `nota ${nota} deve ser ≤ 40 (fica no EXPLORAR)`);
});

test('NOTA — com Dixon-Coles conferindo, o teto de 40 NÃO se aplica', () => {
  // mesma perna, mas agora com 2º modelo concordando → pode passar de 40.
  const comDC = { ...umOlho, sem_odd_referencia: false, prob_dixon_coles: 0.88, ev_pct: 8 };
  const { nota } = calcularNota(comDC, { mandoPleno: 7 });
  assert.ok(nota > 40, `com DC a nota (${nota}) sobe acima de 40`);
});

test('NOTA — escanteio (sem odd, sem DC) mantém o tratamento próprio, não o teto 40', () => {
  const esc = { mercado: 'esc_over_95', sem_odd_referencia: true, prob_heuristica: null, prob_dixon_coles: null, prob_final: 0.80, amostra_mando: 7, horizonte_dias: 0 };
  const { nota } = calcularNota(esc, { mandoPleno: 7 });
  // escanteio cheio ~52 (0 concord + 15 ev + 20 amostra + 7 maturidade + 10 horizonte) — acima de 40.
  assert.ok(nota > 40, `escanteio (${nota}) segue a régua própria, não o teto do um-olho`);
});
