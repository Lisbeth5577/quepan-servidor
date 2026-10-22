"use strict";
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
  onDocumentWritten,
  onDocumentCreated,
} = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const d = require("./domain");
initializeApp();
const db = getFirestore();
const region = "us-central1";
const ref = (c, id) => db.collection(c).doc(id);
const stamp = () => FieldValue.serverTimestamp();
async function usuario(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Inicia sesion");
  const p = (await ref("usuarios", request.auth.uid).get()).data();
  d.perfil(p);
  return { ...p, uid: request.auth.uid };
}
// Todas las mutaciones son autenticadas. El cliente nunca descuenta stock.
const operar = require("./negocio.cjs").crearNegocio(db);
exports.operacion = onCall({ region, maxInstances: 3 }, async (request) => {
  try {
    return await operar(request);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    if (e instanceof d.ErrorNegocio) throw new HttpsError(e.code, e.message);
    console.error("Operación fallida", e.code || e.name);
    throw new HttpsError(
      "internal",
      "No se pudo confirmar. Reintenta la misma solicitud.",
    );
  }
});
// Una alerta por episodio: solo se abre al cruzar de normal a minimo.
exports.alertaStock = onDocumentWritten(
  { document: "productos/{productoId}", region, maxInstances: 3 },
  async (event) => {
    if (!event.data.after.exists) return;
    const r = ref("alertas", event.params.productoId);
    await db.runTransaction(async (tx) => {
      const current = await tx.get(ref("productos", event.params.productoId));
      if (!current.exists) return;
      const p = current.data(),
        s = await tx.get(r),
        a = s.data();
      const disponible = Math.max(0, p.existencia - (p.reservado || 0));
      const low = p.activo && disponible <= p.minimo;
      if (low && (!a || !a.activa)) {
        const n = db.collection("notificaciones").doc();
        tx.set(r, {
          activa: true,
          productoId: event.params.productoId,
          nombre: p.nombre,
          existencia: disponible,
          minimo: p.minimo,
          actualizado: stamp(),
        });
        tx.create(n, {
          tipo: "STOCK_MINIMO",
          titulo: "Existencia minima",
          mensaje: p.nombre + ": " + disponible + " " + p.unidad,
          estado: "PENDIENTE",
          creado: stamp(),
        });
      } else if (a)
        tx.update(r, {
          activa: !!low,
          existencia: disponible,
          minimo: p.minimo,
          actualizado: stamp(),
        });
    });
  },
);
exports.avisoIncidencia = onDocumentCreated(
  { document: "incidencias/{id}", region, maxInstances: 3 },
  async (event) => {
    // ID estable para que un reintento del disparador no duplique el aviso.
    try {
      await ref("notificaciones", "incidencia_" + event.params.id).create({
        tipo: "INCIDENCIA",
        titulo: "Problema en ruta",
        mensaje: "Pedido " + event.data.data().pedidoId,
        estado: "PENDIENTE",
        creado: stamp(),
      });
    } catch (e) {
      if (e.code !== 6) throw e;
    }
  },
);
exports.enviarAviso = onDocumentCreated(
  { document: "notificaciones/{id}", region, maxInstances: 3 },
  async (event) => {
    const n = event.data.data(),
      users = await db
        .collection("usuarios")

        .get();
    let enviados = 0,
      fallos = 0;
    for (const user of users.docs) {
      if (!user.data().activo) continue;
      if (
        n.tipo === "STOCK_SUCURSAL"
          ? user.data().rol !== "GERENTE" &&
            user.data().sucursalId !== n.sucursalId
          : n.tipo === "INCIDENCIA" && user.data().rol !== "GERENTE"
      )
        continue;
      const rawTokens = await user.ref.collection("tokens").get();
      const tokens = {
        docs: rawTokens.docs.filter((t) => t.data().activo !== false),
      };
      tokens.size = tokens.docs.length;
      for (let i = 0; i < tokens.size; i += 500) {
        const batch = tokens.docs.slice(i, i + 500);
        if (!batch.length) continue;
        const r = await getMessaging().sendEachForMulticast({
          tokens: batch.map((t) => t.data().token),
          notification: { title: n.titulo, body: n.mensaje },
          data: { tipo: n.tipo, avisoId: event.params.id },
          android: {
            priority: "high",
            notification: {
              channelId: "sipropan_alertas",
              tag: event.params.id,
            },
          },
        });
        enviados += r.successCount;
        fallos += r.failureCount;
      }
    }
    await event.data.ref.update({
      estado: enviados ? "ENVIADA" : "SIN_DISPOSITIVO_O_ERROR",
      enviados,
      fallos,
      intentado: stamp(),
    });
  },
);
