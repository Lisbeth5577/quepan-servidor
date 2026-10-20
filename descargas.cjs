"use strict";
const fs = require("node:fs");
const { createHash } = require("node:crypto");
// Solo este APK publico. Ninguna ruta proporcionada por el visitante se abre como archivo.
function conDescargas(operar, archivo) {
  const datos = fs.readFileSync(archivo);
  const sha = createHash("sha256").update(datos).digest("hex");
  const ruta = "/descargas/SIPROPAN-1.5-reportes.apk";
  const pagina = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SIPROPAN · Android</title><style>body{font:18px system-ui;max-width:640px;margin:48px auto;padding:24px;background:#fff8ee;color:#382719}a{display:inline-block;background:#754326;color:white;padding:16px 22px;border-radius:12px;text-decoration:none}small{overflow-wrap:anywhere}</style><h1>SIPROPAN</h1><h2>Panadería San Carlos</h2><p>Aplicación académica para Android · versión 1.5</p><p><a href="${ruta}">Descargar actualización</a></p><p>Instala la actualización conservando la aplicación existente. No la desinstales.</p><p>Después abre SIPROPAN y utiliza tu cuenta asignada. Las operaciones se conectan por internet, sin cable USB.</p><p>La primera conexión puede tardar aproximadamente un minuto si el servidor está en reposo.</p><small>SHA256: ${sha}</small></html>`;
  return (req, res) => {
    if (!["GET", "HEAD"].includes(req.method) || !["/", ruta].includes(req.url))
      return operar(req, res);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    if (req.url === ruta) {
      res.writeHead(200, { "Content-Type": "application/vnd.android.package-archive", "Content-Disposition": 'attachment; filename="SIPROPAN-1.5-reportes.apk"', "Content-Length": datos.length, "Cache-Control": "public, max-age=3600", ETag: '"' + sha + '"' });
      return res.end(req.method === "HEAD" ? undefined : datos);
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : pagina);
  };
}
module.exports = { conDescargas };
