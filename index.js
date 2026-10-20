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
exports.operacion = onCall({ region, maxInstances: 3 }, async (request) => {
  try {
    const u = await usuario(request),
      a = request.data || {},
      action = a.accion;
    if (action === "registrarToken") {
      const token = d.texto(a.token, 4096);
      const hash = require("node:crypto")
        .createHash("sha256")
        .update(token)
        .digest("hex");
      await ref("usuarios", u.uid)
        .collection("tokens")
        .doc(hash)
        .set({ token, actualizado: stamp() });
      return { mensaje: "Dispositivo registrado" };
    }
    // Un UUID generado al pulsar una vez evita duplicar una operacion al reintentar.
    const key = d.id(a.solicitudId),
      op = ref("operaciones", u.uid + "_" + key);
    return await db.runTransaction(async (tx) => {
      const old = await tx.get(op);
      if (old.exists) return old.data().resultado;
      let result;
      if (action === "crearPedido") {
        const lines = d.detalles(a.detalles),
          branch = d.id(a.sucursalId),
          date = d.texto(a.fechaEntrega, 10);
        const parsed = new Date(date + "T12:00:00Z");
        d.exigir(
          /^\d{4}-\d{2}-\d{2}$/.test(date) &&
            !Number.isNaN(parsed.getTime()) &&
            parsed.toISOString().slice(0, 10) === date,
          "Fecha no valida",
          "invalid-argument",
        );
        d.exigir(
          date >=
            new Date().toLocaleDateString("en-CA", {
              timeZone: "America/Guatemala",
            }),
          "La entrega no puede ser anterior a hoy",
          "invalid-argument",
        );
        if (u.rol !== "GERENTE")
          d.exigir(
            u.sucursalId === branch,
            "Sucursal no autorizada",
            "permission-denied",
          );
        const s = await tx.get(ref("sucursales", branch));
        d.exigir(s.exists && s.data().activo, "Sucursal inactiva");
        for (const l of lines) {
          const p = await tx.get(ref("productos", l.productoId));
          d.exigir(p.exists && p.data().activo, "Producto no disponible");
        }
        tx.create(ref("pedidos", key), {
          sucursalId: branch,
          vendedorUid: u.uid,
          fechaEntrega: date,
          detalles: lines,
          estado: "PENDIENTE",
          creado: stamp(),
        });
        result = { id: key, mensaje: "Pedido registrado" };
      } else if (
        ["despachar", "entregar", "incidencia", "reasignar"].includes(action)
      ) {
        const pedidoId = d.id(a.pedidoId),
          pRef = ref("pedidos", pedidoId),
          snap = await tx.get(pRef);
        d.exigir(snap.exists, "Pedido inexistente");
        const p = snap.data();
        if (action === "despachar") {
          d.gerente(u);
          d.exigir(
            p.estado === "PENDIENTE",
            "Solo se despacha un pedido pendiente",
          );
          const vendedor = d.id(a.vendedorUid),
            vs = await tx.get(ref("usuarios", vendedor));
          d.exigir(
            vs.exists && vs.data().activo && vs.data().rol === "VENDEDOR",
            "Vendedor no disponible",
          );
          const unidad = d.texto(a.unidad, 60),
            ruta = d.texto(a.ruta, 80),
            changes = [];
          for (const l of p.detalles) {
            const r = ref("productos", l.productoId),
              s = await tx.get(r);
            d.exigir(s.exists && s.data().activo, "Producto inactivo");
            changes.push([r, d.descontar(s.data().existencia, l.cantidad)]);
          }
          for (const [r, existencia] of changes) tx.update(r, { existencia });
          tx.update(pRef, {
            estado: "EN_RUTA",
            vendedorUid: vendedor,
            unidad,
            ruta,
            despachado: stamp(),
          });
        } else if (action === "entregar") {
          d.autor(u, u.uid, p);
          d.exigir(p.estado === "EN_RUTA", "El pedido no esta en ruta");
          tx.update(pRef, { estado: "ENTREGADO", entregado: stamp() });
        } else if (action === "incidencia") {
          d.autor(u, u.uid, p);
          d.exigir(p.estado === "EN_RUTA", "El pedido no esta en ruta");
          const detalle = d.texto(a.detalle, 500);
          tx.create(ref("incidencias", key), {
            pedidoId,
            vendedorUid: u.uid,
            detalle,
            estado: "ABIERTA",
            creado: stamp(),
          });
          tx.update(pRef, { estado: "INCIDENCIA", incidenciaId: key });
        } else {
          d.gerente(u);
          d.exigir(
            p.estado === "INCIDENCIA",
            "El pedido no tiene incidencia pendiente",
          );
          const v = d.id(a.vendedorUid),
            vs = await tx.get(ref("usuarios", v));
          d.exigir(
            vs.exists && vs.data().activo && vs.data().rol === "VENDEDOR",
            "Vendedor no disponible",
          );
          const ir = ref("incidencias", p.incidenciaId),
            is = await tx.get(ir);
          d.exigir(
            is.exists && is.data().estado === "ABIERTA",
            "Incidencia ya resuelta",
          );
          const unidad = d.texto(a.unidad, 60);
          tx.update(ir, {
            estado: "REASIGNADA",
            atendidoPor: u.uid,
            nuevoVendedor: v,
            nuevaUnidad: unidad,
            resuelto: stamp(),
          });
          // El mismo pan cambia de unidad: no se vuelve a descontar inventario.
          tx.update(pRef, {
            estado: "EN_RUTA",
            vendedorUid: v,
            unidad,
            reasignado: stamp(),
          });
        }
        result = {
          id: pedidoId,
          mensaje: "Operacion " + action + " registrada",
        };
      } else if (action === "entrada") {
        d.gerente(u);
        const r = ref("ingredientes", d.id(a.ingredienteId)),
          s = await tx.get(r);
        d.exigir(s.exists && s.data().activo, "Ingrediente no disponible");
        const amount = d.centavos(a.cantidad) / 100;
        const total = Math.round((s.data().existencia + amount) * 100) / 100;
        d.exigir(total <= 1000000, "Existencia fuera de rango");
        tx.update(r, { existencia: total });
        tx.create(ref("movimientos", key), {
          tipo: "ENTRADA",
          ingredienteId: r.id,
          cantidad: amount,
          usuarioUid: u.uid,
          creado: stamp(),
        });
        result = { id: key, mensaje: "Entrada registrada" };
      } else if (action === "producir") {
        d.gerente(u);
        const productId = d.id(a.productoId),
          pr = ref("productos", productId),
          ps = await tx.get(pr),
          rs = await tx.get(ref("recetas", productId));
        d.exigir(
          ps.exists && ps.data().activo && rs.exists,
          "Producto sin receta",
        );
        const amount = d.centavos(a.cantidad) / 100,
          items = d.consumo(rs.data(), amount),
          changes = [];
        for (const item of items) {
          const r = ref("ingredientes", item.ingredienteId),
            s = await tx.get(r);
          d.exigir(s.exists && s.data().activo, "Ingrediente inactivo");
          changes.push([r, d.descontar(s.data().existencia, item.cantidad)]);
        }
        const total = Math.round((ps.data().existencia + amount) * 100) / 100;
        d.exigir(total <= 1000000, "Existencia fuera de rango");
        for (const [r, existencia] of changes) tx.update(r, { existencia });
        tx.update(pr, { existencia: total });
        tx.create(ref("producciones", key), {
          productoId: productId,
          cantidad: amount,
          consumos: items,
          estado: "FINALIZADA",
          usuarioUid: u.uid,
          creado: stamp(),
        });
        result = { id: key, mensaje: "Produccion finalizada" };
      } else
        throw new d.ErrorNegocio("Accion no permitida", "invalid-argument");
      tx.create(op, {
        accion: action,
        usuarioUid: u.uid,
        resultado: result,
        creado: stamp(),
      });
      return result;
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    if (e instanceof d.ErrorNegocio) throw new HttpsError(e.code, e.message);
    console.error("Operacion fallida", e);
    throw new HttpsError(
      "internal",
      "No se pudo guardar. Reintenta con la misma solicitud.",
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
      const low = p.activo && p.existencia <= p.minimo;
      if (low && (!a || !a.activa)) {
        const n = db.collection("notificaciones").doc();
        tx.set(r, {
          activa: true,
          productoId: event.params.productoId,
          nombre: p.nombre,
          existencia: p.existencia,
          minimo: p.minimo,
          actualizado: stamp(),
        });
        tx.create(n, {
          tipo: "STOCK_MINIMO",
          titulo: "Existencia minima",
          mensaje: p.nombre + ": " + p.existencia + " " + p.unidad,
          estado: "PENDIENTE",
          creado: stamp(),
        });
      } else if (a)
        tx.update(r, {
          activa: !!low,
          existencia: p.existencia,
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
        .where("rol", "==", "GERENTE")
        .get();
    let enviados = 0,
      fallos = 0;
    for (const user of users.docs) {
      if (!user.data().activo) continue;
      const tokens = await user.ref.collection("tokens").get();
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
