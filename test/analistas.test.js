import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ajusteDaPerna, aplicarAjusteNota, fatosConsensuais, ressurreicoesPossiveis,
  recalibrarPeso, mercadoNoNossoMotor, palpiteDaExtracao, liquidarPalpiteAnalista, indexarExtracoes,
} from '../supabase/functions/_shared/analistas.js';

const op = (analista_id, direcao, conviccao, mercado = 'dupla_chance_casa') => ({
  id: `e-${analista_id}-${direcao}`, tipo: 'opiniao', analista_id, direcao, conviccao,
  mercado_alvo: mercado, partida: 'Bahia x Vitória', jogo_id: 'j1', texto_resumo: 't',
});

test('mercadoNoNossoMotor — cobre resultado/gols/escanteios/AH; fora fica de fora', () => {
  for (const m of ['dupla_chance_casa', 'resultado_fora', 'over_25', 'esc_over_95', 'ah_casa_m10'])
    assert.equal(mercadoNoNossoMotor(m), true, m);
  for (const m of ['cartoes_over_45', 'ht_over_05', '', null])
    assert.equal(mercadoNoNossoMotor(m), false, String(m));
});

test('ajuste — 1 analista a favor limita a +4', () => {
  const perna = { mercado: 'dupla_chance_casa' };
  const { ajuste } = ajusteDaPerna(perna, [op('a1', 'a_favor', 'alta')], { a1: 8 });
  assert.equal(ajuste, 4, 'um analista, mesmo convicção alta, teto +4');
});

test('ajuste — consenso 2+ a favor chega a +8', () => {
  const perna = { mercado: 'dupla_chance_casa' };
  const ops = [op('a1', 'a_favor', 'media'), op('a2', 'a_favor', 'media')];
  const { ajuste, componentes } = ajusteDaPerna(perna, ops, { a1: 8, a2: 8 });
  assert.equal(ajuste, 8);
  assert.equal(componentes.consenso, true);
});

test('ASSIMETRIA — consenso contra freia mais que a favor empurra (−12 possível)', () => {
  const perna = { mercado: 'dupla_chance_casa' };
  const ops = [op('a1', 'contra', 'alta'), op('a2', 'contra', 'alta'), op('a3', 'contra', 'alta')];
  const { ajuste } = ajusteDaPerna(perna, ops, { a1: 8, a2: 8, a3: 8 });
  assert.equal(ajuste, -12, 'contra pode chegar a −12; a favor só a +8');
});

test('ajuste — mercado fora do motor não modula', () => {
  const perna = { mercado: 'cartoes_over_45' };
  const ops = [op('a1', 'a_favor', 'alta', 'cartoes_over_45'), op('a2', 'a_favor', 'alta', 'cartoes_over_45')];
  assert.equal(ajusteDaPerna(perna, ops, {}).ajuste, 0);
});

test('TRAVA DO VERDE — ajuste positivo não leva sozinho de <80 pra 80+', () => {
  const r = aplicarAjusteNota(76, 8);   // 76 + 8 = 84 → travado em 79
  assert.equal(r.nota, 79);
  assert.equal(r.teto_solida, true);
  // Já sólida por mérito do modelo: ajuste positivo pode somar normalmente.
  assert.equal(aplicarAjusteNota(82, 6).nota, 88);
  // Ajuste negativo nunca é travado.
  assert.equal(aplicarAjusteNota(84, -12).nota, 72);
});

test('FATOS CONSENSUAIS — 2 analistas mesma categoria/jogo <48h viram consenso; contradição detectada', () => {
  const agora = Date.parse('2026-07-24T12:00:00Z');
  const fato = (a, extra = {}) => ({
    analista_id: a, tipo: 'fato', categoria: 'desfalque', partida: 'Bolívar x Grêmio',
    texto_resumo: 'zagueiro titular fora', criado_em: '2026-07-24T00:00:00Z', ...extra,
  });
  const cons = fatosConsensuais(
    [fato('a1', { direcao: 'contra', mercado_alvo: 'resultado_casa', jogo_id: 'jx' }), fato('a2')],
    agora,
  );
  assert.equal(cons.length, 1);
  assert.equal(cons[0].n_analistas, 2);
  assert.equal(cons[0].contra[0].mercado, 'resultado_casa');
});

test('FATOS — fora de 48h não conta consenso', () => {
  const agora = Date.parse('2026-07-24T12:00:00Z');
  const velho = { analista_id: 'a1', tipo: 'fato', categoria: 'desfalque', partida: 'X x Y', texto_resumo: 't', criado_em: '2026-07-20T00:00:00Z' };
  const novo = { analista_id: 'a2', tipo: 'fato', categoria: 'desfalque', partida: 'X x Y', texto_resumo: 't', criado_em: '2026-07-24T06:00:00Z' };
  assert.equal(fatosConsensuais([velho, novo], agora).length, 0);
});

test('RESSURREIÇÃO — só reprovada por divergência + 3 fontes convicção alta a favor', () => {
  const { porMercado } = indexarExtracoes([
    op('a1', 'a_favor', 'alta'), op('a2', 'a_favor', 'alta'), op('a3', 'a_favor', 'alta'),
  ]);
  const reprovadas = [
    { jogo_id: 'j1', partida: 'Bahia x Vitória', mercado: 'dupla_chance_casa', motivo: 'modelos divergem: heurística 70% × Dixon-Coles 55% (limite 10 p.p.)' },
    { jogo_id: 'j1', partida: 'Bahia x Vitória', mercado: 'over_25', motivo: 'EV abaixo da margem mínima' }, // não é divergência
  ];
  const res = ressurreicoesPossiveis(reprovadas, porMercado);
  assert.equal(res.length, 1);
  assert.equal(res[0].mercado, 'dupla_chance_casa');
  assert.equal(res[0].n_fontes, 3);
});

test('RESSURREIÇÃO — 2 fontes não bastam', () => {
  const { porMercado } = indexarExtracoes([op('a1', 'a_favor', 'alta'), op('a2', 'a_favor', 'alta')]);
  const reprovadas = [{ jogo_id: 'j1', partida: 'Bahia x Vitória', mercado: 'dupla_chance_casa', motivo: 'modelos divergem' }];
  assert.equal(ressurreicoesPossiveis(reprovadas, porMercado).length, 0);
});

test('PESO DINÂMICO — <30 palpites mantém; acima do implícito sobe; nunca zera', () => {
  assert.equal(recalibrarPeso({ acerto: 0.9, implicitoMedio: 0.5, nComOdd: 10, pesoAtual: 8 }).mudou, false);
  const sobe = recalibrarPeso({ acerto: 0.70, implicitoMedio: 0.55, nComOdd: 40, pesoAtual: 8 });
  assert.ok(sobe.peso > 8, `subiu (${sobe.peso})`);
  const desce = recalibrarPeso({ acerto: 0.20, implicitoMedio: 0.60, nComOdd: 40, pesoAtual: 8 });
  assert.ok(desce.peso >= 2, 'nunca abaixo de 2');
  assert.ok(desce.peso < 8);
});

test('PALPITE + LIQUIDAÇÃO — direção a_favor e contra liquidam certo', () => {
  const e = { id: 'e1', tipo: 'opiniao', analista_id: 'a1', mercado_alvo: 'over_25', partida: 'A x B', jogo_id: 'j1', jogo_data: '2026-07-24', direcao: 'a_favor', conviccao: 'media' };
  const p = palpiteDaExtracao(e, { oddReferencia: 1.8 });
  assert.equal(p.no_nosso_motor, true);
  assert.equal(p.odd_e_mercado, true);
  // 3 gols > 2.5 → over bateu → a_favor ganhou
  assert.equal(liquidarPalpiteAnalista(p, { golsCasa: 2, golsFora: 1 }), 'ganhou');
  // contra o over: mesma partida, direção contra → perdeu quando o over bate
  const pc = palpiteDaExtracao({ ...e, id: 'e2', direcao: 'contra' }, {});
  assert.equal(liquidarPalpiteAnalista(pc, { golsCasa: 2, golsFora: 1 }), 'perdeu');
  // fora do motor não liquida
  const pf = palpiteDaExtracao({ ...e, id: 'e3', mercado_alvo: 'cartoes_over_45' }, {});
  assert.equal(liquidarPalpiteAnalista(pf, { golsCasa: 2, golsFora: 1 }), 'sem_liquidacao');
});
