import { NOME_FAMILIA, type Familia, type SugestaoLiquidada } from '../dados';

/**
 * DESEMPENHO DAS SUGESTÕES (paper trading).
 *
 * Toda entrada aprovada vira uma aposta VIRTUAL de 1 unidade na odd de referência, liquidada
 * pelo placar real. Mede duas coisas que o histórico de apostas de verdade (pequeno demais)
 * não mede:
 *
 *   · CALIBRAÇÃO — o modelo prometeu 70%? Em 70% das vezes deu certo? Se acontece menos, ele
 *     é superconfiante e o filtro está deixando passar entrada ruim.
 *   · ROI VIRTUAL a stake fixo — o teto do que o método renderia com execução perfeita.
 *
 * Fica SEPARADO do histórico real de apostas de propósito: um é o que o método sugeriu, o outro
 * é o que o Maikon apostou de fato, com a odd pior da casa dele. Nunca somar os dois.
 */

type Agregado = {
  n: number; ganhou: number; hit: number; probMedia: number;
  roi: number | null; nMercado: number; lucro: number;
};

function agregar(rows: SugestaoLiquidada[]): Agregado {
  const liq = rows.filter((r) => r.status === 'ganhou' || r.status === 'perdeu');
  const n = liq.length;
  const ganhou = liq.filter((r) => r.status === 'ganhou').length;
  const probMedia = n ? liq.reduce((s, r) => s + Number(r.prob_modelo), 0) / n : 0;
  // ROI só onde havia odd de MERCADO: escanteio usa a odd justa do modelo, então seu "ROI"
  // seria ~0 por construção e contaminaria o número. Calibração usa todos; ROI, só mercado.
  const mercado = liq.filter((r) => r.odd_e_mercado);
  const lucro = mercado.reduce((s, r) => s + (r.status === 'ganhou' ? Number(r.odd_referencia) - 1 : -1), 0);
  return {
    n, ganhou, hit: n ? ganhou / n : 0, probMedia,
    roi: mercado.length ? (lucro / mercado.length) * 100 : null,
    nMercado: mercado.length, lucro,
  };
}

function porChave(rows: SugestaoLiquidada[], chave: (r: SugestaoLiquidada) => string) {
  const grupos = new Map<string, SugestaoLiquidada[]>();
  for (const r of rows) {
    const k = chave(r);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(r);
  }
  return [...grupos.entries()]
    .map(([k, rs]) => ({ k, ...agregar(rs) }))
    .filter((g) => g.n > 0)
    .sort((a, b) => b.n - a.n);
}

const pctTxt = (v: number) => `${(v * 100).toFixed(0)}%`;

export function DesempenhoSugestoes({ sugestoes }: { sugestoes: SugestaoLiquidada[] }) {
  const liquidadas = sugestoes.filter((s) => s.status !== 'pendente');
  const pendentes = sugestoes.length - liquidadas.length;
  const g = agregar(sugestoes);

  // Diferença calibração: prometido − aconteceu. Positivo = modelo otimista demais.
  const gap = g.probMedia - g.hit;
  const corGap = Math.abs(gap) <= 0.05 ? 'text-verde' : Math.abs(gap) <= 0.12 ? 'text-ambar' : 'text-vermelho';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-sm font-bold uppercase tracking-widest text-t2">Desempenho das sugestões</h2>
        <span className="rounded bg-azul/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-azul">virtual</span>
      </div>

      {/* REGRA DE OURO — sempre visível, nunca deixa confundir teto com promessa. */}
      <div className="rounded-lg border border-ambar/40 bg-ambar/10 px-3 py-2 text-[11px] leading-snug text-ambar">
        Virtual usa a odd de referência europeia; a casa brasileira paga menos. O ROI virtual é o
        <b> teto</b> do método com execução perfeita, <b>não uma promessa</b> — o real vem no bloco de cima.
      </div>

      {liquidadas.length === 0 ? (
        <div className="rounded-xl border border-borda bg-card px-4 py-6 text-center text-sm text-t3">
          Nenhuma sugestão liquidada ainda.
          {pendentes > 0 && <div className="mt-1 text-xs">{pendentes} aguardando os jogos terminarem.</div>}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi rotulo="Liquidadas" valor={`${g.n}`} sub={pendentes ? `${pendentes} pendentes` : undefined} />
            <Kpi rotulo="Acerto real" valor={pctTxt(g.hit)} sub={`${g.ganhou}/${g.n}`} />
            <Kpi rotulo="Prometido" valor={pctTxt(g.probMedia)} sub="prob. média" />
            <Kpi
              rotulo="ROI virtual"
              valor={g.roi == null ? '—' : `${g.roi >= 0 ? '+' : ''}${g.roi.toFixed(1)}%`}
              sub={`1u · ${g.nMercado} c/ odd`}
              cor={g.roi == null ? 'text-t1' : g.roi >= 0 ? 'text-verde' : 'text-vermelho'}
            />
          </div>

          {/* CALIBRAÇÃO — a comparação que dá sentido ao resto. */}
          <div className="rounded-xl border border-borda bg-card px-4 py-3">
            <div className="text-[10px] uppercase tracking-wider text-t3">Calibração do modelo</div>
            <div className="mt-1 text-sm text-t1">
              Prometeu <b>{pctTxt(g.probMedia)}</b>, aconteceu <b>{pctTxt(g.hit)}</b>{' '}
              <span className={corGap}>
                ({gap >= 0 ? '+' : ''}{(gap * 100).toFixed(0)} p.p.{' '}
                {Math.abs(gap) <= 0.05 ? 'calibrado' : gap > 0 ? 'otimista' : 'conservador'})
              </span>
            </div>
            <div className="mt-1 text-[11px] leading-snug text-t3">
              {g.n < 30
                ? 'Amostra ainda curta — a calibração só significa alguma coisa com dezenas de jogos.'
                : gap > 0.12
                  ? 'O modelo está prometendo mais do que entrega: candidato a apertar o filtro de EV.'
                  : 'Dentro do esperado pra amostra atual.'}
            </div>
          </div>

          <Quebra titulo="Por mercado" grupos={porChave(sugestoes, (r) => r.familia)} nomear={(k) => NOME_FAMILIA[k as Familia]} />
          <Quebra titulo="Por confiança" grupos={porChave(sugestoes, (r) => r.confianca)} nomear={(k) => k} />
          <Quebra titulo="Por liga" grupos={porChave(sugestoes, (r) => r.liga)} nomear={(k) => k} />
          <Quebra titulo="Por linha" grupos={porChave(sugestoes, (r) => r.rotulo)} nomear={(k) => k} />
        </>
      )}
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

/** Uma quebra do desempenho por dimensão — lista empilhada, sem tabela (nada de scroll lateral). */
function Quebra({
  titulo, grupos, nomear,
}: {
  titulo: string;
  grupos: (Agregado & { k: string })[];
  nomear: (k: string) => string;
}) {
  if (grupos.length <= 1) return null;
  return (
    <div className="rounded-xl border border-borda bg-card">
      <div className="border-b border-borda px-4 py-2 text-[10px] uppercase tracking-widest text-t3">{titulo}</div>
      <div className="divide-y divide-borda/60">
        {grupos.map((gr) => (
          <div key={gr.k} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs">
            <span className="font-medium text-t1">{nomear(gr.k)}</span>
            <span className="text-t3">{gr.n} jogos</span>
            <span className="ml-auto text-t2">acerto {pctTxt(gr.hit)}</span>
            <span className="text-t3">· prom. {pctTxt(gr.probMedia)}</span>
            <span className={gr.roi == null ? 'text-t3' : gr.roi >= 0 ? 'text-verde' : 'text-vermelho'}>
              · ROI {gr.roi == null ? '—' : `${gr.roi >= 0 ? '+' : ''}${gr.roi.toFixed(0)}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
