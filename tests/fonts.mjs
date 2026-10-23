// Local stand-in for Google Fonts in screenshots/tests (the sandbox has no internet).
// Serves the same families from @fontsource packages: Archivo (wdth axis), Gloock, Prompt.
import fs from 'node:fs';
import path from 'node:path';

const NM = path.resolve(import.meta.dirname, '../tools/node_modules');
const SHEETS = [
  ['@fontsource-variable/archivo', 'wdth.css', 'Archivo Variable', 'Archivo'],
  ['@fontsource/gloock', '400.css', 'Gloock', 'Gloock'],
  ...[300, 400, 500, 600, 700].map((w) => ['@fontsource/prompt', `${w}.css`, 'Prompt', 'Prompt']),
];

export function fontCss(origin) {
  return SHEETS.map(([pkg, file, from, to]) => fs.readFileSync(path.join(NM, pkg, file), 'utf8')
    .replaceAll(`'${from}'`, `'${to}'`)
    .replace(/url\(\.\/files\//g, `url(${origin}/__fonts/${pkg}/files/`)).join('\n');
}

// Returns true when it handled the request.
export function serveFont(req, res) {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith('/__fonts/')) return false;
  const file = path.join(NM, p.slice('/__fonts/'.length));
  if (!file.startsWith(NM) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return true; }
  res.writeHead(200, { 'Content-Type': 'font/woff2', 'Access-Control-Allow-Origin': '*' });
  fs.createReadStream(file).pipe(res);
  return true;
}
