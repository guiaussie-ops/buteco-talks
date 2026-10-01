// Servidor estático mínimo para o laboratório de ruído.
//
// Não usa o vite do app de propósito: a página é solta, não tem build, e não
// pode acabar sendo publicada junto com o app. localhost já conta como contexto
// seguro, então o getUserMedia funciona sem certificado.
//
//   node lab/servidor.mjs
//
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const RAIZ = resolve(import.meta.dirname);
const PORTA = Number(process.env.PORTA ?? 5180);

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const servidor = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    // normalize + prefixo obrigatório: barra a travessia de diretório com "..".
    let caminho = normalize(join(RAIZ, decodeURIComponent(url.pathname)));
    if (!caminho.startsWith(RAIZ)) {
      res.writeHead(403).end("fora da raiz");
      return;
    }
    const info = await stat(caminho).catch(() => null);
    if (info?.isDirectory()) caminho = join(caminho, "index.html");

    const corpo = await readFile(caminho);
    res.writeHead(200, {
      "content-type": TIPOS[extname(caminho)] ?? "application/octet-stream",
      // Sem cache: editar a página e recarregar tem que mostrar a versão nova.
      "cache-control": "no-store",
    });
    res.end(corpo);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("não achei");
  }
});

servidor.listen(PORTA, () => {
  console.log(`\n  Laboratório de ruído no ar:\n`);
  console.log(`      http://localhost:${PORTA}/ruido/\n`);
  console.log(`  Ctrl+C para parar.\n`);
});
