"use strict";
const fs = require("fs"),
  path = require("path"),
  d = require("./domain"),
  { consultar } = require("./consultas.cjs");
const { generarDashboard } = require("./dashboard.cjs");
const ORIGEN = (process.env.RENDER_EXTERNAL_URL || "https://quepan-panaderia-san-carlos.onrender.com").replace(/\/$/, "");
function conWeb(
  siguiente,
  { db, verificar, directorio = __dirname, origen = ORIGEN },
) {
  const conexiones = new Set();
  const archivos = {
    "/web/": "index.html",
    "/web/index.html": "index.html",
    "/web/panaderia.js": "panaderia.js",
    "/web/dashboard-ui.js": "dashboard-ui.js",
    "/web/panaderia.css": "panaderia.css",
    "/web/pan-pixel.png": "pan-pixel.png",
  };
  const manejar = async (req, res) => {
    const url = new URL(req.url, origen);
    if (req.method === "GET" && Object.hasOwn(archivos, url.pathname)) {
      const file = archivos[url.pathname],
        tipo = file.endsWith(".html")
          ? "text/html; charset=utf-8"
          : file.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : file.endsWith(".png")
              ? "image/png"
              : "text/css; charset=utf-8";
      res.writeHead(200, {
        "Content-Type": tipo,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      });
      return res.end(fs.readFileSync(path.join(directorio, file)));
    }
    if (
      req.method !== "GET" ||
      !["/api/perfil", "/api/datos", "/api/eventos", "/api/dashboard"].includes(
        url.pathname,
      )
    )
      return siguiente(req, res);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      d.exigir(
        !req.headers.origin || req.headers.origin === origen,
        "Origen web no permitido",
        "permission-denied",
      );
      const token = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || "");
      d.exigir(token, "Inicia sesión", "unauthenticated");
      let identidad;
      try {
        identidad = await verificar(token[1]);
      } catch {
        throw new d.ErrorNegocio(
          "Sesión no válida o vencida",
          "unauthenticated",
        );
      }
      const p = (await db.doc("usuarios/" + identidad.uid).get()).data();
      d.perfil(p);
      if (url.pathname === "/api/eventos") {
        let cerrado = false,
          timer;
        const paradas = [];
        const cerrar = () => {
          if (cerrado) return;
          cerrado = true;
          paradas.forEach((fn) => fn());
          clearTimeout(timer);
          clearInterval(ping);
          clearTimeout(expiry);
          conexiones.delete(cerrar);
          if (!res.destroyed) res.end();
        };
        const ping = setInterval(() => {
            if (!cerrado) res.write(": activo\n\n");
          }, 20000),
          expiry = setTimeout(cerrar, 45 * 60000);
        res.on("close", cerrar);
        conexiones.add(cerrar);
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        const enviar = () => {
          clearTimeout(timer);
          if (!cerrado)
            timer = setTimeout(() => {
              if (!cerrado) res.write("event: actualizar\ndata: {}\n\n");
            }, 200);
        };
        for (const c of [
          "descuentos",
          "solicitudes_produccion",
          "productos",
          "inventario_sucursales",
          "pedidos",
          "sucursales",
          "ingredientes",
          "producciones",
          "salidas_sucursales",
          "incidencias",
        ])
          paradas.push(db.collection(c).onSnapshot(enviar, cerrar));
        res.write(": conectado\n\n");
        return;
      }
      const result =
        url.pathname === "/api/dashboard"
          ? await generarDashboard(
              db,
              identidad.uid,
              url.searchParams.get("mes"),
            )
          : url.pathname === "/api/perfil"
            ? {
                uid: identidad.uid,
                nombre: p.nombre,
                rol: p.rol,
                sucursalId: p.sucursalId || null,
              }
            : await consultar(
                db,
                identidad.uid,
                url.searchParams.get("modulo"),
              );
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(
        {
          unauthenticated: 401,
          "permission-denied": 403,
          "invalid-argument": 400,
        }[e.code] || 500,
        { "Content-Type": "application/json; charset=utf-8" },
      );
      res.end(
        JSON.stringify({
          error: {
            message: e.code
              ? e.message
              : "No se pudo consultar. Intenta otra vez.",
          },
        }),
      );
    }
  };
  manejar.cerrarConexiones = () => {
    for (const cerrar of [...conexiones]) cerrar();
  };
  return manejar;
}
module.exports = { conWeb, consultar, ORIGEN };
