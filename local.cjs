"use strict";
// Servidor HTTPS local. Verifica identidad; reutiliza las mismas transacciones.
const https = require("node:https");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const r = createRequire(
  require("node:path").resolve(__dirname, "package.json"),
);
const estados = {
  "invalid-argument": 400,
  unauthenticated: 401,
  "permission-denied": 403,
  "not-found": 404,
  "failed-precondition": 409,
  "resource-exhausted": 429,
  "already-exists": 409,
};
function crearManejador(verificar, operar, reportar, origenWeb) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const responder = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/salud")
      return responder(200, { estado: "ACTIVO", servicio: "QuePan" });
    const esReporte =
      req.method === "GET" &&
      /^\/reportes\/diario\.(csv|xlsx)\?/.test(req.url) &&
      typeof reportar === "function";
    if (!esReporte && (req.url !== "/operacion" || req.method !== "POST"))
      return responder(404, {
        error: { status: "not-found", message: "Ruta no disponible" },
      });
    // La app nativa y Postman no envian Origin. No se admite uso desde otras webs.
    if (req.headers.origin && req.headers.origin !== origenWeb)
      return responder(403, {
        error: {
          status: "permission-denied",
          message: "Origen web no permitido",
        },
      });
    let fase = "identidad";
    try {
      const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || "");
      if (!match)
        return responder(401, {
          error: { status: "unauthenticated", message: "Inicia sesion" },
        });
      const identidad = await verificar(match[1]);
      if (esReporte) {
        fase = "operacion";
        const fecha = new URL(
          req.url,
          "https://sipropan.local",
        ).searchParams.get("fecha");
        const tipo =
          new URL(req.url, "https://sipropan.local").searchParams.get("tipo") ||
          "todo";
        const reporte = await reportar({
          auth: { uid: identidad.uid },
          fecha,
          tipo,
        });
        const excel = req.url.startsWith("/reportes/diario.xlsx?");
        const datos = excel
          ? await require("./excel.cjs").crearExcel(reporte)
          : Buffer.from(reporte.csv, "utf8");
        const archivo = excel
          ? reporte.archivo.replace(/\.csv$/, ".xlsx")
          : reporte.archivo;
        res.writeHead(200, {
          "Content-Type": excel
            ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            : "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="' + archivo + '"',
          "Content-Length": datos.length,
        });
        res.end(datos);
        return;
      }
      fase = "cuerpo";
      if (!(req.headers["content-type"] || "").startsWith("application/json"))
        return responder(415, {
          error: { status: "invalid-argument", message: "Usa JSON" },
        });
      const partes = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 65536)
          return responder(413, {
            error: {
              status: "invalid-argument",
              message: "Solicitud demasiado grande",
            },
          });
        partes.push(chunk);
      }
      const parsed = JSON.parse(Buffer.concat(partes).toString("utf8"));
      if (
        !parsed ||
        !parsed.data ||
        typeof parsed.data !== "object" ||
        Array.isArray(parsed.data)
      )
        throw new Error("Solicitud JSON invalida");
      fase = "operacion";
      const result = await operar({
        auth: { uid: identidad.uid },
        data: parsed.data,
      });
      responder(200, { result });
    } catch (e) {
      const code =
        fase === "identidad"
          ? "unauthenticated"
          : fase === "cuerpo"
            ? "invalid-argument"
            : e.code || "internal";
      const status = estados[code] || 500;
      responder(status, {
        error: {
          status: code,
          message:
            status === 500
              ? "No se pudo confirmar. Reintenta la misma solicitud."
              : fase === "identidad"
                ? "Sesion no valida o vencida"
                : fase === "cuerpo"
                  ? "Solicitud JSON invalida"
                  : e.message,
        },
      });
    }
  };
}
function crearServidor(tls, verificar, operar, reportar) {
  return https.createServer(tls, crearManejador(verificar, operar, reportar));
}
function iniciarAvisos(api, db, logger = console) {
  // Escuchas en tiempo real: no consultamos todo el inventario repetidamente.
  // Al reiniciar, se revisan stock y pendientes para recuperar eventos omitidos.
  const paradas = [],
    reintentos = new Set();
  let cola = Promise.resolve(),
    cerrado = false;
  const encolar = (fn, intento = 0) => {
    cola = cola
      .then(async () => {
        if (!cerrado) await fn();
      })
      .catch(() => {
        logger.error(
          "Aviso pendiente; se reintentara sin registrar credenciales.",
        );
        if (!cerrado && intento < 5) {
          const timer = setTimeout(
            () => {
              reintentos.delete(timer);
              encolar(fn, intento + 1);
            },
            Math.min(60000, 2000 * 2 ** intento),
          );
          reintentos.add(timer);
        }
      });
  };
  const error = () =>
    logger.error("Escucha de Firebase interrumpida. Revisa conexion y acceso.");
  paradas.push(
    db.collection("productos").onSnapshot(
      (s) =>
        s
          .docChanges()
          .filter((c) => c.type !== "removed")
          .forEach((c) =>
            encolar(() =>
              api.alertaStock.run({
                params: { productoId: c.doc.id },
                data: { after: c.doc },
              }),
            ),
          ),
      error,
    ),
  );
  paradas.push(
    db.collection("incidencias").onSnapshot(
      (s) =>
        s
          .docChanges()
          .filter((c) => c.type === "added")
          .forEach((c) =>
            encolar(() =>
              api.avisoIncidencia.run({
                params: { id: c.doc.id },
                data: c.doc,
              }),
            ),
          ),
      error,
    ),
  );
  paradas.push(
    db
      .collection("notificaciones")
      .where("estado", "==", "PENDIENTE")
      .onSnapshot(
        (s) =>
          s
            .docChanges()
            .filter((c) => c.type !== "removed")
            .forEach((c) =>
              encolar(async () => {
                const actual = await c.doc.ref.get();
                if (actual.exists && actual.data().estado === "PENDIENTE")
                  await api.enviarAviso.run({
                    params: { id: c.doc.id },
                    data: actual,
                  });
              }),
            ),
        error,
      ),
  );
  return async () => {
    cerrado = true;
    paradas.forEach((stop) => stop());
    reintentos.forEach(clearTimeout);
    await cola;
  };
}
async function iniciar() {
  if (
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST
  )
    throw Error("El inicio real no admite variables de emulador");
  const config = JSON.parse(
    fs.readFileSync(
      require("node:path").join(__dirname, "../.servidor.local.json"),
    ),
  );
  if (config.proyecto !== "sipropan-panaderia-san-carlos")
    throw Error("Proyecto local no autorizado");
  process.env.GOOGLE_APPLICATION_CREDENTIALS = config.credencial;
  process.env.GCLOUD_PROJECT = config.proyecto;
  const api = r("./index.js");
  const { getAuth } = r("firebase-admin/auth"),
    { getFirestore } = r("firebase-admin/firestore");
  const db = getFirestore();
  // Comprobar acceso antes de ofrecer el servicio.
  await db.collection("productos").limit(1).get();
  const server = crearServidor(
    {
      key: fs.readFileSync(config.clave),
      cert: fs.readFileSync(config.certificado),
    },
    (t) => getAuth().verifyIdToken(t, true),
    (request) => api.operacion.run(request),
    (request) =>
      require("./reporte_diario.cjs").generarReporte(
        db,
        request.auth.uid,
        request.fecha,
        request.tipo,
      ),
  );
  const pararAvisos = iniciarAvisos(api, db);
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.listen(config.puerto, config.host, () =>
    console.log(
      "QuePan HTTPS activo en puerto " +
        config.puerto +
        ". Firebase Spark; sin Cloud Functions.",
    ),
  );
  const parar = async () => {
    await pararAvisos();
    server.close();
    await db.terminate();
  };
  process.once("SIGINT", parar);
  process.once("SIGTERM", parar);
  return server;
}
module.exports = { crearServidor, crearManejador, iniciarAvisos, iniciar };
if (require.main === module)
  iniciar().catch(() => {
    console.error(
      "No se pudo iniciar. Revisa configuracion privada, credencial y conexion.",
    );
    process.exitCode = 1;
  });
