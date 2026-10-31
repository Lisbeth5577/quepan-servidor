"use strict";
// El alojamiento ofrece HTTPS publico y reenvia a este puerto interno.
// Las mismas reglas de identidad, permisos y stock del servidor local se conservan.
const http = require("node:http");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const r = createRequire(
  require("node:path").resolve(__dirname, "package.json"),
);
const { crearManejador, iniciarAvisos } = require("./local.cjs");
async function iniciar() {
  if (
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST
  )
    throw Error("No usar emuladores en el alojamiento real");
  // Solo una cuenta de servicio del proyecto: nunca la sesion personal de Google.
  const archivo = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credencial = JSON.parse(fs.readFileSync(archivo, "utf8"));
  if (
    credencial.type !== "service_account" ||
    credencial.project_id !== "sipropan-panaderia-san-carlos"
  )
    throw Error("Falta una cuenta de servicio propia de QuePan");
  process.env.GCLOUD_PROJECT = credencial.project_id;
  const puerto = Number(process.env.PORT || 10000);
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535)
    throw Error("Puerto invalido");
  const api = r("./index.js");
  const db = r("firebase-admin/firestore").getFirestore();
  const auth = r("firebase-admin/auth").getAuth();
  await db.collection("productos").limit(1).get();
  const operar = crearManejador(
    (t) => auth.verifyIdToken(t, true),
    (q) => api.operacion.run(q),
    (q) =>
      require("./reporte_ordenado.cjs").generarReporte(
        db,
        q.auth.uid,
        q.fecha,
        q.tipo,
      ),
    require("./web.cjs").ORIGEN,
  );
  const archivoApk = require("node:path").join(__dirname, "QUEPAN-3.0.apk");
  const manejadorWeb = require("./web.cjs").conWeb(
    require("./descargas.cjs").conDescargas(operar, archivoApk),
    { db, verificar: (t) => auth.verifyIdToken(t, true) },
  );
  const servidor = http.createServer(manejadorWeb);
  servidor.requestTimeout = 30000;
  servidor.headersTimeout = 10000;
  // El acceso anterior conserva la actualización, sin duplicar los emisores de avisos.
  const pararAvisos = process.env.RENDER_EXTERNAL_HOSTNAME === "sipropan-servidor.onrender.com" ? async () => {} : iniciarAvisos(api, db);
  servidor.listen(puerto, "0.0.0.0", () =>
    console.log("QuePan listo detras del HTTPS del alojamiento."),
  );
  const parar = async () => {
    await pararAvisos();
    manejadorWeb.cerrarConexiones();
    await new Promise((resolve) => servidor.close(resolve));
    await db.terminate();
  };
  process.once("SIGTERM", parar);
  process.once("SIGINT", parar);
  return servidor;
}
if (require.main === module)
  iniciar().catch(() => {
    console.error(
      "No se pudo iniciar QuePan. Revisar credencial privada, permisos y conexion.",
    );
    process.exitCode = 1;
  });
module.exports = { iniciar };
