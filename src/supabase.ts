import { createClient } from '@supabase/supabase-js';

/**
 * Cliente único do dash. Só a PUBLISHABLE key vai pro browser — a secret vive nos
 * secrets das edge functions. Sessão persistida: o iPhone reabre o PWA já logado.
 */
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
  { auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage } },
);

/** Invoca uma edge function com o token da sessão (a function exige autenticação). */
export async function invocar(funcao: 'analisar' | 'bootstrap', corpo: Record<string, unknown> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('sem sessão');
  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${funcao}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(corpo),
  });
  const j = await r.json();
  if (!r.ok || j.ok === false) throw new Error(j.erro ?? j.message ?? `falha em ${funcao}`);
  return j;
}
