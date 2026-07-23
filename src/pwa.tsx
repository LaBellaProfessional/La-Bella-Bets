import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * ATUALIZAÇÃO DE VERSÃO NO PRÓPRIO APP — fim do apagar-e-recriar-atalho.
 *
 * O PWA (service worker + precache) segura o bundle antigo até uma troca voluntária. Com
 * registerType 'prompt', quando há um SW novo ESPERANDO, mostramos um banner discreto no topo;
 * o clique faz skipWaiting + reload. Login e rascunhos vivem no Supabase, então o reload não perde
 * nada.
 *
 * CHECAGEM ATIVA (o iOS só descobre versão nova quando quer): força `registration.update()` ao
 * registrar, a cada 60 min com o app aberto, e ao voltar do background (visibilitychange/focus).
 *
 * COMPATIBILIDADE COM A GUARDA DE BOOT (index.html): o reload do update é uma navegação normal —
 * NÃO usa o `?v=`. A guarda só age quando o boot FALHA (app não montou / asset 404 / timeout). São
 * mecanismos distintos: guarda = recuperação de falha; update = troca voluntária de versão.
 */

/** Versão do build pro rodapé do Config: "abc1234 · 2026-07-23 18:40". */
export const VERSAO_APP = __APP_VERSION__;
export const BUILD_APP = __APP_BUILT__;

const SESSENTA_MIN = 60 * 60 * 1000;

export function BannerAtualizacao() {
  const regRef = useRef<ServiceWorkerRegistration | null>(null);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, r) {
      regRef.current = r ?? null;
      if (r) {
        r.update();                                  // checa já ao registrar
        setInterval(() => r.update(), SESSENTA_MIN); // e a cada 60 min com o app aberto
      }
    },
  });

  useEffect(() => {
    // Ao voltar do background / focar a aba: o momento em que o iOS mais precisa de um empurrão.
    const checar = () => { if (document.visibilityState === 'visible') regRef.current?.update(); };
    document.addEventListener('visibilitychange', checar);
    window.addEventListener('focus', checar);
    return () => {
      document.removeEventListener('visibilitychange', checar);
      window.removeEventListener('focus', checar);
    };
  }, []);

  if (!needRefresh) return null;

  return (
    <div className="safe-top fixed inset-x-0 top-0 z-50 border-b border-rosa/40 bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2">
        <span className="flex-1 text-xs text-t2">
          <b className="text-t1">Nova versão disponível</b> — atualize pra ver as novidades.
        </span>
        <button
          onClick={() => updateServiceWorker(true)}
          className="shrink-0 rounded bg-rosa px-3 py-1.5 text-xs font-semibold text-white"
        >
          Atualizar agora
        </button>
      </div>
    </div>
  );
}
