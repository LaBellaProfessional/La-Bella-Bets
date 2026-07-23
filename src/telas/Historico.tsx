import { useState } from 'react';
import {
  brl, rotuloMercado, useAnalistaPlacar,
  type Config, type Registro, type SugestaoLiquidada, type AnalistaPlacar,
} from '../dados';
import { DesempenhoSugestoes } from './DesempenhoSugestoes';

type RegistroUI = Registro & { stake_rs: number };
type Subaba = 'apostas' | 'sugestoes' | 'analistas';

/**
 * A tela que decide se o método sobrevive ao próprio dono. Sem amostra, ROI é ruído:
 * a frase do topo é fixa de propósito.
 */
export function Historico({
  registros, config, sugestoes, onResultado,
}: {
  registros: RegistroUI[]; config: Config;
  sugestoes: SugestaoLiquidada[];
  onResultado: (id: string, r: 'ganhou' | 'perdeu') => void;
}) {
  const [sub, setSub] = useState<Subaba>('apostas');
  // Cancelada ("não apostei") não é aposta real: fora de toda estatística e da lista.
  const reais = registros.filter((r) => r.resultado !== 'cancelada');
  const fechados = reais.filter((r) => r.resultado === 'ganhou' || r.resultado === 'perdeu');
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
    <div className="space-y-6">
      {/* Subabas: apostas reais · sugestões virtuais · analistas (placar + tripulação). */}
      <div className="flex gap-1 overflow-x-auto border-b border-borda">
        {([['apostas', 'Suas apostas'], ['sugestoes', 'Sugestões'], ['analistas', 'Analistas']] as [Subaba, string][]).map(([id, nome]) => (
          <button
            key={id} onClick={() => setSub(id)}
            className={`whitespace-nowrap px-3 py-2 text-sm transition-colors ${
              sub === id ? 'border-b-2 border-rosa font-semibold text-t1' : 'text-t3 hover:text-t2'
            }`}
          >
            {nome}
          </button>
        ))}
      </div>

      {sub === 'apostas' && (
      <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-sm font-bold uppercase tracking-widest text-t2">Suas apostas</h2>
        <span className="rounded bg-verde/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-verde">real</span>
      </div>
      <div className="rounded-lg border border-ambar/40 bg-ambar/10 px-4 py-3 text-center text-sm text-ambar">
        Mínimo 100-150 bilhetes antes de qualquer conclusão sobre o método.
        {fechados.length < 100 && <b> Você tem {fechados.length}.</b>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi rotulo="Banca" valor={brl(config.banca)} />
        <Kpi rotulo="Lucro" valor={brl(lucro)} cor={lucro >= 0 ? 'text-verde' : 'text-vermelho'} />
        <Kpi rotulo="ROI" valor={`${roi.toFixed(1)}%`} cor={roi >= 0 ? 'text-verde' : 'text-vermelho'} />
        <Kpi rotulo="Acerto" valor={`${acerto.toFixed(0)}%`} />
        <Kpi rotulo="Bilhetes" valor={`${fechados.length}`} sub={`${reais.length - fechados.length} pendentes`} />
        <Kpi rotulo="Pior sequência" valor={`${piorNeg} ✗`} sub={seqTipo ? `atual: ${seqAtual} ${seqTipo === 'ganhou' ? '✓' : '✗'}` : undefined} />
      </div>

      {serie.length > 1 && <Grafico serie={serie} />}

      <div className="overflow-hidden rounded-xl border border-borda bg-card">
        <div className="border-b border-borda px-4 py-3 text-xs uppercase tracking-widest text-t3">Bilhetes registrados</div>
        {reais.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-t3">Nenhum bilhete registrado ainda.</div>
        ) : (
          <div className="divide-y divide-borda/60">
            {[...reais].reverse().map((r) => (
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
                  {/* rótulo gravado quando existe; senão deriva da chave. Escanteio não tem
                      odd de mercado — mostra "sem odd", nunca "@ null". */}
                  {r.pernas.map((p) => {
                    const nome = p.rotulo ?? rotuloMercado(p.mercado);
                    return `${p.partida} (${nome}${p.odd != null ? ` @ ${p.odd}` : ' · sem odd de mercado'})`;
                  }).join('  ·  ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
      )}

      {/* Bloco VIRTUAL: paper trading nunca se mistura com as apostas reais. */}
      {sub === 'sugestoes' && <DesempenhoSugestoes sugestoes={sugestoes} />}

      {/* ANALISTAS: tripulação (comparativo das forças) + placar por analista. */}
      {sub === 'analistas' && <SubabaAnalistas reais={reais} sugestoes={sugestoes} />}
    </div>
  );
}

/**
 * SUBABA ANALISTAS (Parte A4): o comparativo da TRIPULAÇÃO — cada força medida lado a lado,
 * nenhuma descartada — e o placar por analista (acerto, ROI virtual, peso, tendência).
 *
 * As cinco forças:
 *   MODELO         — as sugestões virtuais (o que a matemática sozinha prometeu).
 *   MAIKON+MÉTODO  — apostas reais registradas pelo fluxo do método.
 *   MAIKON FARO    — apostas reais por convicção própria, contra ou além do método.
 *   ANALISTAS      — palpites dos canais, liquidados contra o placar real.
 *   RESSUSCITADAS  — entradas que só voltaram pelo consenso dos analistas.
 */
function SubabaAnalistas({ reais, sugestoes }: { reais: RegistroUI[]; sugestoes: SugestaoLiquidada[] }) {
  const { data: placar } = useAnalistaPlacar();

  // Colunas reais (Maikon) por origem.
  const porOrigem = (o: Registro['origem']) =>
    reais.filter((r) => (r.origem ?? 'metodo') === o && (r.resultado === 'ganhou' || r.resultado === 'perdeu'));
  const metodo = agregarReais(porOrigem('metodo'));
  const faroRegs = porOrigem('maikon_faro');
  const faro = agregarReais(faroRegs);
  const nMulti = faroRegs.filter((r) => (r.tipo ?? 'simples') === 'multipla_propria').length;
  const faroSub = faroRegs.length ? `simples ${faroRegs.length - nMulti} · múltipla ${nMulti}` : undefined;
  const ressus = agregarReais(porOrigem('analistas'));

  // MODELO: sugestões virtuais liquidadas (ROI só onde havia odd de mercado).
  const sugLiq = sugestoes.filter((s) => s.status === 'ganhou' || s.status === 'perdeu');
  const sugGanhou = sugLiq.filter((s) => s.status === 'ganhou').length;
  const sugComOdd = sugLiq.filter((s) => s.odd_e_mercado);
  const modeloLucro = sugComOdd.reduce((s, x) => s + (x.status === 'ganhou' ? x.odd_referencia - 1 : -1), 0);
  const modelo: Forca = {
    n: sugLiq.length, acerto: sugLiq.length ? sugGanhou / sugLiq.length : null,
    resultado: sugComOdd.length ? modeloLucro : null, unidade: 'u', clv: null,
  };

  // ANALISTAS: soma do placar (acerto e lucro virtual só onde havia odd).
  const somaAnalistas = (placar ?? []).reduce(
    (a, p) => ({
      liq: a.liq + p.n_liquidados, ganhou: a.ganhou + p.n_ganhou,
      lucro: a.lucro + Number(p.lucro_virtual), comOdd: a.comOdd + p.n_com_odd,
    }),
    { liq: 0, ganhou: 0, lucro: 0, comOdd: 0 },
  );
  const analistas: Forca = {
    n: somaAnalistas.liq, acerto: somaAnalistas.liq ? somaAnalistas.ganhou / somaAnalistas.liq : null,
    resultado: somaAnalistas.comOdd ? somaAnalistas.lucro : null, unidade: 'u', clv: null,
  };

  const tripulacao: { rotulo: string; cor: string; f: Forca; sub?: string }[] = [
    { rotulo: 'MODELO', cor: 'text-azul', f: modelo },
    { rotulo: 'MAIKON+MÉTODO', cor: 'text-t1', f: metodo },
    { rotulo: 'MAIKON FARO', cor: 'text-roxo', f: faro, sub: faroSub },
    { rotulo: 'ANALISTAS', cor: 'text-laranja', f: analistas },
    { rotulo: 'RESSUSCITADAS', cor: 'text-laranja', f: ressus },
  ];

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-bold uppercase tracking-widest text-t2">A tripulação</h2>
          <span className="text-[11px] text-t3">cada força medida, nenhuma descartada</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {tripulacao.map((t) => <CardForca key={t.rotulo} rotulo={t.rotulo} cor={t.cor} f={t.f} sub={t.sub} />)}
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-bold uppercase tracking-widest text-t2">Placar por analista</h2>
          <span className="rounded bg-laranja/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-laranja">virtual</span>
        </div>
        {!(placar ?? []).length ? (
          <div className="rounded-xl border border-borda bg-card px-4 py-8 text-center text-sm text-t3">
            Nenhum analista com palpite liquidado ainda. Assim que o pipeline (ou o bootstrap manual)
            popular extrações e os jogos terminarem, o placar aparece aqui.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-borda bg-card divide-y divide-borda/60">
            {(placar ?? []).map((a) => <LinhaAnalista key={a.id} a={a} />)}
          </div>
        )}
      </div>
    </div>
  );
}

interface Forca { n: number; acerto: number | null; resultado: number | null; unidade: 'R$' | 'u'; clv: number | null }

/** Agrega apostas reais resolvidas: acerto, lucro em R$, e CLV médio (odd real vs a que o modelo viu). */
function agregarReais(regs: RegistroUI[]): Forca {
  const ganhou = regs.filter((r) => r.resultado === 'ganhou').length;
  const lucro = regs.reduce((s, r) => s + (r.resultado === 'ganhou' ? r.retorno_rs - r.stake_rs : -r.stake_rs), 0);
  const comRef = regs.filter((r) => r.odd_referencia != null && Number(r.odd_referencia) > 0);
  const clv = comRef.length
    ? comRef.reduce((s, r) => s + (r.odd_total / Number(r.odd_referencia) - 1), 0) / comRef.length : null;
  return { n: regs.length, acerto: regs.length ? ganhou / regs.length : null, resultado: regs.length ? lucro : null, unidade: 'R$', clv };
}

function CardForca({ rotulo, cor, f, sub }: { rotulo: string; cor: string; f: Forca; sub?: string }) {
  const resStr = f.resultado == null ? '—'
    : f.unidade === 'R$' ? `${f.resultado >= 0 ? '+' : '−'}${brl(Math.abs(f.resultado))}`
    : `${f.resultado >= 0 ? '+' : '−'}${Math.abs(f.resultado).toFixed(1)}u`;
  return (
    <div className="rounded-lg border border-borda bg-card px-3 py-3">
      <div className={`text-[11px] font-bold uppercase tracking-wider ${cor}`}>{rotulo}</div>
      {sub && <div className="text-[10px] text-t3">{sub}</div>}
      {f.n === 0 ? (
        <div className="mt-1 text-xs text-t3">sem amostra ainda</div>
      ) : (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="text-lg font-semibold text-t1">{f.acerto == null ? '—' : `${(f.acerto * 100).toFixed(0)}%`}</span>
          <span className="text-[10px] text-t3">acerto · {f.n}</span>
          <span className={`text-sm font-semibold ${(f.resultado ?? 0) >= 0 ? 'text-verde' : 'text-vermelho'}`}>{resStr}</span>
          {f.clv != null && (
            <span className={`text-[10px] ${f.clv >= 0 ? 'text-verde' : 'text-vermelho'}`}>
              CLV {f.clv >= 0 ? '+' : ''}{(f.clv * 100).toFixed(1)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function LinhaAnalista({ a }: { a: AnalistaPlacar }) {
  const acerto = a.acerto == null ? null : Number(a.acerto);
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium text-t1">{a.nome}</span>
          <span className="ml-2 text-[11px] text-t3">{a.canal_youtube}</span>
          {!a.ativo && <span className="ml-2 rounded bg-borda px-1.5 text-[9px] uppercase text-t3">inativo</span>}
        </div>
        <span className="rounded bg-azul/15 px-2 py-0.5 text-[10px] font-semibold text-azul" title="peso atual (2..15)">
          peso {Number(a.peso_atual).toFixed(1)}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px] text-t3">
        <span>{a.n_liquidados} liquidados</span>
        {a.n_pendentes > 0 && <span>· {a.n_pendentes} pendentes</span>}
        <span>· acerto <b className="text-t2">{acerto == null ? '—' : `${(acerto * 100).toFixed(0)}%`}</b></span>
        {a.n_com_odd > 0 && (
          <span>· ROI virtual <b className={Number(a.lucro_virtual) >= 0 ? 'text-verde' : 'text-vermelho'}>
            {Number(a.lucro_virtual) >= 0 ? '+' : '−'}{Math.abs(Number(a.lucro_virtual)).toFixed(1)}u
          </b> ({a.n_com_odd} c/ odd)</span>
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
