import { useState } from 'react';
import {
  mercadoHumano, faixaNota, explicarNota, familiaDoMercado,
  type Analise, type Perna,
} from '../dados';
import {
  vereditoDoJogo, porqueDoJogo, chipDoMercado, TabelaNumeros, type Contagens,
} from '../telas/Analises';
import { SecaoContextoAnalistas } from './ContextoAnalistas';

/**
 * DRILL-DOWN DO JOGO ("ver análise completa") — o andar de baixo (A Grande Simplificação).
 * Absorve a antiga aba Análises, mas POR JOGO: veredito narrado, todas as entradas
 * (aprovadas / esperar / reprovadas com motivo traduzido), contexto completo dos analistas,
 * nota decomposta e o toggle "ver números" com o detalhe técnico integral. Nada se perde —
 * só desce um andar. Overlay de tela cheia; o topo tem "voltar".
 */
export function DrilldownJogo({
  analise, jogoId, onFechar,
}: {
  analise: Analise; jogoId: string; onFechar: () => void;
}) {
  const [verNumeros, setVerNumeros] = useState(false);
  const jogo = (analise.jogos ?? []).find((j) => j.id === jogoId);
  const pernas = (analise.pernas ?? []).filter((p) => p.jogo_id === jogoId);
  if (!jogo) return null;

  const contexto = analise.analistas_por_jogo?.[`${jogo.casa} x ${jogo.fora}`];
  const veredito = vereditoDoJogo(pernas);
  const porque = porqueDoJogo((jogo as { contagens?: Contagens }).contagens, jogo.casa);

  // Ordem de leitura: aprovada agora, esperar (radar), reprovada.
  const ordem = (p: Perna) => (p.aprovada && !p.radar ? 0 : p.radar ? 1 : 2);
  const ordenadas = [...pernas].sort((a, b) => ordem(a) - ordem(b));
  const temConteudo = (p: Perna) => p.odd != null || Boolean(p.sem_odd_referencia);

  return (
    <div className="safe-top safe-bottom fixed inset-0 z-40 overflow-y-auto bg-fundo">
      <header className="sticky top-0 z-10 border-b border-borda bg-fundo/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <button onClick={onFechar} className="flex items-center gap-1 text-sm text-t2" aria-label="voltar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="m15 18-6-6 6-6" />
            </svg>
            voltar
          </button>
          <span className="ml-auto text-xs text-t3">análise completa</span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-4 py-5">
        <div className="rounded-xl border border-borda bg-card px-4 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-base font-semibold text-t1">{jogo.casa} <span className="text-t3">x</span> {jogo.fora}</span>
            <span className="text-xs text-t3">{jogo.liga} · {jogo.hora}</span>
          </div>
          <div className={`mt-1 text-sm font-medium ${veredito.cor}`}>{veredito.texto}</div>
          {porque && <div className="mt-1 text-xs leading-relaxed text-t2">{porque}</div>}
        </div>

        {/* Contexto completo dos analistas — fatos, dados citados, opiniões com fonte. */}
        {contexto && (
          <div className="rounded-xl border border-borda bg-card p-4">
            <SecaoContextoAnalistas contexto={contexto} />
          </div>
        )}

        {/* Todas as entradas: aprovada / esperar / reprovada com motivo traduzido + nota decomposta. */}
        <div className="space-y-2">
          {ordenadas.filter(temConteudo).map((p, i) => {
            const chip = chipDoMercado(p);
            const temAjuste = p.analistas_ajuste != null && p.analistas_ajuste !== 0 && p.nota_base != null;
            return (
              <div key={i} className={`rounded-lg border px-3 py-2.5 ${chip.cor}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-t1 break-words">{mercadoHumano(p.mercado)}</span>
                  {typeof p.nota === 'number' && (
                    <span className={`shrink-0 rounded-full border px-2 text-[11px] font-bold ${faixaNota(p.nota).borda} ${faixaNota(p.nota).fundo} ${faixaNota(p.nota).texto}`}>
                      {p.nota}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs leading-relaxed">
                  <span className="mr-1">{chip.icone}</span>{chip.texto}
                </div>
                {/* Nota decomposta: "Nota 74 = modelo 70 + analistas +4". */}
                {temAjuste && (
                  <div className="mt-1 text-[11px] text-t2">
                    Nota {p.nota} = modelo {p.nota_base}, analistas{' '}
                    <b className={(p.analistas_ajuste ?? 0) > 0 ? 'text-verde' : 'text-vermelho'}>
                      {(p.analistas_ajuste ?? 0) > 0 ? '+' : '−'}{Math.abs(p.analistas_ajuste ?? 0)}
                    </b>
                  </div>
                )}
                {/* Componentes da nota em linguagem de apostador. */}
                {typeof p.nota === 'number' && p.nota_componentes && (
                  <div className="mt-1.5 space-y-0.5 border-t border-borda/60 pt-1.5">
                    {explicarNota(p.nota_componentes, familiaDoMercado(p.mercado) === 'escanteios' || Boolean(p.sem_odd_referencia)).map((l, k) => (
                      <div key={k} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-t3">{l.rotulo}</span>
                        <span className="font-mono text-t3">{l.valor}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {!ordenadas.some(temConteudo) && (
            <div className="rounded-lg border border-borda bg-card px-3 py-4 text-center text-xs text-t3">
              A casa não abriu preço pra nenhum mercado deste jogo.
            </div>
          )}
        </div>

        {/* Detalhe técnico integral, atrás do toggle — nada se perde. */}
        <div className="rounded-xl border border-borda bg-card p-4">
          <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-t2">
            <input type="checkbox" checked={verNumeros} onChange={(e) => setVerNumeros(e.target.checked)} />
            ver números
          </label>
          {verNumeros && <TabelaNumeros pernas={ordenadas} />}
        </div>
      </main>
    </div>
  );
}
