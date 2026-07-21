/**
 * MEDIR-VIEWPORT — caça elementos que estouram a largura da tela.
 *
 * Regra do projeto: NUNCA scroll lateral no mobile. O problema é que "a tela rola pro lado"
 * tem duas causas que parecem iguais no dedo e são muito diferentes no código:
 *
 *   1. a PÁGINA rola  — scrollWidth > clientWidth. Alguém estourou o body.
 *   2. um CONTAINER interno rola — a página está certa, mas tem uma tabela de 520px dentro
 *      de um card de 358px com overflow-x-auto. Pro usuário é a mesma sensação.
 *
 * Foi exatamente o caso 2 que gerou o bug de 21/07 na aba Análises, e olhar o CSS não
 * respondia: só medindo. Este script mede as duas coisas e diz QUAL elemento é o culpado.
 *
 * Roda o Chrome headless via CDP puro — sem puppeteer, sem playwright, sem instalar nada.
 *
 * USO
 *   node scripts/medir-viewport.mjs <url> [largura] [altura]
 *   node scripts/medir-viewport.mjs http://localhost:5173/ 390 844
 *
 * SAÍDA
 *   { clientWidth, scrollWidth, rolaLateral, culpados: [...], containersRolantes: [...] }
 *   Sai com código 1 quando encontra problema — dá pra usar em CI.
 *
 * TELA ATRÁS DE LOGIN
 *   O dash exige sessão, então medir a tela de login não prova nada sobre as telas que têm
 *   conteúdo. Nesse caso monte um harness: um .tsx que renderiza os componentes com um
 *   payload real de `analises` injetado em window, e aponte este script pra ele. Foi assim
 *   que a tabela de 520px foi encontrada.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CAMINHOS_CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const URL_ALVO = process.argv[2];
const LARGURA = Number(process.argv[3] ?? 390);
const ALTURA = Number(process.argv[4] ?? 844);
const PORTA = 9333;

if (!URL_ALVO) {
  console.error('uso: node scripts/medir-viewport.mjs <url> [largura=390] [altura=844]');
  process.exit(2);
}

const chromeBin = CAMINHOS_CHROME.find((c) => c && existsSync(c));
if (!chromeBin) {
  console.error('Chrome não encontrado. Caminhos testados:\n  ' + CAMINHOS_CHROME.join('\n  '));
  process.exit(2);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(chromeBin, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORTA}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'medir-viewport-'))}`,
  `--window-size=${LARGURA},${ALTURA}`, '--no-first-run', '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });

async function paginaCDP() {
  for (let i = 0; i < 40; i++) {
    try {
      const alvos = await (await fetch(`http://127.0.0.1:${PORTA}/json/list`)).json();
      const p = alvos.find((t) => t.type === 'page');
      if (p) return p;
    } catch { /* Chrome ainda subindo */ }
    await dormir(300);
  }
  throw new Error(`Chrome não respondeu no CDP (porta ${PORTA} ocupada por uma instância antiga?)`);
}

/** Abre tudo que esconde conteúdo: o elemento largo costuma estar atrás de um toggle. */
const ABRIR = `(() => {
  document.querySelectorAll('input[type=checkbox]').forEach((c) => { if (!c.checked) c.click(); });
  document.querySelectorAll('button,summary').forEach((b) => {
    if (/ver |mostrar|detalhe|ignorados|números|numeros|\\u25bc/i.test(b.textContent || '')) b.click();
  });
  return 'ok';
})()`;

const DETECTOR = `(() => {
  const limite = document.documentElement.clientWidth;
  const fora = [];
  const rolantes = [];
  const nome = (el) => el.tagName.toLowerCase() +
    (typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 4).join('.') : '');

  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;

    // (1) Elemento que passa da viewport. Só o mais externo interessa: um filho largo
    // arrasta todos os pais, e listar a árvore inteira esconde o culpado real.
    if (r.right > limite + 1 || r.left < -1) {
      if (!fora.some((f) => f.el.contains(el))) {
        fora.push({ el, elemento: nome(el), left: Math.round(r.left), right: Math.round(r.right),
                    largura: Math.round(r.width), texto: (el.textContent || '').trim().slice(0, 60) });
      }
    }

    // (2) Container que rola sozinho. A página pode estar impecável e o dedo ainda
    // arrastar a tela pro lado por causa de um destes.
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow === 'auto' || overflow === 'scroll') {
        rolantes.push({ elemento: nome(el), visivel: el.clientWidth, conteudo: el.scrollWidth,
                        excedente: el.scrollWidth - el.clientWidth });
      }
    }
  }

  return JSON.stringify({
    clientWidth: limite,
    scrollWidth: document.documentElement.scrollWidth,
    rolaLateral: document.documentElement.scrollWidth > limite,
    culpados: fora.map(({ el, ...r }) => r),
    containersRolantes: rolantes,
  }, null, 1);
})()`;

const pagina = await paginaCDP();
const ws = new WebSocket(pagina.webSocketDebuggerUrl);
let seq = 0;
const pendentes = new Map();
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pendentes.has(msg.id)) { pendentes.get(msg.id)(msg); pendentes.delete(msg.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const enviar = (method, params) =>
  new Promise((res) => { const i = ++seq; pendentes.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await enviar('Page.enable', {});
await enviar('Emulation.setDeviceMetricsOverride', { width: LARGURA, height: ALTURA, deviceScaleFactor: 3, mobile: true });
await enviar('Page.navigate', { url: URL_ALVO });
await dormir(4000);
await enviar('Runtime.evaluate', { expression: ABRIR, returnByValue: true });
await dormir(800);
const r = await enviar('Runtime.evaluate', { expression: DETECTOR, returnByValue: true });

const bruto = r.result?.result?.value;
console.log(bruto ?? JSON.stringify(r));

ws.close();
chrome.kill();

// Código de saída acionável: 0 = tela limpa, 1 = tem o que consertar.
let problema = false;
try {
  const j = JSON.parse(bruto);
  problema = j.rolaLateral || j.culpados.length > 0 || j.containersRolantes.length > 0;
  if (problema) {
    console.error(`\n✗ ${LARGURA}px: ${j.culpados.length} elemento(s) estourando, ` +
      `${j.containersRolantes.length} container(es) rolando na horizontal.`);
  } else {
    console.error(`\n✓ ${LARGURA}px: nada estoura a largura e nada rola na horizontal.`);
  }
} catch { problema = true; }
process.exit(problema ? 1 : 0);
