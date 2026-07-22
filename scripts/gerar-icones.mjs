/**
 * GERAR-ÍCONES — produz os PNGs do PWA a partir da logo original.
 *
 * Por que via Chrome headless e não com uma biblioteca de imagem: o projeto não tem sharp nem
 * jimp, e adicionar dependência só pra isso não se paga — o Chrome já está aqui (é o mesmo que
 * o medir-viewport usa) e faz recorte, recolorização e reamostragem com qualidade melhor.
 *
 * O QUE ACONTECE COM A LOGO (importante):
 *
 * A logo original é PRETA sobre BRANCO — hexágono e "BB" em preto, seta em rosa. Colocada
 * direto sobre o fundo escuro do dash, a parte preta simplesmente desaparece: sobraria uma
 * seta rosa flutuando. Então este script gera a VARIANTE ESCURA da marca: o preto vira branco
 * quente, a seta rosa continua rosa, o branco do fundo é descartado. É a mesma logo, lida em
 * fundo escuro — não é um ícone novo.
 *
 * A recolorização usa saturação, não igualdade de cor: pixel saturado é tinta colorida (a seta)
 * e passa intacto; pixel cinza/preto vira branco com alfa proporcional ao quanto era escuro —
 * é isso que preserva o antialiasing das bordas em vez de deixá-las serrilhadas.
 *
 *   node scripts/gerar-icones.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FUNDO = '#0d0f14';           // o dark real do dash (src/index.css e tailwind.config.js)
const TINTA = '#f2f4f8';           // o preto da logo relido para fundo escuro
const ORIGEM = 'assets-fonte/logo-bella-bets.jpeg';
const DESTINO = 'public';

/** [arquivo, lado, respiro] — respiro é a fração livre em cada borda. */
const ICONES = [
  ['apple-touch-icon.png', 180, 0.15],   // iOS: fundo sólido obrigatório, sem transparência
  ['icone-192.png', 192, 0.15],
  ['icone-512.png', 512, 0.15],
  ['icone-512-maskable.png', 512, 0.26], // maskable: o sistema recorta até 20% de cada borda
  ['favicon-32.png', 32, 0.08],          // favicon é minúsculo: respiro menor pra logo ser legível
  ['favicon-16.png', 16, 0.06],
];

const CAMINHOS_CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const chromeBin = CAMINHOS_CHROME.find((c) => c && existsSync(c));
if (!chromeBin) { console.error('Chrome não encontrado.'); process.exit(2); }
if (!existsSync(ORIGEM)) { console.error(`logo não encontrada em ${ORIGEM}`); process.exit(2); }

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const base64 = readFileSync(ORIGEM).toString('base64');
const trabalho = mkdtempSync(join(tmpdir(), 'icones-'));

const PAGINA = `<!doctype html><meta charset="utf-8"><body style="margin:0">
<img id="src" src="data:image/jpeg;base64,${base64}">
<script>
window.__pronto = new Promise((ok) => {
  const img = document.getElementById('src');
  if (img.complete) ok(); else img.onload = () => ok();
});

/** Separa a tinta do papel: devolve um canvas com fundo transparente e o preto virado claro. */
window.__recolorir = function () {
  const img = document.getElementById('src');
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  const tinta = ${JSON.stringify(TINTA)};
  const tr = parseInt(tinta.slice(1, 3), 16), tg = parseInt(tinta.slice(3, 5), 16), tb = parseInt(tinta.slice(5, 7), 16);

  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;

    if (sat > 0.25) continue;                    // tinta COLORIDA (a seta rosa): passa intacta

    // Cinza/preto/branco: o quanto é escuro vira o quanto é opaco. Branco do papel some,
    // preto vira tinta clara sólida, e o meio-termo do antialiasing vira alfa parcial.
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    p[i] = tr; p[i + 1] = tg; p[i + 2] = tb;
    p[i + 3] = Math.max(0, Math.min(255, Math.round(255 - lum)));
  }
  x.putImageData(d, 0, 0);
  return c;
};

/** Recorta a moldura vazia: a logo vem com margem branca larga que desperdiçaria o ícone. */
window.__recortar = function (c) {
  const x = c.getContext('2d');
  const p = x.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let xx = 0; xx < c.width; xx++) {
      if (p[(y * c.width + xx) * 4 + 3] > 12) {
        if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { c, x0: 0, y0: 0, w: c.width, h: c.height };
  return { c, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};

window.__gerar = async function (lado, respiro) {
  await window.__pronto;
  const rec = window.__recortar(window.__recolorir());

  const out = document.createElement('canvas');
  out.width = lado; out.height = lado;
  const o = out.getContext('2d');
  o.imageSmoothingEnabled = true; o.imageSmoothingQuality = 'high';
  o.fillStyle = ${JSON.stringify(FUNDO)};
  o.fillRect(0, 0, lado, lado);                  // fundo SÓLIDO: iOS põe preto atrás de PNG transparente

  // Encaixe proporcional: a logo é mais larga que alta, então cabe pela largura e fica
  // centralizada na vertical. Esticar pra preencher deformaria a marca.
  const util = lado * (1 - 2 * respiro);
  const escala = Math.min(util / rec.w, util / rec.h);
  const w = rec.w * escala, h = rec.h * escala;
  o.drawImage(rec.c, rec.x0, rec.y0, rec.w, rec.h, (lado - w) / 2, (lado - h) / 2, w, h);
  return out.toDataURL('image/png');
};
<\/script></body>`;

const arquivoPagina = join(trabalho, 'gerar.html');
writeFileSync(arquivoPagina, PAGINA);

const PORTA = Number(process.env.CDP_PORT ?? 9200 + (process.pid % 90));
const chrome = spawn(chromeBin, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORTA}`,
  `--user-data-dir=${join(trabalho, 'perfil')}`, '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', 'about:blank',
], { stdio: 'ignore' });

async function paginaCDP() {
  for (let i = 0; i < 40; i++) {
    try {
      const alvos = await (await fetch(`http://127.0.0.1:${PORTA}/json/list`)).json();
      const p = alvos.find((t) => t.type === 'page');
      if (p) return p;
    } catch { /* subindo */ }
    await dormir(300);
  }
  throw new Error('Chrome não respondeu no CDP');
}

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
await enviar('Page.navigate', { url: 'file:///' + arquivoPagina.replace(/\\/g, '/') });
await dormir(2500);

mkdirSync(DESTINO, { recursive: true });
for (const [arquivo, lado, respiro] of ICONES) {
  const r = await enviar('Runtime.evaluate', {
    expression: `window.__gerar(${lado}, ${respiro})`,
    awaitPromise: true, returnByValue: true,
  });
  const dataUrl = r.result?.result?.value;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) {
    console.error(`falhou ${arquivo}:`, JSON.stringify(r).slice(0, 300));
    continue;
  }
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  writeFileSync(join(DESTINO, arquivo), buf);
  console.log(`  ${arquivo.padEnd(26)} ${String(lado).padStart(3)}px  respiro ${(respiro * 100).toFixed(0)}%  ${(buf.length / 1024).toFixed(1)} KB`);
}

ws.close();
chrome.kill();
console.log(`\nfundo ${FUNDO} · tinta ${TINTA} · origem ${ORIGEM}`);
process.exit(0);
