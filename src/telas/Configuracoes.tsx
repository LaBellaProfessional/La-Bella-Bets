import { useEffect, useState } from 'react';
import type { Config } from '../dados';

const ROTULO_FILTRO: Record<string, string> = {
  odd_minima_perna: 'Odd mínima por perna',
  ev_minimo: 'EV mínimo (1.03 = +3%)',
  divergencia_maxima_pp: 'Divergência máxima entre modelos (p.p.)',
  amostra_minima_mando: 'Amostra mínima no mando (jogos)',
  odd_bilhete_min: 'Odd mínima do bilhete',
  odd_bilhete_max: 'Odd máxima do bilhete',
  max_bilhetes_dia: 'Máximo de bilhetes por dia',
  confianca_maxima_prob: 'Confiança máxima: prob mínima',
  confianca_maxima_ev: 'Confiança máxima: EV mínimo',
  ah_vantagem_minima_pp: 'Handicap: vantagem mínima vs DC (p.p.)',
  ev_teto_suspeito: 'Teto de EV plausível (acima disso descarta)',
};

export function Configuracoes({ config, onSalvar }: { config: Config; onSalvar: (c: Config) => void }) {
  const [c, setC] = useState<Config>(config);
  const [salvo, setSalvo] = useState(false);
  useEffect(() => setC(config), [config]);

  const set = (patch: Partial<Config>) => { setC({ ...c, ...patch }); setSalvo(false); };
  const setFiltro = (k: string, v: number) => { setC({ ...c, filtros: { ...c.filtros, [k]: v } }); setSalvo(false); };

  return (
    <div className="space-y-4">
      <Secao titulo="Banca e stake">
        <Campo rotulo="Banca atual (R$)" valor={c.banca} onChange={(v) => set({ banca: v })} step={0.01} />
        <Campo rotulo="Stake padrão (%)" valor={c.stake_padrao_pct} onChange={(v) => set({ stake_padrao_pct: v })} step={0.5} />
        <Campo rotulo="Stake confiança máxima (%)" valor={c.stake_confianca_maxima_pct} onChange={(v) => set({ stake_confianca_maxima_pct: v })} step={0.5} />
        <Campo rotulo="Teto de exposição diária (%)" valor={c.teto_exposicao_diaria_pct} onChange={(v) => set({ teto_exposicao_diaria_pct: v })} step={0.5} />
      </Secao>

      <Secao titulo="Filtros do método">
        {Object.entries(c.filtros).map(([k, v]) => (
          <Campo key={k} rotulo={ROTULO_FILTRO[k] ?? k} valor={v} onChange={(n) => setFiltro(k, n)} step={0.01} />
        ))}
      </Secao>

      <Secao titulo="Ligas">
        <div className="col-span-full grid gap-2 sm:grid-cols-2">
          {c.ligas.map((l, i) => (
            <label key={l.id} className="flex cursor-pointer items-center gap-2 rounded border border-borda bg-fundo px-3 py-2 text-sm">
              <input
                type="checkbox" checked={l.ativa}
                onChange={(e) => {
                  const ligas = [...c.ligas];
                  ligas[i] = { ...l, ativa: e.target.checked };
                  set({ ligas });
                }}
              />
              <span className={l.ativa ? 'text-t1' : 'text-t3'}>{l.nome}</span>
              <span className="ml-auto text-[10px] text-t3">{l.pais}</span>
            </label>
          ))}
        </div>
      </Secao>

      <Secao titulo="Chaves de API">
        <p className="col-span-full text-sm text-t2">
          As chaves ficam no arquivo <code className="text-azul">.env</code> na raiz do projeto (nunca no
          JSON, nunca no git). Copie o <code className="text-azul">.env.example</code>, preencha e rode
          o motor de novo — ele sai do modo demo sozinho.
        </p>
        <pre className="col-span-full overflow-x-auto rounded bg-fundo p-3 text-xs text-t2">
{`API_FOOTBALL_KEY=sua_chave
ODDS_API_KEY=sua_chave`}
        </pre>
      </Secao>

      <div className="flex items-center gap-3">
        <button
          onClick={() => { onSalvar(c); setSalvo(true); }}
          className="rounded bg-rosa px-5 py-2 text-sm font-semibold text-white"
        >
          Salvar em data/config.json
        </button>
        {salvo && <span className="text-sm text-verde">salvo ✓ — rode o motor de novo para aplicar</span>}
      </div>
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-borda bg-card p-4">
      <div className="mb-3 text-xs uppercase tracking-widest text-t3">{titulo}</div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Campo({ rotulo, valor, onChange, step = 1 }: { rotulo: string; valor: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="block">
      <span className="text-xs text-t2">{rotulo}</span>
      <input
        type="number" step={step} value={valor}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded border border-borda bg-fundo px-3 py-2 text-sm text-t1 outline-none focus:border-azul"
      />
    </label>
  );
}
