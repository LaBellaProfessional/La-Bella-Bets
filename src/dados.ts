import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, invocar } from './supabase';

export const ROTULO: Record<string, string> = {
  dupla_chance_casa: 'DC casa (1X)',
  dupla_chance_fora: 'DC fora (X2)',
  ah_casa_m05: 'AH casa -0.5',
  ah_casa_m10: 'AH casa -1.0',
  ah_fora_p05: 'AH fora +0.5',
};

/**
 * Mercados de LINHA são gerados, não tabelados: a casa publica a linha que quiser
 * (over 1.5, 2.5, escanteios 9.5…) e o dash tem que saber escrever qualquer uma.
 * Chave: `<lado>_<ponto sem o ponto>`, com prefixo `esc_` pra escanteios.
 */
export function rotuloMercado(mercado: string): string {
  if (ROTULO[mercado]) return ROTULO[mercado];
  const m = /^(esc_)?(over|under)_(\d+)$/.exec(mercado ?? '');
  if (!m) return mercado;
  const d = m[3];
  const linha = Number(d.slice(0, -1) || '0') + Number(d.slice(-1)) / 10;
  return `${m[2] === 'over' ? 'Over' : 'Under'} ${linha.toFixed(1)}${m[1] ? ' esc.' : ''}`;
}

export type Familia = 'resultado' | 'gols' | 'escanteios';

export function familiaDoMercado(mercado: string): Familia {
  if (String(mercado).startsWith('esc_')) return 'escanteios';
  if (/^(over|under)_\d+$/.test(String(mercado))) return 'gols';
  return 'resultado';
}

export const NOME_FAMILIA: Record<Familia, string> = {
  resultado: 'Resultado', gols: 'Gols', escanteios: 'Escanteios',
};

export interface Perna {
  horizonte_dias?: number;
  radar?: boolean;
  motivo_radar?: string;
  trajetoria?: { primeira_odd: number; melhor_odd: number; odd_atual: number | null; observacoes: number; idade_horas: number; movimento: number | null };
  jogo_id: string; partida: string; liga: string; hora: string;
  mercado: string; odd: number | null;
  prob_heuristica: number | null; prob_dixon_coles: number | null; prob_final?: number;
  ev?: number; ev_pct?: number; amostra_mando: number;
  aprovada: boolean; motivo?: string; confianca?: string;
  amostra_curta?: boolean; badge_amostra?: string | null; casa_odd?: string | null;
  justificativa?: string; elegivel_bilhete?: boolean; dixon_coles_disponivel?: boolean;
  // Escanteios: a API não publica preço, então a perna nasce sem odd e com a odd JUSTA
  // calculada pelo modelo. É o número contra o qual a odd digitada é comparada.
  sem_odd_referencia?: boolean; odd_justa?: number; lambda_escanteios?: number | null;
  stake_pct?: number; stake_rs?: number;
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
  jogos: { id: string; liga: string; hora: string; casa: string; fora: string; contagens?: unknown }[];
  pernas: Perna[]; bilhetes: Bilhete[];
  sem_bilhete: { motivo: string } | null;
  exposicao: { total_rs: number; pct_banca: number; teto_pct: number; teto_rs?: number } | null;
  config_efetivo?: { filtros: Record<string, number> };
  radar?: (Perna & { motivo_radar?: string; horizonte_dias?: number })[];
  horizonte_dias?: number;
  cards_handicap: (Perna & { vantagem_pp: number; stake_rs: number; observacao: string })[];
  avisos?: string[];
}

export interface Registro {
  id: string; data: string; registrado_em: string;
  pernas: { partida: string; mercado: string; odd: number }[];
  odd_total: number; odd_referencia?: number | null; casa_odd?: string | null; prob_combinada: number; ev_pct: number;
  stake_real: number; resultado: 'pendente' | 'ganhou' | 'perdeu';
  retorno_rs: number; banca_depois: number | null;
}

export interface Config {
  banca: number;
  id: number; stake_padrao_pct: number; stake_confianca_maxima_pct: number;
  teto_exposicao_diaria_pct: number;
  filtros: Record<string, number>;
  ligas: { id: number; nome: string; pais: string; ativa: boolean }[];
}

/* ─────────────────────────── QUERIES ─────────────────────────── */

export function useConfig() {
  return useQuery<Config>({
    queryKey: ['config'],
    queryFn: async () => {
      const { data, error } = await supabase.from('config').select('*').eq('id', 1).single();
      if (error) throw error;
      return data as Config;
    },
  });
}

/** Datas com análise, mais recente primeiro. */
export function useDatas() {
  return useQuery<string[]>({
    queryKey: ['datas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('analises').select('data').order('data', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((d) => d.data as string);
    },
  });
}

export function useAnalise(data: string | null) {
  return useQuery<Analise | null>({
    queryKey: ['analise', data],
    enabled: Boolean(data),
    queryFn: async () => {
      const { data: row, error } = await supabase.from('analises').select('payload,resumo').eq('data', data).maybeSingle();
      if (error) throw error;
      if (!row?.payload) return null;
      // Blindagem: analises gravadas antes do fix nao tinham 'resumo' dentro do payload —
      // so na coluna. Costurar aqui evita depender de todo payload historico estar perfeito.
      const p = row.payload as Analise;
      return { ...p, resumo: p.resumo ?? (row.resumo as Analise['resumo']) } as Analise;
    },
  });
}

export function useBilhetes() {
  return useQuery<Registro[]>({
    queryKey: ['bilhetes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bilhetes').select('*').order('registrado_em', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Registro[];
    },
  });
}

/* ─────────────────────────── MUTATIONS ─────────────────────────── */

export function useRegistrarBilhete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bilhete, data, valor }: { bilhete: Bilhete; data: string; valor: number }) => {
      const { error } = await supabase.from('bilhetes').insert({
        data,
        pernas: bilhete.pernas.map((p) => ({ partida: p.partida, mercado: p.mercado, odd: p.odd })),
        n_pernas: bilhete.n_pernas,
        odd_total: bilhete.odd_total,
        prob_combinada: bilhete.prob_combinada,
        ev_pct: bilhete.ev_pct,
        stake_sugerido: bilhete.stake_rs,
        stake_real: valor,
        // Segmentação pro breakdown — gravada no registro, não reprocessada depois.
        ligas: [...new Set(bilhete.pernas.map((p) => p.liga))],
        mercados: [...new Set(bilhete.pernas.map((p) => p.mercado))],
        faixa_odd: bilhete.odd_total < 1.5 ? '1.40-1.50' : bilhete.odd_total < 1.6 ? '1.50-1.60' : '1.60+',
        confianca: bilhete.todas_confianca_maxima ? 'maxima' : 'aprovada',
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bilhetes'] }),
  });
}

export function useDefinirResultado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ registro, resultado, banca }: { registro: Registro; resultado: 'ganhou' | 'perdeu'; banca: number }) => {
      const retorno = resultado === 'ganhou' ? +(registro.stake_real * registro.odd_total).toFixed(2) : 0;
      const bancaDepois = +(banca + retorno - registro.stake_real).toFixed(2);
      const { error } = await supabase.from('bilhetes').update({
        resultado, retorno_rs: retorno, banca_depois: bancaDepois, resolvido_em: new Date().toISOString(),
      }).eq('id', registro.id);
      if (error) throw error;
      // A banca só muda aqui: registrar o resultado é o ato que move dinheiro de verdade.
      const { error: e2 } = await supabase.from('config').update({ banca: bancaDepois }).eq('id', 1);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bilhetes'] });
      qc.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

export function useSalvarConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cfg: Config) => {
      const { error } = await supabase.from('config').update({
        banca: cfg.banca, stake_padrao_pct: cfg.stake_padrao_pct,
        stake_confianca_maxima_pct: cfg.stake_confianca_maxima_pct,
        teto_exposicao_diaria_pct: cfg.teto_exposicao_diaria_pct,
        filtros: cfg.filtros, ligas: cfg.ligas, atualizado_em: new Date().toISOString(),
      }).eq('id', 1);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });
}

export function useRodarMotor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ funcao, corpo }: { funcao: 'analisar' | 'bootstrap'; corpo?: Record<string, unknown> }) =>
      invocar(funcao, corpo ?? {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['datas'] });
      qc.invalidateQueries({ queryKey: ['analise'] });
    },
  });
}

export const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
export const pct = (v: number | null | undefined, casas = 0) =>
  v == null ? '—' : `${(v * 100).toFixed(casas)}%`;

/** Analises dos proximos dias (D+1..D+3) — alimenta 'oportunidades antecipadas'. */
export function useJanela(dataBase: string | null) {
  return useQuery<Analise[]>({
    queryKey: ['janela', dataBase],
    enabled: Boolean(dataBase),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('analises').select('payload')
        .gt('data', dataBase).order('data', { ascending: true }).limit(3);
      if (error) throw error;
      return (data ?? []).map((r) => r.payload as Analise);
    },
  });
}

/** Janela inteira a partir de hoje (SP): alimenta a aba Inicio, agrupada por dia. */
export function useJanelaCompleta(hoje: string) {
  return useQuery<Analise[]>({
    queryKey: ['janela-completa', hoje],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('analises').select('payload,resumo')
        .gte('data', hoje).order('data', { ascending: true }).limit(5);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const p = r.payload as Analise;
        return { ...p, resumo: p.resumo ?? (r.resumo as Analise['resumo']) };
      });
    },
  });
}

/** Registra a entrada com a odd REAL digitada; a odd do modelo fica como referencia (CLV). */
export function useRegistrarEntrada() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: {
      data: string; pernas: Perna[]; odd_real: number; odd_referencia: number;
      prob: number; stake: number; casa_odd: string | null;
    }) => {
      const { error } = await supabase.from('bilhetes').insert({
        data: e.data,
        pernas: e.pernas.map((p) => ({ partida: p.partida, mercado: p.mercado, odd: p.odd })),
        n_pernas: e.pernas.length,
        odd_total: e.odd_real,             // a odd REAL da aposta
        odd_referencia: e.odd_referencia,  // a que o modelo viu — a diferenca e o CLV
        casa_odd: e.casa_odd,
        prob_combinada: e.prob,
        ev_pct: (e.prob * e.odd_real - 1) * 100,
        stake_sugerido: e.stake,
        stake_real: e.stake,
        ligas: [...new Set(e.pernas.map((p) => p.liga))],
        mercados: [...new Set(e.pernas.map((p) => p.mercado))],
        faixa_odd: e.odd_real < 1.5 ? '1.40-1.50' : e.odd_real < 1.6 ? '1.50-1.60' : '1.60+',
        confianca: e.pernas.every((p) => p.confianca === 'CONFIANCA_MAXIMA') ? 'maxima' : 'aprovada',
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bilhetes'] }),
  });
}
