"use strict";
const fs = require("fs"),
  path = require("path"),
  d = require("./domain"),
  { consultar, actualizarCache, perfilUsuario, pausarLecturas, esCuota, mensajeCuota, activarCache } = require("./consultas.cjs");
const { generarDashboard } = require("./dashboard.cjs");
const ORIGEN = (process.env.RENDER_EXTERNAL_URL || "https://quepan-panaderia-san-carlos.onrender.com").replace(/\/$/, "");
function conWeb(
  siguiente,
  { db, verificar, directorio = __dirname, origen = ORIGEN },
) {
  activarCache(db);
  const conexiones = new Set();
  const suscriptores = new Set(), paradasGlobales = [], cambios = new Set();
  let escuchando = false, avisoTimer;
  function comenzarEscuchas() {
    if (escuchando) return;
    escuchando = true;
    for (const c of ["descuentos","solicitudes_produccion","productos","inventario_sucursales","pedidos","sucursales","usuarios","ingredientes","recetas","producciones","salidas_sucursales","incidencias","notificaciones"]) {
      const stop = db.collection(c).onSnapshot(s => {
        actualizarCache(db,c,s); cambios.add(c);
        if (!avisoTimer) avisoTimer = setTimeout(() => {
          avisoTimer = null; const lista = [...cambios]; cambios.clear();
          for (const fn of [...suscriptores]) fn(lista);
        },1000);
      }, e => {
        pausarLecturas(db,e); escuchando = false;
        paradasGlobales.splice(0).forEach(fn=>fn());
        clearTimeout(avisoTimer); avisoTimer = null; cambios.clear();
        for (const fn of [...suscriptores]) fn(null,e);
      });
      paradasGlobales.push(stop);
    }
  }

  const archivos = {
    "/web/": "index.html",
    "/web/index.html": "index.html",
    "/web/panaderia.js": "panaderia.js",
    "/web/dashboard-ui.js": "dashboard-ui.js",
    "/web/panaderia.css": "panaderia.css",
    "/web/pan-pixel.png": "pan-pixel.png",
    "/web/logo-academico.png": "logo-academico.png",
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
      const p = await perfilUsuario(db, identidad.uid);
      d.perfil(p);
      if (url.pathname === "/api/eventos") {
        let cerrado = false,
          timer;
        const paradas = [];
        const cerrar = () => {
          if (cerrado) return;
          cerrado = true;
          suscriptores.delete(enviar);
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
        const enviar = (colecciones, error) => {
          if (cerrado) return;
          if (error) {
            res.write("event: pausa\ndata: " + JSON.stringify({reintentarEn:60}) + "\n\n");
            cerrar(); return;
          }
          res.write("event: actualizar\ndata: " + JSON.stringify({colecciones}) + "\n\n");
        };
        suscriptores.add(enviar);
        comenzarEscuchas();
        res.write(": conectado\n\n");
        return;
      }
      const result =
        url.pathname === "/api/dashboard"
          ? await generarDashboard(
              db,
              identidad.uid,
              url.searchParams.get("mes"),
              p,
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
                p,
              );
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result));
    } catch (e) {
      if (esCuota(e)) { pausarLecturas(db,e); res.setHeader("Retry-After","60"); }
      res.writeHead(
        {
          unauthenticated: 401,
          "permission-denied": 403,
          "invalid-argument": 400,
        }[e.code] || (esCuota(e) ? 429 : 500),
        { "Content-Type": "application/json; charset=utf-8" },
      );
      res.end(
        JSON.stringify({
          error: {
            status: esCuota(e) ? "resource-exhausted" : e.code,
            message: esCuota(e) ? mensajeCuota : e.code
              ? e.message
              : "No se pudo consultar. Intenta otra vez.",
          },
        }),
      );
    }
  };
  manejar.cerrarConexiones = () => {
    for (const cerrar of [...conexiones]) cerrar();
    paradasGlobales.splice(0).forEach(fn=>fn());
    clearTimeout(avisoTimer);
  };
  return manejar;
}
module.exports = { conWeb, consultar, ORIGEN };
