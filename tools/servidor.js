/* Servidor local para tools/demo.js y tools/video.js.
 * Sirve la app tal cual, salvo vendor/supabase.js (lo reemplaza el Supabase simulado de
 * las pruebas) y js/config.js (apunta a un proyecto inexistente): nada llega a la base real.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function servidor() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    if (p === '/vendor/supabase.js') p = '/tests/e2e/supabase-falso.js';
    if (p === '/js/config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      return res.end("window.QOS_CONFIG = { supabaseUrl: 'http://demo', supabaseKey: 'demo' };");
    }
    const archivo = path.join(RAIZ, p);
    if (!archivo.startsWith(RAIZ) || !fs.existsSync(archivo)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    fs.createReadStream(archivo).pipe(res);
  });
}

module.exports = { servidor, RAIZ };
