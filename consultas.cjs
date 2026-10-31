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
    !repartidor ||
      ["pedidos", "incidencias", "productos", "sucursales"].includes(modulo),
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
      ].includes(modulo),
    "Solo el gerente puede consultar este módulo",
    "permission-denied",
  );
  let rows = await todos(db, modulo);
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
    // Las incidencias de pedidos de prueba no se muestran en la operación diaria.
    const pruebas = new Set(
      (await todos(db, "pedidos"))
        .filter((x) => x.esPrueba === true)
        .map((x) => x.id),
    );
    rows = rows.filter(
      (x) =>
        x.esPrueba !== true &&
        !pruebas.has(x.pedidoId) &&
        x.pedidoId !== "demo-ruta-20261019",
    );
    if (!gerente) rows = rows.filter((x) => x.vendedorUid === uid);
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
module.exports = { consultar, todos, serial };
