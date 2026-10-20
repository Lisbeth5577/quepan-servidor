"use strict";
// El alojamiento ofrece HTTPS publico y reenvia a este puerto interno.
// Las mismas reglas de identidad, permisos y stock del servidor local se conservan.
const http = require("node:http");
const fs = require("node:fs");
const { createRequire } = require("node:module");
const r = createRequire(require("node:path").resolve(__dirname, "package.json"));
const { crearManejador, iniciarAvisos } = require("./local.cjs");
async function iniciar() {
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)
    throw Error("No usar emuladores en el alojamiento real");
  // Solo una cuenta de servicio del proyecto: nunca la sesion personal de Google.
  const archivo = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const credencial = JSON.parse(fs.readFileSync(archivo, "utf8"));
  if (credencial.type !== "service_account" || credencial.project_id !== "sipropan-panaderia-san-carlos")
    throw Error("Falta una cuenta de servicio propia de SIPROPAN");
  process.env.GCLOUD_PROJECT = credencial.project_id;
  const puerto = Number(process.env.PORT || 10000);
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw Error("Puerto invalido");
  const api = r("./index.js");
  const db = r("firebase-admin/firestore").getFirestore();
  const auth = r("firebase-admin/auth").getAuth();
  await db.collection("productos").limit(1).get();
  const servidor = http.createServer(crearManejador(t => auth.verifyIdToken(t, true), q => api.operacion.run(q)));
  servidor.requestTimeout = 30000;
  servidor.headersTimeout = 10000;
  const pararAvisos = iniciarAvisos(api, db);
  servidor.listen(puerto, "0.0.0.0", () => console.log("SIPROPAN listo detras del HTTPS del alojamiento."));
  const parar = async () => {
    await pararAvisos();
    await new Promise(resolve => servidor.close(resolve));
    await db.terminate();
  };
  process.once("SIGTERM", parar);
  process.once("SIGINT", parar);
  return servidor;
}
if (require.main === module) iniciar().catch(() => {
  console.error("No se pudo iniciar SIPROPAN. Revisar credencial privada, permisos y conexion.");
  process.exitCode = 1;
});
module.exports = { iniciar };
