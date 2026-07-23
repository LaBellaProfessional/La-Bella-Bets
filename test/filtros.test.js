import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avaliarPerna } from '../supabase/functions/_shared/filtros.js';

const JOGO = { id: 'j1', casa: 'Bolívar', fora: 'Grêmio', liga: 'Copa Sul-Americana', hora: '21:30' };
const FILTROS = {
  odd_minima_perna: 1.1, ev_minimo: 3, divergencia_maxima_pp: 10,
  mando_minimo: 5, mando_pleno: 7, convicao_minima_sem_odd: 60,
  odd_justa_minima_sem_odd: 1.25, gatilho_1x2: 72,
  mercados_em_bilhete: ['dupla_chance_casa', 'over_15'],
};

const base = (over) => ({
  jogo: JOGO, mercado: 'over_15', odd: null,
  probH: over, probDC: over, probPush: 0, amostraMando: 10,
  filtros: FILTROS, permitirSemOdd: true,
});

test('PARTE C — prêmio improvável (justa < piso) NÃO reprova mais: aprovada + aguarda_odd', () => {
  // prob 0.86 → justa ~1.16 < 1.25. Antes: aprovada=false, PREMIO_INEXISTENTE. Agora: recolhida.
  const p = avaliarPerna(base(0.86));
  assert.equal(p.aprovada, true, 'deve aprovar — o corte não bloqueia mais');
  assert.equal(p.aguarda_odd, true, 'deve marcar aguarda_odd (organiza a tela)');
  assert.equal(p.sem_odd_referencia, true, 'segue sendo sem odd de mercado');
  assert.ok(p.odd_justa < 1.25, `justa (${p.odd_justa}) abaixo do piso`);
  assert.equal(p.elegivel_bilhete, false, 'sem odd nunca entra em combinada');
  assert.match(p.justificativa, /improvável/i);
});

test('PARTE C — prêmio plausível (justa >= piso) aprova SEM aguarda_odd (fluxo normal)', () => {
  // prob 0.70 → justa ~1.43 >= 1.25 → entra no fluxo normal, sem recolher.
  const p = avaliarPerna(base(0.70));
  assert.equal(p.aprovada, true);
  assert.equal(p.aguarda_odd, false, 'acima do piso não recolhe');
  assert.ok(p.odd_justa >= 1.25);
});

test('PARTE C — convicção abaixo do piso ainda REPROVA (o corte de baixa convicção continua)', () => {
  const p = avaliarPerna(base(0.50)); // 50% < 60% piso
  assert.equal(p.aprovada, false, 'convicção baixa segue reprovando');
  assert.ok(p.motivo, 'tem motivo de descarte');
  assert.equal(p.aguarda_odd, undefined, 'reprovada não ganha aguarda_odd');
});

test('PARTE C — sem permitirSemOdd, jogo sem linha segue descartado (paridade preservada)', () => {
  const p = avaliarPerna({ ...base(0.86), permitirSemOdd: false });
  assert.equal(p.aprovada, false);
});
