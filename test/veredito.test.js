// Veredito da odd digitada — guarda de regressão da INVERSÃO (bug 22/07): odd ACIMA do justo era
// lida como "sem valor" porque o dash comparava o múltiplo de EV (~1.17) contra a margem em % (3).
// Roda com: npm test  (node --test, sem dependência).
//
// Cobre os DOIS sentidos (odd acima do justo = vale; abaixo = sumiu) nos TRÊS modos que usam o
// mesmo veredito: COM linha, SEM linha (odd-manual) e ESCANTEIOS. Os modos só diferem na origem
// de prob/odd — a regra é uma só, então testamos a regra com os valores típicos de cada um.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vereditoOdd } from '../supabase/functions/_shared/veredito.js';

const EV = 3; // ev_minimo em % (padrão do formato unificado)

test('COM linha — odd acima do justo VALE (caso do bug: Corinthians under 2.5)', () => {
  // prob 61% → justo @1.64; odd digitada 1.92 paga bem acima → tem que valer.
  const v = vereditoOdd({ prob: 0.61, odd: 1.92, evMinimoPct: EV });
  assert.equal(v.vale, true, 'odd 1.92 acima do justo 1.64 deve VALER');
  assert.ok(Math.abs(v.justo - 1.64) < 0.01);
  assert.ok(v.ganhoPct > 15, `ganho esperado ~17%, veio ${v.ganhoPct.toFixed(1)}%`);
});

test('COM linha — odd abaixo do justo NÃO vale', () => {
  // prob 61% → justo @1.64; odd 1.50 abaixo do justo → sem vantagem.
  const v = vereditoOdd({ prob: 0.61, odd: 1.50, evMinimoPct: EV });
  assert.equal(v.vale, false, 'odd 1.50 abaixo do justo 1.64 NÃO deve valer');
  assert.ok(v.ganhoPct < 0);
});

test('SEM linha (odd-manual) — odd acima do justo VALE (caso do bug: Athletic DC fora)', () => {
  // prob 72% → justo @1.39; odd digitada 1.85 → vale.
  const v = vereditoOdd({ prob: 0.72, odd: 1.85, evMinimoPct: EV });
  assert.equal(v.vale, true, 'odd 1.85 acima do justo 1.39 deve VALER');
  assert.ok(Math.abs(v.justo - 1.389) < 0.01);
});

test('SEM linha (odd-manual) — odd abaixo do justo NÃO vale', () => {
  const v = vereditoOdd({ prob: 0.72, odd: 1.30, evMinimoPct: EV });
  assert.equal(v.vale, false, 'odd 1.30 abaixo do justo 1.39 NÃO deve valer');
});

test('ESCANTEIOS — odd acima do justo VALE', () => {
  // prob 63% → justo @1.59; odd 1.75 → vale.
  const v = vereditoOdd({ prob: 0.63, odd: 1.75, evMinimoPct: EV });
  assert.equal(v.vale, true, 'odd 1.75 acima do justo 1.59 deve VALER');
});

test('ESCANTEIOS — odd abaixo do justo NÃO vale', () => {
  const v = vereditoOdd({ prob: 0.63, odd: 1.40, evMinimoPct: EV });
  assert.equal(v.vale, false, 'odd 1.40 abaixo do justo 1.59 NÃO deve valer');
});

test('margem mínima: exatamente no justo NÃO vale (ganho 0% < 3%)', () => {
  const v = vereditoOdd({ prob: 0.5, odd: 2.0, evMinimoPct: EV });
  assert.equal(v.vale, false, 'odd = justo tem ganho 0%, abaixo da margem de 3%');
});

test('margem mínima: exatamente 3% de ganho VALE (fronteira inclusiva)', () => {
  // prob 0.5, odd 2.06 → prob*odd = 1.03 → ganho 3% == margem.
  const v = vereditoOdd({ prob: 0.5, odd: 2.06, evMinimoPct: EV });
  assert.equal(v.vale, true, 'ganho exatamente 3% deve valer (>=)');
});

test('odd ainda não digitada (odd<=1) NÃO vale — dash mostra "Digite a odd"', () => {
  assert.equal(vereditoOdd({ prob: 0.61, odd: 0, evMinimoPct: EV }).vale, false);
  assert.equal(vereditoOdd({ prob: 0.61, odd: 1, evMinimoPct: EV }).vale, false);
});

test('entradas inválidas não quebram (prob/odd não-finitos → justo 0, não vale)', () => {
  const v = vereditoOdd({ prob: NaN, odd: 1.9, evMinimoPct: EV });
  assert.equal(v.vale, false);
  assert.equal(v.justo, 0);
});

test('a inversão do bug não volta: múltiplo de EV NUNCA é comparado contra a margem em %', () => {
  // Se alguém reintroduzir `valorNaOdd >= evMinimo`, este caso (valorNaOdd 1.17 < 3) falharia.
  const v = vereditoOdd({ prob: 0.61, odd: 1.92, evMinimoPct: EV });
  assert.equal(v.vale, true, 'regressão: odd boa lida como sem valor = veredito invertido');
});
