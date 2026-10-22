"use strict";
const fs = require("node:fs");
const { createHash } = require("node:crypto");
// Solo este APK publico. Ninguna ruta proporcionada por el visitante se abre como archivo.
function conDescargas(operar, archivo) {
  const datos = fs.readFileSync(archivo);
  const sha = createHash("sha256").update(datos).digest("hex");
  const ruta = "/descargas/QUEPAN-2.2.apk";
  const pagina = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Panadería San Carlos QUE PAN · Android</title><style>body{font:18px system-ui;max-width:640px;margin:48px auto;padding:24px;background:#f6f4ee;color:#4c362c}a{display:inline-block;background:#49634f;color:white;padding:16px 22px;border-radius:12px;text-decoration:none}small{overflow-wrap:anywhere}</style><img src="/web/pan-pixel.png" alt="Ilustración original de pan en pixel art" style="width:100%;border-radius:12px"><h1><span style="display:inline-block;width:64px;height:64px;vertical-align:middle"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" shape-rendering="crispEdges"><path fill="#49634F" d="M0,0H64V64H0Z"/><path fill="#789078" d="M8,8H56V56H8Z"/><path fill="#A3B09A" d="M12,12H52V52H12Z"/><path fill="#35523F" d="M16,40H20V44H48V40H52V28H48V20H40V16H28V20H20V24H16Z"/><path fill="#D7AE72" d="M20,36H24V40H44V36H48V28H44V24H40V20H28V24H24V28H20Z"/><path fill="#F2DFB5" d="M20,28H24V24H28V20H40V24H44V28H48V32H20Z"/><path fill="#FFF0D2" d="M24,24H28V28H32V32H28V28H24Z M32,20H36V24H40V28H36V24H32Z"/><path fill="#C28E77" d="M24,44H44V48H24Z"/></svg></span> Panadería San Carlos</h1><h2>QUE PAN</h2><p><a href="/web/">Entrar al sistema web</a></p><p>Aplicación para Android · versión 2.2</p><p><a href="${ruta}">Descargar actualización</a></p><p>Instala la actualización conservando la aplicación existente. No la desinstales.</p><p>Después abre QUE PAN y utiliza tu cuenta asignada. Las operaciones se conectan por internet, sin cable USB.</p><p>La primera conexión puede tardar aproximadamente un minuto si el servidor está en reposo.</p></html>`;
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
        "Content-Disposition": 'attachment; filename="QUEPAN-2.2.apk"',
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
