"use strict";
// Adaptador web: reutiliza la autenticacion y las operaciones del APK.
const fs = require("node:fs"),
  path = require("node:path");
const d = require("./domain");
const ORIGEN = "https://sipropan-servidor.onrender.com";
const PERMITIDOS = [
  "productos",
  "sucursales",
  "pedidos",
  "ingredientes",
  "recetas",
  "producciones",
  "movimientos",
  "incidencias",
  "alertas",
  "notificaciones",
  "usuarios",
];
const CAMPOS = {
  productos: [
    "nombre",
    "existencia",
    "minimo",
    "unidad",
    "activo",
    "recetaAcademica",
  ],
  ingredientes: ["nombre", "existencia", "minimo", "unidad", "activo"],
  sucursales: ["nombre", "activo"],
  usuarios: ["nombre", "rol", "sucursalId", "activo"],
  pedidos: [
    "sucursalId",
    "vendedorUid",
    "fechaEntrega",
    "detalles",
    "estado",
    "creado",
    "despachado",
    "entregado",
    "unidad",
    "ruta",
    "incidenciaId",
  ],
  recetas: ["nombre", "rendimiento", "ingredientes", "academica"],
  producciones: [
    "productoId",
    "cantidad",
    "consumos",
    "estado",
    "usuarioUid",
    "creado",
  ],
  movimientos: ["ingredienteId", "cantidad", "tipo", "usuarioUid", "creado"],
  incidencias: [
    "pedidoId",
    "vendedorUid",
    "detalle",
    "estado",
    "creado",
    "resuelto",
    "nuevaUnidad",
  ],
  alertas: [
    "nombre",
    "productoId",
    "activa",
    "existencia",
    "minimo",
    "actualizado",
  ],
  notificaciones: [
    "tipo",
    "titulo",
    "mensaje",
    "estado",
    "creado",
    "enviados",
    "fallos",
  ],
};
function valor(v) {
  if (v?.toDate) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map(valor);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, valor(x)]));
  return v;
}
async function consultar(db, uid, modulo) {
  d.exigir(
    PERMITIDOS.includes(modulo),
    "Consulta no disponible",
    "invalid-argument",
  );
  const p = (await db.collection("usuarios").doc(uid).get()).data();
  d.perfil(p);
  const gerente = p.rol === "GERENTE";
  d.exigir(
    gerente ||
      ["productos", "sucursales", "pedidos", "incidencias"].includes(modulo),
    "Solo el gerente puede consultar este modulo",
    "permission-denied",
  );
  let q = db.collection(modulo);
  if (!gerente && ["pedidos", "incidencias"].includes(modulo))
    q = q.where("vendedorUid", "==", uid);
  if (!gerente && modulo === "sucursales")
    q = q.where("__name__", "==", p.sucursalId);
  const filas = [];
  let ultimo;
  do {
    const pagina = await (ultimo ? q.startAfter(ultimo) : q)
      .orderBy("__name__")
      .limit(250)
      .get();
    for (const doc of pagina.docs) {
      const x = doc.data();
      filas.push({
        id: doc.id,
        ...Object.fromEntries(
          CAMPOS[modulo]
            .filter((k) => x[k] !== undefined)
            .map((k) => [k, valor(x[k])]),
        ),
      });
    }
    if (pagina.size < 250) break;
    ultimo = pagina.docs.at(-1);
  } while (true);
  return { filas };
}
function conWeb(
  siguiente,
  { db, verificar, directorio = __dirname },
) {
  const estaticos = {
    "/web/": "index.html",
    "/web/index.html": "index.html",
    "/web/panaderia.js": "panaderia.js",
    "/web/panaderia.css": "panaderia.css",
  };
  return async (req, res) => {
    const url = new URL(req.url, "https://sipropan.local");
    if (req.method === "GET" && Object.hasOwn(estaticos, url.pathname)) {
      const nombre = estaticos[url.pathname];
      res.writeHead(200, {
        "Content-Type": nombre.endsWith(".html")
          ? "text/html; charset=utf-8"
          : nombre.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : "text/css; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        "Referrer-Policy": "no-referrer",
      });
      return res.end(fs.readFileSync(path.join(directorio, nombre)));
    }
    if (
      req.method !== "GET" ||
      !["/api/perfil", "/api/datos"].includes(url.pathname)
    )
      return siguiente(req, res);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      d.exigir(
        !req.headers.origin || req.headers.origin === ORIGEN,
        "Origen web no permitido",
        "permission-denied",
      );
      const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || "");
      d.exigir(match, "Inicia sesion", "unauthenticated");
      let identidad;
      try {
        identidad = await verificar(match[1]);
      } catch {
        throw new d.ErrorNegocio(
          "Sesion no valida o vencida",
          "unauthenticated",
        );
      }
      let result;
      if (url.pathname === "/api/perfil") {
        const p = (
          await db.collection("usuarios").doc(identidad.uid).get()
        ).data();
        d.perfil(p);
        result = {
          uid: identidad.uid,
          nombre: p.nombre,
          rol: p.rol,
          sucursalId: p.sucursalId || null,
        };
      } else
        result = await consultar(
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
}
module.exports = { conWeb, consultar, ORIGEN };
