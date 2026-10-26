"use strict";
// Cada solicitud se confirma con sus reservas, inventario e historial en una transacción.
const d = require("./domain");
const { FieldValue } = require("firebase-admin/firestore");
const crypto = require("node:crypto");
const stamp = () => FieldValue.serverTimestamp();
const red = (n) => Math.round(n * 100) / 100;
const opcional = (v, max = 500) =>
  v == null || v === "" ? "" : d.texto(v, max);
const cantidad0 = (v) => {
  d.exigir(
    typeof v === "number" &&
      Number.isFinite(v) &&
      v >= 0 &&
      v <= 1000000 &&
      red(v) === v,
    "Cantidad válida de cero a un millón",
    "invalid-argument",
  );
  return v;
};
function fecha(v) {
  const x = d.texto(v, 10),
    date = new Date(x + "T12:00:00Z");
  d.exigir(
    /^\d{4}-\d{2}-\d{2}$/.test(x) &&
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === x,
    "Fecha de entrega no válida",
    "invalid-argument",
  );
  const hoy = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guatemala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  d.exigir(
    x >= hoy,
    "La entrega no puede ser anterior a hoy",
    "invalid-argument",
  );
  return x;
}
function crearNegocio(db) {
  const ref = (c, id) => db.collection(c).doc(d.id(id));
  return async (request) => {
    d.exigir(request.auth?.uid, "Inicia sesión", "unauthenticated");
    const uid = request.auth.uid,
      a = request.data || {},
      action = a.accion;
    if (["registrarToken", "desregistrarToken"].includes(action)) {
      d.perfil((await ref("usuarios", uid).get()).data());
      const token = d.texto(a.token, 4096),
        hash = crypto.createHash("sha256").update(token).digest("hex");
      await db.runTransaction(async (tx) => {
        const users = await tx.get(db.collection("usuarios"));
        const refs = users.docs.map((x) =>
          ref("usuarios", x.id).collection("tokens").doc(hash),
        );
        const snaps = await Promise.all(refs.map((r) => tx.get(r)));
        snaps.forEach((s, i) => {
          if (
            s.exists &&
            (action === "registrarToken" || users.docs[i].id === uid)
          )
            tx.set(refs[i], { activo: false }, { merge: true });
        });
        if (action === "registrarToken")
          tx.set(ref("usuarios", uid).collection("tokens").doc(hash), {
            token,
            activo: true,
            actualizado: stamp(),
          });
      });
      return {
        mensaje:
          action === "registrarToken"
            ? "Dispositivo registrado para avisos"
            : "Avisos desvinculados",
      };
    }
    const key = d.id(a.solicitudId),
      op = ref("operaciones", uid + "_" + key);
    const huella = crypto
      .createHash("sha256")
      .update(JSON.stringify(a))
      .digest("hex");
    return db.runTransaction(async (tx) => {
      const cache = new Map(),
        writes = [];
      async function leer(c, id) {
        const r = ref(c, id),
          k = r.path;
        if (!cache.has(k)) {
          const s = await tx.get(r);
          cache.set(k, s.exists ? { ...s.data(), id: s.id } : null);
        }
        return cache.get(k);
      }
      const poner = (c, id, x, merge = true) =>
        writes.push(() => tx.set(ref(c, id), x, { merge }));
      const crear = (c, id, x) => writes.push(() => tx.create(ref(c, id), x));
      const old = await tx.get(op);
      if (old.exists) {
        d.exigir(
          !old.data().huella || old.data().huella === huella,
          "Este identificador ya se usó para otra solicitud",
          "already-exists",
        );
        return old.data().resultado;
      }
      const u = await leer("usuarios", uid);
      d.perfil(u);
      const setup = await leer("configuracion", "quepan_v2");
      d.exigir(
        setup?.lista === true,
        "Estamos preparando la actualización. Espera un momento y vuelve a guardar.",
      );
      const gerente = () => d.gerente(u);
      const sucursalPropia = (s) =>
        d.exigir(
          u.rol === "GERENTE" || u.sucursalId === s,
          "Sucursal no autorizada",
          "permission-denied",
        );
      const sucursalActiva = async (id) => {
        const s = await leer("sucursales", id);
        d.exigir(s?.activo, "Sucursal inactiva o inexistente");
        return s;
      };
      let result,
        antes = null,
        despues = null,
        pedidoId = null;
      const stockRef = (origen, producto) =>
        origen === "PRODUCCION"
          ? ["productos", producto]
          : ["inventario_sucursales", origen + "_" + producto];
      async function stock(origen, pid) {
        const [c, id] = stockRef(origen, pid);
        const x = await leer(c, id);
        return { c, id, x: x || { existencia: 0, reservado: 0 } };
      }
      async function reservar(origen, oldLines, newLines) {
        const ids = [
          ...new Set([...oldLines, ...newLines].map((l) => l.productoId)),
        ];
        const changes = [];
        for (const pid of ids) {
          const p = await leer("productos", pid);
          const n = newLines.find((l) => l.productoId === pid)?.cantidad || 0,
            b = oldLines.find((l) => l.productoId === pid)?.cantidad || 0;
          d.exigir(!n || p?.activo, "Producto inactivo o inexistente");
          const s = await stock(origen, pid);
          const reservado = red((s.x.reservado || 0) - b + n),
            disponible = red((s.x.existencia || 0) - (s.x.reservado || 0) + b);
          d.exigir(
            n <= disponible || n <= b,
            `${p?.nombre || pid}: solo hay ${Math.max(0, disponible)} unidades disponibles. Falta de stock.`,
          );
          d.exigir(
            reservado >= 0,
            "Reserva inconsistente; solicita revisión al administrador",
          );
          changes.push([s, Math.max(0, reservado)]);
        }
        changes.forEach(([s, reservado]) =>
          poner(s.c, s.id, { reservado, actualizado: stamp() }),
        );
      }
      async function detallesConNombre(rows) {
        const lines = d.detalles(rows),
          out = [];
        for (const l of lines) {
          const p = await leer("productos", l.productoId);
          d.exigir(p?.activo, "Producto inactivo");
          out.push({
            ...l,
            codigo: p.codigo || p.id,
            nombre: p.nombre,
            unidad: p.unidad || "UND",
          });
        }
        return out;
      }
      if (["crearPedido", "modificarPedido"].includes(action)) {
        if (action === "modificarPedido") {
          pedidoId = d.id(a.pedidoId);
          antes = await leer("pedidos", pedidoId);
          d.exigir(antes, "Pedido inexistente");
          sucursalPropia(antes.sucursalId);
          d.exigir(
            antes.estado === "PENDIENTE",
            "Solo se modifica un pedido pendiente. Los pedidos despachados conservan su seguimiento.",
          );
        }
        const branch = antes?.sucursalId || d.id(a.sucursalId);
        sucursalPropia(branch);
        const s = await sucursalActiva(branch);
        const origen = antes?.origenId || a.origenId || "PRODUCCION";
        d.exigir(
          origen === "PRODUCCION" || origen !== branch,
          "El origen debe ser producción u otra sucursal",
          "invalid-argument",
        );
        const source =
          origen === "PRODUCCION"
            ? { nombre: "Producción central" }
            : await sucursalActiva(d.id(origen));
        const lines = await detallesConNombre(a.detalles),
          date = fecha(a.fechaEntrega),
          comentarios = opcional(a.comentarios);
        if (antes)
          d.exigir(
            antes.reservaAplicada === true,
            "Pedido anterior pendiente de preparar sus reservas",
          );
        await reservar(origen, antes?.detalles || [], lines);
        let numero = antes?.numero,
          vendedorUid = antes?.vendedorUid || uid;
        if (!antes) {
          const count = await leer("contadores", "pedido_" + branch);
          const n = (count?.valor || 0) + 1;
          d.exigir(s.prefijo, "Sucursal sin prefijo de pedidos");
          numero = s.prefijo + "-" + String(n).padStart(2, "0");
          poner("contadores", "pedido_" + branch, { valor: n });
          if (u.rol === "GERENTE") {
            const vs = await tx.get(
              db.collection("usuarios").where("sucursalId", "==", branch),
            );
            const v = vs.docs.find(
              (x) => x.data().activo && x.data().rol === "VENDEDOR",
            );
            d.exigir(
              v,
              "Asigna un vendedor activo a esta sucursal antes de pedir",
            );
            vendedorUid = v.id;
          }
        }
        const esPrueba =
          a.esPrueba === undefined ? antes?.esPrueba === true : a.esPrueba;
        d.exigir(
          typeof esPrueba === "boolean",
          "Clasificación de pedido no válida",
          "invalid-argument",
        );
        if (a.esPrueba !== undefined && esPrueba !== (antes?.esPrueba === true))
          gerente();
        despues = {
          ...(antes || {}),
          esPrueba,
          numero,
          sucursalId: branch,
          sucursalNombre: s.nombre,
          origenId: origen,
          origenNombre: source.nombre,
          vendedorUid,
          solicitanteUid: antes?.solicitanteUid || uid,
          fechaEntrega: date,
          comentarios,
          detalles: lines,
          estado: "PENDIENTE",
          status: "O",
          reservaAplicada: true,
          actualizado: stamp(),
        };
        delete despues.id;
        pedidoId = pedidoId || key;
        if (antes) poner("pedidos", pedidoId, despues);
        else crear("pedidos", pedidoId, { ...despues, creado: stamp() });
        result = {
          id: pedidoId,
          numero,
          mensaje: `Pedido ${numero} ${antes ? "modificado" : "registrado"}; unidades reservadas`,
        };
      } else if (
        [
          "cancelarPedido",
          "despachar",
          "entregar",
          "incidencia",
          "reasignar",
        ].includes(action)
      ) {
        pedidoId = d.id(a.pedidoId);
        antes = await leer("pedidos", pedidoId);
        d.exigir(antes, "Pedido inexistente");
        despues = { ...antes };
        delete despues.id;
        if (action === "cancelarPedido") {
          sucursalPropia(antes.sucursalId);
          d.exigir(
            antes.estado === "PENDIENTE",
            "Solo se cancela un pedido pendiente. Un pedido ya despachado requiere gestionar su entrega.",
          );
          if (antes.reservaAplicada)
            await reservar(antes.origenId || "PRODUCCION", antes.detalles, []);
          Object.assign(despues, {
            estado: "CANCELADO",
            status: "C",
            reservaAplicada: false,
            cancelado: stamp(),
            motivoCancelacion: opcional(a.motivo) || "Cancelado por el usuario",
          });
        } else if (action === "despachar") {
          d.exigir(
            u.rol === "GERENTE" ||
              (antes.origenId !== "PRODUCCION" &&
                antes.origenId === u.sucursalId),
            "Solo el gerente o la sucursal de origen puede despachar",
            "permission-denied",
          );
          d.exigir(
            antes.estado === "PENDIENTE",
            "Solo se despacha un pedido pendiente",
          );
          const vendedorUid = d.id(a.vendedorUid || antes.vendedorUid),
            v = await leer("usuarios", vendedorUid);
          d.exigir(
            v?.activo &&
              v.rol === "VENDEDOR" &&
              v.sucursalId === antes.sucursalId,
            "El vendedor debe pertenecer a la sucursal de destino",
          );
          const unidad = d.texto(a.unidad, 60),
            ruta = d.texto(a.ruta, 80),
            changes = [];
          for (const l of antes.detalles) {
            const s = await stock(antes.origenId || "PRODUCCION", l.productoId);
            const reservado = red(
              (s.x.reservado || 0) - (antes.reservaAplicada ? l.cantidad : 0),
            );
            d.exigir(reservado >= 0, "Reserva inconsistente");
            changes.push([
              s,
              {
                existencia: d.descontar(s.x.existencia || 0, l.cantidad),
                reservado,
                actualizado: stamp(),
              },
            ]);
          }
          changes.forEach(([s, x]) => poner(s.c, s.id, x));
          Object.assign(despues, {
            estado: "EN_RUTA",
            reservaAplicada: false,
            vendedorUid,
            unidad,
            ruta,
            despachado: stamp(),
          });
        } else if (action === "entregar") {
          d.autor(u, uid, antes);
          d.exigir(antes.estado === "EN_RUTA", "El pedido no está en ruta");
          for (const l of antes.detalles) {
            const s = await stock(antes.sucursalId, l.productoId);
            poner(s.c, s.id, {
              sucursalId: antes.sucursalId,
              productoId: l.productoId,
              existencia: red((s.x.existencia || 0) + l.cantidad),
              reservado: s.x.reservado || 0,
              minimo: 1,
              actualizado: stamp(),
            });
          }
          Object.assign(despues, {
            estado: "ENTREGADO",
            entregado: stamp(),
            inventarioSucursalAplicado: true,
          });
        } else if (action === "incidencia") {
          d.autor(u, uid, antes);
          d.exigir(antes.estado === "EN_RUTA", "El pedido no está en ruta");
          crear("incidencias", key, {
            pedidoId,
            numero: antes.numero || pedidoId,
            vendedorUid: uid,
            detalle: d.texto(a.detalle, 500),
            estado: "ABIERTA",
            creado: stamp(),
          });
          Object.assign(despues, { estado: "INCIDENCIA", incidenciaId: key });
        } else {
          gerente();
          d.exigir(
            antes.estado === "INCIDENCIA",
            "El pedido no tiene una incidencia abierta",
          );
          const v = await leer("usuarios", d.id(a.vendedorUid));
          d.exigir(
            v?.activo &&
              v.rol === "VENDEDOR" &&
              v.sucursalId === antes.sucursalId,
            "El vendedor debe pertenecer a la sucursal de destino",
          );
          const i = await leer("incidencias", antes.incidenciaId);
          d.exigir(i?.estado === "ABIERTA", "Incidencia ya atendida");
          const unidad = d.texto(a.unidad, 60);
          poner("incidencias", i.id, {
            estado: "REASIGNADA",
            atendidoPor: uid,
            nuevoVendedor: v.id,
            nuevaUnidad: unidad,
            resuelto: stamp(),
          });
          Object.assign(despues, {
            estado: "EN_RUTA",
            vendedorUid: v.id,
            unidad,
            reasignado: stamp(),
          });
        }
        poner("pedidos", pedidoId, { ...despues, actualizado: stamp() });
        result = {
          id: pedidoId,
          numero: antes.numero || pedidoId,
          mensaje:
            action === "cancelarPedido"
              ? "Pedido cancelado. La reserva se liberó y el historial se conserva."
              : "Operación guardada",
        };
      } else if (["ventaSucursal", "ajustarSucursal"].includes(action)) {
        const branch = d.id(a.sucursalId);
        sucursalPropia(branch);
        await sucursalActiva(branch);
        const pid = d.id(a.productoId),
          p = await leer("productos", pid);
        d.exigir(p?.activo, "Producto inactivo");
        const s = await stock(branch, pid),
          motivo = d.texto(a.motivo, 300);
        const existencia =
          action === "ventaSucursal"
            ? d.descontar(s.x.existencia || 0, d.centavos(a.cantidad) / 100)
            : cantidad0(a.existencia);
        d.exigir(
          existencia >= (s.x.reservado || 0),
          "No se puede reducir por debajo de las unidades reservadas para otra sucursal",
        );
        poner(s.c, s.id, {
          sucursalId: branch,
          productoId: pid,
          existencia,
          reservado: s.x.reservado || 0,
          minimo: 1,
          actualizado: stamp(),
        });
        crear("salidas_sucursales", key, {
          sucursalId: branch,
          productoId: pid,
          cantidad:
            action === "ventaSucursal"
              ? a.cantidad
              : red(existencia - (s.x.existencia || 0)),
          tipo: action,
          anterior: s.x.existencia || 0,
          existencia,
          motivo,
          usuarioUid: uid,
          creado: stamp(),
        });
        if (existencia <= 1)
          crear("notificaciones", key, {
            tipo: "STOCK_SUCURSAL",
            sucursalId: branch,
            titulo: "Pedir más producto",
            mensaje: `${p.nombre}: quedan ${existencia} unidades en la sucursal.`,
            estado: "PENDIENTE",
            creado: stamp(),
          });
        result = {
          id: key,
          mensaje:
            existencia <= 1
              ? "Movimiento guardado. Queda una unidad o menos: solicita más producto."
              : "Movimiento guardado",
        };
      } else if (["guardarCatalogo", "desactivarCatalogo"].includes(action)) {
        gerente();
        const c = a.coleccion;
        d.exigir(
          [
            "productos",
            "ingredientes",
            "recetas",
            "sucursales",
            "usuarios",
          ].includes(c),
          "Catálogo no permitido",
          "invalid-argument",
        );
        const id = d.id(a.id || key),
          prev = await leer(c, id);
        const x = a.datos || {};
        let value;
        if (action === "desactivarCatalogo") {
          d.exigir(prev, "Registro inexistente");
          d.exigir(
            c !== "usuarios",
            "Las cuentas se administran desde sus perfiles",
          );
          if (c === "sucursales") {
            const pendientes = await tx.get(
              db.collection("pedidos").where("sucursalId", "==", id),
            );
            const origenes = await tx.get(
              db.collection("pedidos").where("origenId", "==", id),
            );
            d.exigir(
              ![...pendientes.docs, ...origenes.docs].some((p) =>
                ["PENDIENTE", "EN_RUTA", "INCIDENCIA"].includes(
                  p.data().estado,
                ),
              ),
              "La sucursal tiene pedidos en proceso",
            );
          }
          if (c === "productos") {
            const pedidos = await tx.get(
              db.collection("pedidos").where("estado", "==", "PENDIENTE"),
            );
            d.exigir(
              !(prev.reservado > 0) &&
                !pedidos.docs.some((p) =>
                  (p.data().detalles || []).some((l) => l.productoId === id),
                ),
              "El producto tiene pedidos pendientes",
            );
          }
          if (c === "ingredientes") {
            const recetas = await tx.get(db.collection("recetas"));
            d.exigir(
              !recetas.docs.some(
                (r) =>
                  r.data().activo !== false &&
                  (r.data().ingredientes || []).some(
                    (l) => l.ingredienteId === id,
                  ),
              ),
              "El ingrediente pertenece a una receta activa. Modifica o elimina primero esa receta.",
            );
          }
          value = { activo: false, actualizado: stamp() };
        } else if (c === "usuarios") {
          d.exigir(prev, "Primero crea la cuenta de acceso en Firebase");
          d.exigir(
            prev.rol === "VENDEDOR",
            "Este formulario administra vendedores",
          );
          await sucursalActiva(d.id(x.sucursalId));
          value = {
            nombre: d.texto(x.nombre, 100),
            sucursalId: x.sucursalId,
            activo: x.activo !== false,
            actualizado: stamp(),
          };
        } else if (c === "recetas") {
          const p = await leer("productos", id);
          d.exigir(p?.activo, "Elige un producto activo");
          d.exigir(
            Array.isArray(x.ingredientes) && x.ingredientes.length > 0,
            "Agrega ingredientes",
          );
          const seen = new Set(),
            items = [];
          for (const l of x.ingredientes) {
            const iid = d.id(l.ingredienteId);
            d.exigir(!seen.has(iid), "Ingrediente repetido");
            seen.add(iid);
            const i = await leer("ingredientes", iid);
            d.exigir(i?.activo, "Ingrediente inactivo");
            items.push({
              ingredienteId: iid,
              cantidad: d.centavos(l.cantidad) / 100,
            });
          }
          value = {
            nombre: d.texto(x.nombre, 120),
            rendimiento: d.centavos(x.rendimiento) / 100,
            ingredientes: items,
            activo: true,
            actualizado: stamp(),
          };
        } else if (c === "sucursales") {
          const prefijo = prev?.prefijo || d.texto(x.prefijo, 5).toUpperCase();
          d.exigir(
            /^[A-Z]{2,5}$/.test(prefijo),
            "Prefijo de 2 a 5 letras",
            "invalid-argument",
          );
          const iguales = await tx.get(
            db.collection("sucursales").where("prefijo", "==", prefijo),
          );
          d.exigir(
            !iguales.docs.some((s) => s.id !== id),
            "El prefijo ya existe",
          );
          value = {
            nombre: d.texto(x.nombre, 120),
            direccion: opcional(x.direccion, 300),
            prefijo,
            activo: x.activo !== false,
            actualizado: stamp(),
          };
        } else {
          let codigo = prev?.codigo;
          if (!codigo) {
            const seq = await leer("contadores", "codigo_" + c),
              n = (seq?.valor || 0) + 1;
            codigo =
              (c === "productos" ? "P" : "I") +
              "-" +
              String(n).padStart(3, "0");
            poner("contadores", "codigo_" + c, { valor: n });
          }
          value = {
            nombre: d.texto(x.nombre, 120),
            descripcion: opcional(x.descripcion, 300),
            unidad: d.texto(x.unidad || "UND", 20),
            minimo: cantidad0(x.minimo ?? 1),
            codigo,
            activo: x.activo !== false,
            actualizado: stamp(),
          };
          if (!prev)
            Object.assign(value, {
              existencia: 0,
              reservado: 0,
              creado: stamp(),
            });
        }
        poner(c, id, value);
        crear("auditoria_catalogos", key, {
          coleccion: c,
          registroId: id,
          accion: action,
          anterior: prev,
          datos: value,
          usuarioUid: uid,
          creado: stamp(),
        });
        result = {
          id,
          mensaje:
            action === "desactivarCatalogo"
              ? "Registro eliminado de los listados. El historial se conserva."
              : "Registro guardado",
        };
      } else if (action === "entrada") {
        gerente();
        const id = d.id(a.ingredienteId),
          s = await leer("ingredientes", id);
        d.exigir(s?.activo, "Ingrediente inactivo");
        const amount = d.centavos(a.cantidad) / 100,
          total = red(s.existencia + amount);
        cantidad0(total);
        poner("ingredientes", id, { existencia: total });
        crear("movimientos", key, {
          tipo: "ENTRADA",
          ingredienteId: id,
          cantidad: amount,
          usuarioUid: uid,
          creado: stamp(),
        });
        result = { id: key, mensaje: "Entrada registrada" };
      } else if (action === "producir") {
        gerente();
        const id = d.id(a.productoId),
          p = await leer("productos", id),
          rec = await leer("recetas", id);
        d.exigir(
          p?.activo && rec && rec.activo !== false,
          "Producto sin receta activa",
        );
        const amount = d.centavos(a.cantidad) / 100,
          items = d.consumo(rec, amount),
          changes = [];
        for (const l of items) {
          const i = await leer("ingredientes", l.ingredienteId);
          d.exigir(i?.activo, "Ingrediente inactivo");
          const posterior = d.descontar(i.existencia, l.cantidad);
          Object.assign(l, {
            codigo: i.codigo || i.id,
            nombre: i.nombre,
            unidad: i.unidad || "",
            anterior: i.existencia,
            posterior,
          });
          changes.push([i.id, posterior]);
        }
        const total = red(p.existencia + amount);
        cantidad0(total);
        changes.forEach(([iid, existencia]) =>
          poner("ingredientes", iid, { existencia }),
        );
        poner("productos", id, { existencia: total });
        crear("producciones", key, {
          productoId: id,
          cantidad: amount,
          consumos: items,
          existenciaAnterior: p.existencia,
          existenciaPosterior: total,
          productoNombre: p.nombre,
          codigo: p.codigo || id,
          unidad: p.unidad || "",
          recetaRendimiento: rec.rendimiento,
          estado: "FINALIZADA",
          usuarioUid: uid,
          creado: stamp(),
        });
        result = { id: key, mensaje: "Producción finalizada" };
      } else
        throw new d.ErrorNegocio("Acción no permitida", "invalid-argument");
      if (pedidoId)
        crear("historial_pedidos", key, {
          pedidoId,
          numero: despues.numero || pedidoId,
          accion: action,
          status: action === "cancelarPedido" ? "C" : "O",
          anterior: antes,
          datos: despues,
          usuarioUid: uid,
          creado: stamp(),
        });
      // Todas las lecturas anteriores terminan antes de aplicar la primera escritura.
      writes.forEach((fn) => fn());
      tx.create(op, {
        accion: action,
        usuarioUid: uid,
        huella,
        resultado: result,
        creado: stamp(),
      });
      return result;
    });
  };
}
module.exports = { crearNegocio, fecha, cantidad0 };
