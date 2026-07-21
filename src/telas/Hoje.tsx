import { useState } from 'react';
import { brl, pct, ROTULO, type Analise, type Bilhete, type Perna, type Registro } from '../dados';

export function Hoje({
  analise, jaRegistrados, onRegistrar, carregando, data, onAnalisar, janela,
}: {
  analise: Analise | null;
  jaRegistrados: Registro[];
  onRegistrar: (b: Bilhete, valor: number) => void;
  carregando?: boolean;
  data?: string | null;
  onAnalisar?: () => void;
  /** Análises de D+1..D+3 — viram "oportunidades antecipadas". */
  janela?: Analise[];
}) {
  if (carregando) return <Vazio titulo="Carregando…">Buscando a análise no servidor.</Vazio>;
  if (!analise) {
    return (
      <Vazio titulo={data ? `Sem análise para ${data}` : 'Nenhuma análise ainda'}>
        O motor roda sozinho todo dia às 09:00. Para gerar agora, use o botão abaixo.
        {onAnalisar && (
          <button onClick={onAnalisar} className="mt-4 block w-full rounded bg-rosa py-2 text-sm font-semibold text-white">
            Analisar agora
          </button>
        )}
      </Vazio>
    );
  }

  const semBilhete = analise.sem_bilhete || !analise.bilhetes.length;

  return (
    <div className="space-y-4">
      {analise.modo === 'demo' && (
        <div className="rounded-lg border border-ambar/40 bg-ambar/10 px-4 py-3 text-sm text-ambar">
          <b>MODO DEMO</b> — dados simulados, sem chaves de API. Serve pra validar o fluxo, não pra apostar.
        </div>
      )}

      {semBilhete ? (
        <div className="rounded-xl border border-borda bg-card p-8 text-center">
          <div className="text-3xl font-bold tracking-tight text-t1">SEM BILHETE HOJE</div>
          <p className="mx-auto mt-3 max-w-md text-sm text-t2">{analise.sem_bilhete?.motivo}</p>
          <p className="mt-4 text-xs text-t3">
            {analise.resumo.jogos} jogos e {analise.resumo.pernas_avaliadas} pernas analisadas ·{' '}
            {analise.resumo.aprovadas} passaram nos filtros. Não ter bilhete é resultado válido —
            veja em <b>Análises</b> o motivo de cada descarte.
          </p>
        </div>
      ) : (
        <>
          {analise.exposicao && (
            <div className="flex items-center justify-between rounded-lg border border-borda bg-card px-4 py-3">
              <span className="text-xs uppercase tracking-widest text-t3">Exposição do dia</span>
              <span className="text-sm">
                <b className="text-t1">{brl(analise.exposicao.total_rs)}</b>
                <span className="text-t2"> · {analise.exposicao.pct_banca}% da banca</span>
                <span className="text-t3"> (teto {analise.exposicao.teto_pct}%)</span>
              </span>
            </div>
          )}
          {analise.bilhetes.map((b) => (
            <CardBilhete
              key={b.ordem}
              bilhete={b}
              registrado={jaRegistrados.some((r) => r.data === analise.data && r.odd_total === b.odd_total)}
              onRegistrar={onRegistrar}
            />
          ))}
        </>
      )}

      <Antecipadas janela={janela ?? []} />

      {analise.cards_handicap?.length > 0 && (
        <div className="space-y-2">
          <h3 className="pt-2 text-xs uppercase tracking-widest text-t3">Alternativas em simples · handicap asiático</h3>
          {analise.cards_handicap.map((c, i) => (
            <div key={i} className="rounded-lg border border-borda bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-t1">{c.partida}</span>
                <span className="text-xs text-t3">{c.liga} · {c.hora}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                <span className="rounded bg-azul/15 px-2 py-0.5 text-azul">{ROTULO[c.mercado] ?? c.mercado}</span>
                <span className="text-t1">@ {c.odd}</span>
                <span className="text-verde">EV +{c.ev_pct?.toFixed(1)}%</span>
                <span className="text-t2">stake {brl(c.stake_rs)}</span>
                <span className="text-t3">+{c.vantagem_pp} p.p. vs dupla chance</span>
              </div>
              <p className="mt-2 text-xs text-t3">{c.observacao}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * OPORTUNIDADES ANTECIPADAS (D+1..D+3) — bloco separado do bilhete de hoje, de propósito.
 * Jogo distante tem escalação indefinida, então a margem exigida dobra (6%). O que passa vira
 * bilhete sugerido com o horizonte marcado; o que fica entre 3% e 6% aparece como radar, pra
 * reavaliar na véspera. Misturar os dois blocos convidaria a apostar cedo demais — que é
 * exatamente o erro que a margem dobrada existe pra evitar.
 */
function Antecipadas({ janela }: { janela: Analise[] }) {
  const comBilhete = janela.filter((a) => (a.bilhetes?.length ?? 0) > 0);
  const comRadar = janela.filter((a) => (a.radar?.length ?? 0) > 0);
  if (!comBilhete.length && !comRadar.length) return null;

  return (
    <div className="mt-8 space-y-3 border-t border-borda pt-6">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-xs uppercase tracking-widest text-t3">Oportunidades antecipadas</h3>
        <span className="text-[10px] text-t3">próximos dias · margem exigida dobrada</span>
      </div>

      {comBilhete.map((a) => (
        <div key={a.data} className="rounded-xl border border-verde/30 bg-card p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded bg-verde/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-verde">
              D+{a.horizonte_dias ?? '?'} · {a.data}
            </span>
            <span className="text-xs text-t2">{a.bilhetes.length} bilhete(s) sugerido(s)</span>
          </div>
          {a.bilhetes.map((b) => (
            <div key={b.ordem} className="mt-2 border-l-2 border-verde/40 pl-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-sm text-t1">@ {b.odd_total.toFixed(2)}</span>
                <span className="text-xs text-verde">EV +{b.ev_pct.toFixed(1)}%</span>
              </div>
              {b.pernas.map((p, i) => (
                <div key={i} className="mt-1 text-xs text-t2">
                  {p.partida} · <span className="text-azul">{ROTULO[p.mercado] ?? p.mercado}</span> @ {p.odd}
                  {p.trajetoria && <Trajetoria t={p.trajetoria} />}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}

      {comRadar.map((a) => (
        <div key={`r${a.data}`} className="rounded-xl border border-borda bg-card p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded bg-ambar/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ambar">
              no radar · D+{a.horizonte_dias ?? '?'} · {a.data}
            </span>
            <span className="text-xs text-t3">aguardar véspera</span>
          </div>
          {(a.radar ?? []).map((p, i) => (
            <div key={i} className="mt-2 border-l-2 border-ambar/40 pl-3">
              <div className="text-sm text-t1">{p.partida}</div>
              <div className="text-xs text-azul">
                {ROTULO[p.mercado] ?? p.mercado} @ {p.odd}
                {p.trajetoria && <Trajetoria t={p.trajetoria} />}
              </div>
              <div className="mt-0.5 text-xs text-t3">{p.motivo_radar}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Como a linha se moveu desde a primeira vez que a vimos (pilar timing). */
function Trajetoria({ t }: { t: NonNullable<Perna['trajetoria']> }) {
  const mov = t.movimento ?? 0;
  const cor = mov > 0 ? 'text-verde' : mov < 0 ? 'text-vermelho' : 'text-t3';
  return (
    <span className="text-t3">
      {' '}· abriu {t.primeira_odd}
      {mov !== 0 && <span className={cor}> ({mov > 0 ? '+' : ''}{mov.toFixed(2)})</span>}
      {t.observacoes > 1 && <span> · {t.observacoes} leituras em {t.idade_horas}h</span>}
    </span>
  );
}

function CardBilhete({
  bilhete, registrado, onRegistrar,
}: { bilhete: Bilhete; registrado: boolean; onRegistrar: (b: Bilhete, valor: number) => void }) {
  const [valor, setValor] = useState(bilhete.stake_rs);

  return (
    <div className="rounded-xl border border-borda bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-widest text-t3">Bilhete {bilhete.ordem}</span>
          {bilhete.todas_confianca_maxima && (
            <span className="rounded bg-verde/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-verde">
              Confiança máxima
            </span>
          )}
          {bilhete.correlacao_intra_jogo && (
            <span className="rounded bg-azul/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-azul">
              correlação intra-jogo
            </span>
          )}
        </div>
        <span className="font-mono text-lg text-t1">@ {bilhete.odd_total.toFixed(2)}</span>
      </div>

      <div className="mt-4 space-y-3">
        {bilhete.pernas.map((p, i) => (
          <div key={i} className="border-l-2 border-borda pl-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-t1">{p.partida}</span>
              <span className="font-mono text-sm text-t2">@ {p.odd}</span>
            </div>
            <div className="text-xs text-azul">{ROTULO[p.mercado] ?? p.mercado}</div>
            <div className="mt-0.5 text-xs text-t3">{p.justificativa}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-borda pt-3 text-sm sm:grid-cols-4">
        <Info rotulo="Prob. real" valor={pct(bilhete.prob_combinada)} />
        <Info rotulo="Valor justo" valor={`@ ${bilhete.valor_justo.toFixed(2)}`} />
        <Info rotulo="EV" valor={`+${bilhete.ev_pct.toFixed(1)}%`} cor="text-verde" />
        <Info rotulo={`Stake (${bilhete.stake_pct}%)`} valor={brl(bilhete.stake_rs)} />
      </div>

      <div className="mt-4 flex items-center gap-2">
        <span className="text-xs text-t3">R$</span>
        <input
          type="number" step="0.01" value={valor}
          onChange={(e) => setValor(Number(e.target.value))}
          className="w-28 rounded border border-borda bg-fundo px-2 py-1 text-sm text-t1 outline-none focus:border-azul"
        />
        <button
          disabled={registrado}
          onClick={() => onRegistrar(bilhete, valor)}
          className="rounded bg-rosa px-4 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-borda disabled:text-t3"
        >
          {registrado ? 'Registrado' : 'Registrar bilhete'}
        </button>
      </div>
    </div>
  );
}

function Info({ rotulo, valor, cor = 'text-t1' }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-t3">{rotulo}</div>
      <div className={`font-medium ${cor}`}>{valor}</div>
    </div>
  );
}

export function Vazio({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-borda bg-card p-10 text-center">
      <div className="text-lg font-medium text-t1">{titulo}</div>
      <p className="mt-2 text-sm text-t2">{children}</p>
    </div>
  );
}
