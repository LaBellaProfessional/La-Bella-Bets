import { useCallback, useEffect, useState } from 'react';

export const ROTULO: Record<string, string> = {
  dupla_chance_casa: 'DC casa (1X)',
  dupla_chance_fora: 'DC fora (X2)',
  over_05: 'Over 0.5',
  over_15: 'Over 1.5',
  under_45: 'Under 4.5',
  ah_casa_m05: 'AH casa -0.5',
  ah_casa_m10: 'AH casa -1.0',
  ah_fora_p05: 'AH fora +0.5',
};

export interface Perna {
  jogo_id: string; partida: string; liga: string; hora: string;
  mercado: string; odd: number | null;
  prob_heuristica: number | null; prob_dixon_coles: number | null; prob_final?: number;
  ev?: number; ev_pct?: number; amostra_mando: number;
  aprovada: boolean; motivo?: string; confianca?: string;
  justificativa?: string; elegivel_bilhete?: boolean; dixon_coles_disponivel?: boolean;
}

export interface Bilhete {
  ordem: number; pernas: Perna[]; n_pernas: number; odd_total: number;
  prob_combinada: number; valor_justo: number; ev: number; ev_pct: number;
  n_confianca_maxima: number; todas_confianca_maxima: boolean;
  correlacao_intra_jogo: boolean; stake_pct: number; stake_rs: number;
}

export interface Analise {
  data: string; modo: 'demo' | 'real'; gerado_em: string; banca_no_momento: number;
  resumo: { jogos: number; pernas_avaliadas: number; aprovadas: number; descartadas: number; bilhetes: number; sem_bilhete: boolean };
  dixon_coles_por_liga: Record<string, { disponivel: boolean; motivo: string | null; n_jogos: number }>;
  jogos: { id: string; liga: string; hora: string; casa: string; fora: string }[];
  pernas: Perna[]; bilhetes: Bilhete[];
  sem_bilhete: { motivo: string } | null;
  exposicao: { total_rs: number; pct_banca: number; teto_pct: number; teto_rs?: number } | null;
  config_efetivo?: { filtros: Record<string, number>; pesos_heuristica: unknown; dixon_coles: unknown };
  cards_handicap: (Perna & { vantagem_pp: number; stake_rs: number; observacao: string })[];
}

export interface Registro {
  id: string; data: string; registrado_em: string;
  pernas: { partida: string; mercado: string; odd: number }[];
  odd_total: number; prob_combinada: number; ev_pct: number;
  stake_rs: number; resultado: 'pendente' | 'ganhou' | 'perdeu';
  retorno_rs: number; banca_depois: number | null;
}

export interface Config {
  banca: number; stake_padrao_pct: number; stake_confianca_maxima_pct: number;
  teto_exposicao_diaria_pct: number;
  filtros: Record<string, number>;
  ligas: { id: number; nome: string; pais: string; ativa: boolean }[];
}

interface Dados { config: Config; bilhetes: Registro[]; datas: string[]; analises: Record<string, Analise> }

export function useDados() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/dados');
      if (!r.ok) throw new Error(`API ${r.status}`);
      setDados(await r.json());
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'falha ao carregar /data');
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const salvarBilhetes = useCallback(async (lista: Registro[]) => {
    await fetch('/api/bilhetes', { method: 'POST', body: JSON.stringify(lista) });
    await carregar();
  }, [carregar]);

  const salvarConfig = useCallback(async (cfg: Config) => {
    await fetch('/api/config', { method: 'POST', body: JSON.stringify(cfg) });
    await carregar();
  }, [carregar]);

  return { dados, erro, recarregar: carregar, salvarBilhetes, salvarConfig };
}

export const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
export const pct = (v: number | null | undefined, casas = 0) =>
  v == null ? '—' : `${(v * 100).toFixed(casas)}%`;
