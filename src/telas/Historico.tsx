import { brl, ROTULO, type Config, type Registro } from '../dados';

type RegistroUI = Registro & { stake_rs: number };

/**
 * A tela que decide se o método sobrevive ao próprio dono. Sem amostra, ROI é ruído:
 * a frase do topo é fixa de propósito.
 */
export function Historico({
  registros, config, onResultado,
}: { registros: RegistroUI[]; config: Config; onResultado: (id: string, r: 'ganhou' | 'perdeu') => void }) {
  const fechados = registros.filter((r) => r.resultado !== 'pendente');
  const ganhos = fechados.filter((r) => r.resultado === 'ganhou');
  const investido = fechados.reduce((s, r) => s + r.stake_rs, 0);
  const retorno = fechados.reduce((s, r) => s + r.retorno_rs, 0);
  const lucro = retorno - investido;
  const roi = investido > 0 ? (lucro / investido) * 100 : 0;
  const acerto = fechados.length ? (ganhos.length / fechados.length) * 100 : 0;

  // Sequência atual e pior sequência negativa (na ordem cronológica).
  const cron = [...fechados].sort((a, b) => a.registrado_em.localeCompare(b.registrado_em));
  let seqAtual = 0, seqTipo: 'ganhou' | 'perdeu' | null = null, piorNeg = 0, corrida = 0;
  for (const r of cron) {
    if (r.resultado === 'perdeu') { corrida++; piorNeg = Math.max(piorNeg, corrida); } else corrida = 0;
    if (seqTipo === r.resultado) seqAtual++; else { seqTipo = r.resultado as 'ganhou' | 'perdeu'; seqAtual = 1; }
  }

  // Evolução da banca: parte da banca atual e desfaz os resultados de trás pra frente.
  const pontos: number[] = [];
  let b = config.banca;
  for (let i = cron.length - 1; i >= 0; i--) { pontos.unshift(b); b = b - cron[i].retorno_rs + cron[i].stake_rs; }
  const serie = [b, ...pontos];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ambar/40 bg-ambar/10 px-4 py-3 text-center text-sm text-ambar">
        Mínimo 100-150 bilhetes antes de qualquer conclusão sobre o método.
        {fechados.length < 100 && <b> Você tem {fechados.length}.</b>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi rotulo="Banca" valor={brl(config.banca)} />
        <Kpi rotulo="Lucro" valor={brl(lucro)} cor={lucro >= 0 ? 'text-verde' : 'text-vermelho'} />
        <Kpi rotulo="ROI" valor={`${roi.toFixed(1)}%`} cor={roi >= 0 ? 'text-verde' : 'text-vermelho'} />
        <Kpi rotulo="Acerto" valor={`${acerto.toFixed(0)}%`} />
        <Kpi rotulo="Bilhetes" valor={`${fechados.length}`} sub={`${registros.length - fechados.length} pendentes`} />
        <Kpi rotulo="Pior sequência" valor={`${piorNeg} ✗`} sub={seqTipo ? `atual: ${seqAtual} ${seqTipo === 'ganhou' ? '✓' : '✗'}` : undefined} />
      </div>

      {serie.length > 1 && <Grafico serie={serie} />}

      <div className="overflow-hidden rounded-xl border border-borda bg-card">
        <div className="border-b border-borda px-4 py-3 text-xs uppercase tracking-widest text-t3">Bilhetes registrados</div>
        {registros.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-t3">Nenhum bilhete registrado ainda.</div>
        ) : (
          <div className="divide-y divide-borda/60">
            {[...registros].reverse().map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-t2">{r.data} · @ {r.odd_total.toFixed(2)} · {brl(r.stake_rs)}</span>
                  {r.resultado === 'pendente' ? (
                    <div className="flex gap-2">
                      <button onClick={() => onResultado(r.id, 'ganhou')} className="rounded bg-verde/15 px-3 py-1 text-xs font-semibold text-verde">Ganhou</button>
                      <button onClick={() => onResultado(r.id, 'perdeu')} className="rounded bg-vermelho/15 px-3 py-1 text-xs font-semibold text-vermelho">Perdeu</button>
                    </div>
                  ) : (
                    <span className={`text-sm font-semibold ${r.resultado === 'ganhou' ? 'text-verde' : 'text-vermelho'}`}>
                      {r.resultado === 'ganhou' ? `+${brl(r.retorno_rs - r.stake_rs)}` : `-${brl(r.stake_rs)}`}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-t3">
                  {r.pernas.map((p) => `${p.partida} (${ROTULO[p.mercado] ?? p.mercado} @ ${p.odd})`).join('  ·  ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ rotulo, valor, sub, cor = 'text-t1' }: { rotulo: string; valor: string; sub?: string; cor?: string }) {
  return (
    <div className="rounded-lg border border-borda bg-card px-3 py-3">
      <div className="text-[10px] uppercase tracking-wider text-t3">{rotulo}</div>
      <div className={`mt-1 text-lg font-semibold ${cor}`}>{valor}</div>
      {sub && <div className="text-[10px] text-t3">{sub}</div>}
    </div>
  );
}

/** Gráfico de banca em SVG puro — sem dependência só pra desenhar uma linha. */
function Grafico({ serie }: { serie: number[] }) {
  const w = 600, h = 140, pad = 8;
  const min = Math.min(...serie), max = Math.max(...serie);
  const span = max - min || 1;
  const pts = serie.map((v, i) => {
    const x = pad + (i / Math.max(1, serie.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const subiu = serie[serie.length - 1] >= serie[0];
  return (
    <div className="rounded-xl border border-borda bg-card p-4">
      <div className="mb-2 text-[10px] uppercase tracking-widest text-t3">Evolução da banca</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none">
        <polyline points={pts.join(' ')} fill="none" stroke={subiu ? '#1a9e5f' : '#d94040'} strokeWidth="2" />
      </svg>
      <div className="flex justify-between text-[10px] text-t3">
        <span>{brl(serie[0])}</span><span>{brl(serie[serie.length - 1])}</span>
      </div>
    </div>
  );
}
