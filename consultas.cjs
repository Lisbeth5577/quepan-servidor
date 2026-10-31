"use strict";
const d = require("./domain");
const serial = (v) =>
  v?.toDate
    ? v.toDate().toISOString()
    : Array.isArray(v)
      ? v.map(serial)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, serial(x)]))
        : v;
const listas = [
  "descuentos",
  "solicitudes_produccion",
  "productos",
  "ingredientes",
  "recetas",
  "sucursales",
  "usuarios",
  "pedidos",
  "producciones",
  "movimientos",
  "incidencias",
  "alertas",
  "notificaciones",
  "inventario_sucursales",
  "salidas_sucursales",
];
async function todos(db, c) {
  const out = [];
  let last;
  do {
    let q = db.collection(c).orderBy("__name__").limit(250);
    if (last) q = q.startAfter(last);
    const s = await q.get();
    out.push(...s.docs.map((x) => ({ id: x.id, ...x.data() })));
    if (s.size < 250) break;
    last = s.docs.at(-1);
  } while (true);
  return out;
}
function puedeVerAviso(n, u, uid) {
  if (n.destinatarioUid) return n.destinatarioUid === uid;
  if (n.tipo === "STOCK_SUCURSAL") return u.rol === "GERENTE" || (u.rol === "VENDEDOR" && Boolean(u.sucursalId) && n.sucursalId === u.sucursalId);
  return u.rol === "GERENTE";
}
async function consultar(db, uid, modulo) {
  d.exigir(
    listas.includes(modulo),
    "Consulta no disponible",
    "invalid-argument",
  );
  const u = (await db.doc("usuarios/" + uid).get()).data();
  d.perfil(u);
  const gerente = u.rol === "GERENTE";
  const repartidor = u.rol === "REPARTIDOR";
  d.exigir(
    !repartidor || ["pedidos", "incidencias", "notificaciones"].includes(modulo),
    "El repartidor solo consulta sus entregas",
    "permission-denied",
  );
  d.exigir(
    gerente ||
      [
        "descuentos",
        "productos",
        "sucursales",
        "pedidos",
        "incidencias",
        "inventario_sucursales",
        "salidas_sucursales",
        "alertas",
        "notificaciones",
      ].includes(modulo),
    "Solo el gerente puede consultar este módulo",
    "permission-denied",
  );
  let rows = await todos(db, modulo);
  if (modulo === "notificaciones") rows = rows.filter(n => puedeVerAviso(n, u, uid));
  if (modulo === "descuentos" && !gerente)
    rows = rows.filter((x) => x.sucursalId === u.sucursalId);
  if (modulo === "pedidos")
    rows = rows.filter(
      (x) =>
        x.status !== "C" &&
        x.estado !== "CANCELADO" &&
        (repartidor
          ? x.repartidorUid === uid
          : gerente ||
            x.sucursalId === u.sucursalId ||
            x.origenId === u.sucursalId),
    );
  if (modulo === "incidencias") {
    const pedidos = new Map((await todos(db, "pedidos")).map((p) => [p.id, p]));
    const sucursales = new Map((await todos(db, "sucursales")).map((s) => [s.id, s]));
    rows = rows.filter((x) => {
      const p = pedidos.get(x.pedidoId);
      if (x.esPrueba === true || p?.esPrueba === true || x.pedidoId === "demo-ruta-20261019") return false;
      if (gerente) return true;
      if (repartidor) return (x.repartidorUid || x.vendedorUid) === uid;
      // El pedido determina la sucursal, aunque la incidencia la reporte un repartidor.
      return Boolean(u.sucursalId) && (p
        ? p.sucursalId === u.sucursalId || p.origenId === u.sucursalId
        : x.sucursalId === u.sucursalId);
    }).map((x) => {
      const p = pedidos.get(x.pedidoId) || {};
      const sucursalId = p.sucursalId || x.sucursalId;
      return { ...x, numero: p.numero || x.numero, sucursalId,
        sucursalNombre: sucursales.get(sucursalId)?.nombre || p.sucursalNombre || x.sucursalNombre || sucursalId };
    });
  }
  if (repartidor && ["pedidos", "incidencias"].includes(modulo)) {
    const sucursales = new Map(
      (await todos(db, "sucursales")).map((s) => [s.id, s]),
    );
    const pedidos =
      modulo === "incidencias"
        ? new Map((await todos(db, "pedidos")).map((p) => [p.id, p]))
        : null;
    rows = rows.map((x) => {
      const p = pedidos ? pedidos.get(x.pedidoId) || {} : x;
      const s = sucursales.get(p.sucursalId) || {};
      const entrega = {
        sucursalId: p.sucursalId,
        sucursalNombre: s.nombre || p.sucursalNombre,
        direccionEntrega: s.direccion || "Pendiente de registrar",
      };
      if (pedidos) return { ...x, ...entrega };
      return {
        id: x.id,
        numero: x.numero,
        estado: x.estado,
        fechaEntrega: x.fechaEntrega,
        ...entrega,
        origenNombre: x.origenNombre || "Producción central",
        ruta: x.ruta,
        unidad: x.unidad,
        comentarios: x.comentarios,
        repartidorUid: x.repartidorUid,
        repartidorNombre: x.repartidorNombre,
        detalles: (x.detalles || []).map((l) => ({
          productoId: l.productoId,
          codigo: l.codigo,
          nombre: l.nombre,
          cantidad: l.cantidad,
          unidad: l.unidad,
        })),
        despachado: x.despachado,
        entregado: x.entregado,
      };
    });
  }
  if (modulo === "salidas_sucursales" && !gerente)
    rows = rows.filter((x) => x.sucursalId === u.sucursalId);
  if (["productos", "ingredientes", "recetas", "sucursales"].includes(modulo))
    rows = rows.filter((x) => x.activo !== false);
  if (modulo === "productos")
    rows = rows.map((x) => ({
      ...x,
      disponible: Math.max(
        0,
        Math.round((x.existencia - (x.reservado || 0)) * 100) / 100,
      ),
    }));
  if (modulo === "inventario_sucursales") {
    const [productos, sucursales] = await Promise.all([
      todos(db, "productos"),
      todos(db, "sucursales"),
    ]);
    const map = new Map(
      rows.map((x) => [x.sucursalId + "_" + x.productoId, x]),
    );
    rows = sucursales
      .filter((s) => s.activo)
      .flatMap((s) =>
        productos
          .filter((p) => p.activo)
          .map((p) => {
            const id = s.id + "_" + p.id,
              x = map.get(id) || {
                id,
                sucursalId: s.id,
                productoId: p.id,
                existencia: 0,
                reservado: 0,
                sinConteo: true,
              };
            return {
              ...x,
              sucursalNombre: s.nombre,
              productoNombre: p.nombre,
              codigo: p.codigo || p.id,
              unidad: p.unidad,
              disponible: Math.max(
                0,
                Math.round((x.existencia - (x.reservado || 0)) * 100) / 100,
              ),
              alerta: x.existencia <= 1 ? "Pedir más producto" : "Suficiente",
            };
          }),
      );
  }
  // Lista explícita: nunca devolver tokens, contraseñas ni datos de autenticación.
  const safe = {
    usuarios: ["nombre", "rol", "sucursalId", "activo"],
    productos: [
      "precioVenta",
      "moneda",
      "codigo",
      "nombre",
      "descripcion",
      "unidad",
      "existencia",
      "reservado",
      "disponible",
      "minimo",
      "activo",
    ],
    sucursales: ["nombre", "direccion", "prefijo", "activo"],
  };
  if (safe[modulo])
    rows = rows.map((x) =>
      Object.fromEntries(
        ["id", ...safe[modulo]]
          .filter((k) => x[k] !== undefined)
          .map((k) => [k, x[k]]),
      ),
    );
  return {
    filas: serial(rows),
    actualizado: new Date().toISOString(),
    miSucursal: u.sucursalId || null,
  };
}
module.exports = { consultar, todos, serial, puedeVerAviso };
