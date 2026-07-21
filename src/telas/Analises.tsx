import { useState } from 'react';
import { pct, ROTULO, type Analise } from '../dados';
import { Vazio } from './Hoje';

/**
 * Transparência total: todo jogo analisado, aprovado ou descartado, com prob heurística ×
 * Dixon-Coles × odd lado a lado. Descarte sem motivo visível é o que faz alguém desconfiar
 * do método e apostar no impulso.
 */
export function Analises({ analise }: { analise: Analise | null }) {
  const [verDescartadas, setVerDescartadas] = useState(true);
  if (!analise) return <Vazio titulo="Nada analisado nesta data">Rode o motor para esta data.</Vazio>;

  const resumo = analise.resumo ?? { jogos: 0, aprovadas: 0, descartadas: 0 } as Analise["resumo"];
  const porJogo = (analise.jogos ?? []).map((j) => ({
    jogo: j,
    pernas: (analise.pernas ?? []).filter((p) => p.jogo_id === j.id),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-borda bg-card px-4 py-3 text-sm">
        <span className="text-t2">
          <b className="text-t1">{resumo.jogos}</b> jogos ·{' '}
          <b className="text-verde">{resumo.aprovadas}</b> pernas aprovadas ·{' '}
          <b className="text-t3">{resumo.descartadas}</b> descartadas
        </span>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-t2">
          <input type="checkbox" checked={verDescartadas} onChange={(e) => setVerDescartadas(e.target.checked)} />
          mostrar descartadas
        </label>
      </div>

      {analise.config_efetivo && (
        <div className="rounded-lg border border-borda bg-card px-4 py-2 text-xs text-t3">
          Parâmetros desta análise: perna ≥ {analise.config_efetivo.filtros.odd_minima_perna} ·
          bilhete {analise.config_efetivo.filtros.odd_bilhete_min}–{analise.config_efetivo.filtros.odd_bilhete_max} ·
          EV mín {((analise.config_efetivo.filtros.ev_minimo - 1) * 100).toFixed(0)}% ·
          divergência máx {analise.config_efetivo.filtros.divergencia_maxima_pp} p.p.
        </div>
      )}

      <div className="rounded-lg border border-borda bg-card p-3">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-t3">Dixon-Coles por liga</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(analise.dixon_coles_por_liga ?? {}).map(([liga, m]) => (
            <span key={liga}
              className={`rounded px-2 py-1 text-xs ${m.disponivel ? 'bg-verde/10 text-verde' : 'bg-ambar/10 text-ambar'}`}
              title={m.motivo ?? ''}>
              {m.disponivel ? '✓' : '✗'} {liga} {m.disponivel ? `(${m.n_jogos})` : '— só heurística'}
            </span>
          ))}
        </div>
      </div>

      {porJogo.map(({ jogo, pernas }) => {
        const visiveis = verDescartadas ? pernas : pernas.filter((p) => p.aprovada);
        if (!visiveis.length) return null;
        return (
          <div key={jogo.id} className="overflow-hidden rounded-xl border border-borda bg-card">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-borda px-4 py-3">
              <span className="font-medium text-t1">{jogo.casa} <span className="text-t3">x</span> {jogo.fora}</span>
              <span className="text-xs text-t3">{jogo.liga} · {jogo.hora}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-t3">
                    <th className="px-4 py-2 font-medium">Mercado</th>
                    <th className="px-2 py-2 font-medium">Heurística</th>
                    <th className="px-2 py-2 font-medium">Dixon-Coles</th>
                    <th className="px-2 py-2 font-medium">Odd</th>
                    <th className="px-2 py-2 font-medium">EV</th>
                    <th className="px-4 py-2 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((p, i) => (
                    <tr key={i} className={`border-t border-borda/60 ${p.aprovada ? '' : 'opacity-60'}`}>
                      <td className="px-4 py-2 text-t1">{ROTULO[p.mercado] ?? p.mercado}</td>
                      <td className="px-2 py-2 text-t2">{pct(p.prob_heuristica)}</td>
                      <td className="px-2 py-2 text-t2">{p.prob_dixon_coles == null ? '—' : pct(p.prob_dixon_coles)}</td>
                      <td className="px-2 py-2 font-mono text-t2">{p.odd ?? '—'}</td>
                      <td className={`px-2 py-2 ${(p.ev ?? 0) > 1 ? 'text-verde' : 'text-t3'}`}>
                        {p.ev == null ? '—' : `${((p.ev - 1) * 100).toFixed(1)}%`}
                      </td>
                      <td className="px-4 py-2">
                        {p.aprovada ? (
                          <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            p.confianca === 'CONFIANCA_MAXIMA' ? 'bg-verde/15 text-verde' : 'bg-azul/15 text-azul'}`}>
                            {p.confianca === 'CONFIANCA_MAXIMA' ? 'confiança máxima' : 'aprovada'}
                          </span>
                        ) : (
                          <span className="text-xs text-t3">{p.motivo}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
