import { useState } from 'react';
import { brl, ROTULO, type Analise, type Config, type Perna } from '../dados';

/**
 * ABA INÍCIO — a tela de decisão.
 *
 * Agrupada por dia (Hoje / Amanhã / data), mostrando só o que é ACIONÁVEL:
 *  · bilhete, quando as pernas fecham na faixa de odd
 *  · ENTRADA SIMPLES, quando a perna é boa mas a odd não cabe em bilhete nenhum —
 *    antes essa perna sumia da tela mesmo estando aprovada
 *  · "sem entrada nesse dia" com o resumo, quando não há nada
 *
 * Cada entrada tem campo de ODD DA CASA: o número que o dash mostra vem da melhor casa
 * europeia da API, e o Maikon aposta em casa brasileira. Digitando a odd real, o veredito
 * é recalculado na hora — porque uma entrada com vantagem em 1.42 pode não ter nenhuma em 1.35.
 */

const DIA_MS = 86400000;
const hojeSP = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());

function rotuloDoDia(data: string): string {
  const hoje = hojeSP();
  const diff = Math.round((new Date(data + 'T12:00:00Z').getTime() - new Date(hoje + 'T12:00:00Z').getTime()) / DIA_MS);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  const [a, m, d] = data.split('-');
  return `${d}/${m}/${a.slice(2)}`;
}

export function Vazio({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-borda bg-card p-10 text-center">
      <div className="text-lg font-medium text-t1">{titulo}</div>
      <div className="mt-2 text-sm text-t2">{children}</div>
    </div>
  );
}

export function Inicio({
  janela, config, carregando, jaRegistrados, onRegistrar, onAnalisar,
}: {
  janela: Analise[];
  config?: Config;
  carregando?: boolean;
  jaRegistrados: { data: string; odd_referencia?: number | null }[];
  onRegistrar: (e: EntradaRegistro) => void;
  onAnalisar?: () => void;
}) {
  if (carregando) return <Vazio titulo="Carregando…">Buscando as análises no servidor.</Vazio>;
  if (!janela.length) {
    return (
      <Vazio titulo="Nenhuma análise ainda">
        O motor roda sozinho todo dia às 09:00.
        {onAnalisar && (
          <button onClick={onAnalisar} className="mt-4 block w-full rounded bg-rosa py-2 text-sm font-semibold text-white">
            Analisar agora
          </button>
        )}
      </Vazio>
    );
  }

  return (
    <div className="space-y-6">
      {janela.map((a) => (
        <DiaBloco
          key={a.data} analise={a} config={config}
          jaRegistrados={jaRegistrados} onRegistrar={onRegistrar}
        />
      ))}
    </div>
  );
}

function DiaBloco({
  analise, config, jaRegistrados, onRegistrar,
}: {
  analise: Analise; config?: Config;
  jaRegistrados: { data: string; odd_referencia?: number | null }[];
  onRegistrar: (e: EntradaRegistro) => void;
}) {
  const bilhetes = analise.bilhetes ?? [];
  const pernas = analise.pernas ?? [];

  // Perna aprovada que não entrou em bilhete nenhum vira ENTRADA SIMPLES. O radar (D+1..D+3
  // abaixo dos 6%) fica de fora: ainda não é entrada, é observação.
  const emBilhete = new Set(bilhetes.flatMap((b) => b.pernas.map((p) => `${p.jogo_id}|${p.mercado}`)));
  const simples = pernas.filter(
    (p) => p.aprovada && !p.radar && !emBilhete.has(`${p.jogo_id}|${p.mercado}`)
  );
  const radar = analise.radar ?? [];
  const semEntrada = !bilhetes.length && !simples.length;

  const stakePctDe = (p: Perna) =>
    p.confianca === 'CONFIANCA_MAXIMA' && !p.amostra_curta
      ? (config?.stake_confianca_maxima_pct ?? 5)
      : (config?.stake_padrao_pct ?? 3);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-bold tracking-tight text-t1">{rotuloDoDia(analise.data)}</h2>
        <span className="text-xs text-t3">{analise.data}</span>
        {(analise.horizonte_dias ?? 0) > 0 && (
          <span className="rounded bg-azul/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-azul">
            antecipada · exige margem dobrada
          </span>
        )}
      </div>

      {semEntrada ? (
        <div className="rounded-xl border border-borda bg-card px-4 py-5 text-center">
          <div className="text-sm font-medium text-t2">Sem entrada nesse dia</div>
          <div className="mt-1 text-xs text-t3">
            {analise.resumo?.jogos ?? 0} jogos e {analise.resumo?.pernas_avaliadas ?? 0} apostas possíveis analisadas ·{' '}
            {analise.resumo?.aprovadas ?? 0} passaram nos filtros
            {radar.length > 0 && ` · ${radar.length} no radar pra véspera`}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {bilhetes.map((b) => (
            <CardEntrada
              key={`b${b.ordem}`}
              tipo={b.n_pernas > 1 ? 'BILHETE' : 'ENTRADA SIMPLES'}
              data={analise.data}
              pernas={b.pernas}
              oddReferencia={b.odd_total}
              prob={b.prob_combinada}
              stakePct={b.stake_pct}
              stakeRS={b.stake_rs}
              confiancaMaxima={b.todas_confianca_maxima}
              correlacao={b.correlacao_intra_jogo}
              evMinimo={config?.filtros?.ev_minimo ?? 1.03}
              registrado={jaRegistrados.some((r) => r.data === analise.data && r.odd_referencia === b.odd_total)}
              onRegistrar={onRegistrar}
            />
          ))}
          {simples.map((p, i) => (
            <CardEntrada
              key={`s${i}`}
              tipo="ENTRADA SIMPLES"
              data={analise.data}
              pernas={[p]}
              oddReferencia={p.odd ?? 0}
              prob={p.prob_final ?? 0}
              stakePct={stakePctDe(p)}
              stakeRS={+(((config?.banca ?? 1000) * stakePctDe(p)) / 100).toFixed(2)}
              confiancaMaxima={p.confianca === 'CONFIANCA_MAXIMA' && !p.amostra_curta}
              correlacao={false}
              evMinimo={config?.filtros?.ev_minimo ?? 1.03}
              foraDaFaixa
              registrado={jaRegistrados.some((r) => r.data === analise.data && r.odd_referencia === p.odd)}
              onRegistrar={onRegistrar}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export interface EntradaRegistro {
  data: string; pernas: Perna[]; odd_real: number; odd_referencia: number;
  prob: number; stake: number; casa_odd: string | null;
}

function CardEntrada({
  tipo, data, pernas, oddReferencia, prob, stakePct, stakeRS,
  confiancaMaxima, correlacao, evMinimo, foraDaFaixa, registrado, onRegistrar,
}: {
  tipo: string; data: string; pernas: Perna[]; oddReferencia: number; prob: number;
  stakePct: number; stakeRS: number; confiancaMaxima: boolean; correlacao: boolean;
  evMinimo: number; foraDaFaixa?: boolean; registrado: boolean;
  onRegistrar: (e: EntradaRegistro) => void;
}) {
  const [oddCasa, setOddCasa] = useState<string>(oddReferencia.toFixed(2));
  const [stake, setStake] = useState<number>(stakeRS);

  const odd = Number(oddCasa) || 0;
  const justo = prob > 0 ? 1 / prob : 0;
  const valorNaOdd = prob * odd;           // 1.00 = pagou o justo
  const vale = valorNaOdd >= evMinimo;
  const ganho = ((valorNaOdd - 1) * 100);

  return (
    <div className={`rounded-xl border bg-card p-4 ${vale ? 'border-borda' : 'border-vermelho/40'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-t3">{tipo}</span>
          {confiancaMaxima && (
            <span className="rounded bg-verde/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-verde">
              confiança máxima
            </span>
          )}
          {pernas.some((p) => p.amostra_curta) && (
            <span className="rounded bg-ambar/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-ambar">
              amostra curta
            </span>
          )}
          {correlacao && (
            <span className="rounded bg-azul/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-azul">
              mesmo jogo
            </span>
          )}
          {foraDaFaixa && (
            <span className="rounded bg-borda px-2 py-0.5 text-[10px] uppercase tracking-wider text-t3">
              fora da faixa de bilhete
            </span>
          )}
        </div>
        <span className="font-mono text-lg text-t1">@ {oddReferencia.toFixed(2)}</span>
      </div>

      <div className="mt-3 space-y-2">
        {pernas.map((p, i) => (
          <div key={i} className="border-l-2 border-borda pl-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-t1">{p.partida}</span>
              <span className="font-mono text-xs text-t2">@ {p.odd}</span>
            </div>
            <div className="text-xs text-azul">
              {ROTULO[p.mercado] ?? p.mercado}
              {p.hora && <span className="text-t3"> · {p.hora}</span>}
              {p.casa_odd && <span className="text-t3"> · odd da {p.casa_odd}</span>}
            </div>
            {p.badge_amostra && <div className="text-[11px] text-ambar">{p.badge_amostra}</div>}
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-lg bg-fundo p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-t2">Odd na sua casa:</span>
          <input
            type="number" step="0.01" inputMode="decimal" value={oddCasa}
            onChange={(e) => setOddCasa(e.target.value)}
            className="w-24 rounded border border-borda bg-card px-2 py-1 font-mono text-sm text-t1 outline-none focus:border-azul"
          />
          <span className="text-t3">(referência @{oddReferencia.toFixed(2)})</span>
        </div>
        <div className={`mt-2 text-sm font-medium ${vale ? 'text-verde' : 'text-vermelho'}`}>
          {odd <= 1
            ? 'Digite a odd que a sua casa está pagando'
            : vale
              ? `Ainda vale — @${odd.toFixed(2)} paga acima do justo @${justo.toFixed(2)} (+${ganho.toFixed(1)}% de vantagem)`
              : `Nessa odd a vantagem sumiu — o justo é @${justo.toFixed(2)}, melhor pular`}
        </div>
        <div className="mt-1 text-[11px] text-t3">
          Chance real de dar certo: {(prob * 100).toFixed(0)}%
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-t3">R$</span>
        <input
          type="number" step="0.01" inputMode="decimal" value={stake}
          onChange={(e) => setStake(Number(e.target.value))}
          className="w-24 rounded border border-borda bg-fundo px-2 py-1 text-sm text-t1 outline-none focus:border-azul"
        />
        <span className="text-[11px] text-t3">sugerido {brl(stakeRS)} ({stakePct}%)</span>
        <button
          disabled={registrado || !vale}
          onClick={() => onRegistrar({
            data, pernas, odd_real: odd, odd_referencia: oddReferencia,
            prob, stake, casa_odd: pernas[0]?.casa_odd ?? null,
          })}
          className="ml-auto rounded bg-rosa px-4 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-borda disabled:text-t3"
        >
          {registrado ? 'Registrado' : vale ? 'Registrar' : 'Sem valor'}
        </button>
      </div>
    </div>
  );
}
