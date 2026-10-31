"use strict";
const fs = require("node:fs");
const { createHash } = require("node:crypto");
// Solo este APK publico. Ninguna ruta proporcionada por el visitante se abre como archivo.
function conDescargas(operar, archivo) {
  const datos = fs.readFileSync(archivo);
  const sha = createHash("sha256").update(datos).digest("hex");
  const ruta = "/descargas/QUEPAN-3.0.apk";
  const pagina = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Panadería San Carlos ¡Qué Pan! · Android</title><style>body{font:18px system-ui;max-width:640px;margin:48px auto;padding:24px;background:#f6f4ee;color:#4c362c}a{display:inline-block;background:#49634f;color:white;padding:16px 22px;border-radius:12px;text-decoration:none}small{overflow-wrap:anywhere}</style><img src="/web/pan-pixel.png" alt="Ilustración original de pan en pixel art" style="width:100%;border-radius:12px"><h1><span style="display:inline-block;width:64px;height:64px;vertical-align:middle"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><path fill="#49634F" d="M0,0H108V108H0Z"/><path fill="#5F7C63" d="M54,7A47,47 0,1 1,53.99,7Z"/><path fill="#456249" d="M54,14A40,40 0,1 1,53.99,14Z"/><path fill="#324E3B" d="M23,68C23,48 39,34 57,34C74,34 88,47 88,65C88,80 71,87 54,87C37,87 23,82 23,68Z"/><path fill="#C78F56" d="M20,62C20,44 35,29 54,29C73,29 88,44 88,62C88,76 73,82 54,82C35,82 20,76 20,62Z"/><path fill="#E9BF7F" d="M23,57C26,42 39,32 54,32C69,32 82,42 85,57C84,68 70,74 54,74C38,74 24,68 23,57Z"/><path fill="#F4D8A4" d="M29,48C34,39 44,35 54,35C63,35 73,39 78,47C66,42 42,42 29,48Z"/><path fill="#B77747" d="M35,45C37,43 40,42 42,43L51,55C53,59 49,62 46,59Z M49,38C51,36 54,36 56,39L65,51C67,55 63,58 60,54Z M64,41C66,39 69,40 71,43L77,51C79,55 75,58 72,54Z"/><path fill="#FFF0D0" d="M35,44C37,42 39,42 41,44L49,55C50,57 48,58 46,56Z M49,37C51,35 53,36 55,39L63,50C64,52 62,54 60,51Z M64,40C66,38 68,40 70,43L75,50C77,53 74,54 72,51Z"/><path fill="#DBAD7A" d="M31,66C43,73 65,74 78,66C72,76 41,79 31,66Z"/></svg></span> Panadería San Carlos</h1><h2>¡Qué Pan!</h2><p><strong>Recepción de pedidos:</strong> hasta las 6:00 p. m.<br><strong>Entregas:</strong> desde las 4:00 a. m. del día siguiente.</p><p><a href="/web/">Entrar al sistema web</a></p><p>Aplicación para Android · versión 3.0</p><p><a href="${ruta}">Descargar actualización</a></p><p>Instala la actualización conservando la aplicación existente. No la desinstales.</p><p>Después abre ¡Qué Pan! y utiliza tu cuenta asignada. Las operaciones se conectan por internet, sin cable USB.</p><p>La primera conexión puede tardar aproximadamente un minuto si el servidor está en reposo.</p></html>`;
  return (req, res) => {
    if (!["GET", "HEAD"].includes(req.method) || !["/", ruta].includes(req.url))
      return operar(req, res);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (req.url === ruta) {
      res.writeHead(200, {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Disposition": 'attachment; filename="QUEPAN-3.0.apk"',
        "Content-Length": datos.length,
        "Cache-Control": "public, max-age=3600",
        ETag: '"' + sha + '"',
      });
      return res.end(req.method === "HEAD" ? undefined : datos);
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : pagina);
  };
}
module.exports = { conDescargas };
