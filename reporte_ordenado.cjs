"use strict";
const d = require("./domain"),
  { todos } = require("./consultas.cjs");
const CATEGORIAS = {
  pedidos: "Pedidos",
  programados: "Programados",
  entregas: "Entregas",
  despachos: "Despachos",
  incidencias: "Incidencias",
  reasignaciones: "Reasignaciones",
  produccion: "Producción",
  consumos: "Consumos",
  entradas: "Entradas",
  avisos: "Avisos",
  intentos: "Intentos",
  cancelaciones: "Cancelaciones",
  modificaciones: "Modificaciones",
  ventas: "Ventas y salidas",
  catalogos: "Cambios de catálogo",
};
function limites(fecha) {
  d.exigir(
    typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha),
    "Usa AAAA-MM-DD",
    "invalid-argument",
  );
  const inicio = new Date(fecha + "T06:00:00Z");
  d.exigir(
    !Number.isNaN(+inicio) && inicio.toISOString().slice(0, 10) === fecha,
    "Fecha inválida",
    "invalid-argument",
  );
  return { inicio, fin: new Date(+inicio + 86400000) };
}
function fechaHora(v) {
  if (!v) return "";
  const x = v.toDate ? v.toDate() : new Date(v);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Guatemala",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(x)
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
function celda(v) {
  let s = v == null ? "" : String(v);
  if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
const TITULOS = [
  "Fecha",
  "Hora",
  "Número de pedido",
  "Sucursal",
  "Vendedor de sucursal",
  "Código de producto",
  "Descripción del producto",
  "Cantidad solicitada",
  "Cantidad despachada",
  "Cantidad entregada",
  "Cantidad del movimiento",
  "Unidad",
  "Actividad",
  "Status O/C",
  "Estado del pedido",
  "Fecha solicitada de entrega",
  "Origen",
  "Ruta",
  "Vehículo",
  "Comentarios",
  "Usuario que operó",
  "Identificador de auditoría",
  "Precio o costo unitario Q",
  "Importe de la línea Q",
  "Moneda",
  "Tipo de salida",
  "Registro real o prueba",
];
async function generarReporte(db, uid, fecha, tipo = "todo") {
  d.exigir(uid, "Inicia sesión", "unauthenticated");
  const u = (await db.doc("usuarios/" + uid).get()).data();
  d.perfil(u);
  limites(fecha);
  d.exigir(
    tipo === "todo" || CATEGORIAS[tipo],
    "Tipo de reporte inválido",
    "invalid-argument",
  );
  const cs = [
    "pedidos",
    "historial_pedidos",
    "productos",
    "ingredientes",
    "sucursales",
    "usuarios",
    "producciones",
    "movimientos",
    "incidencias",
    "notificaciones",
    "salidas_sucursales",
    "auditoria_catalogos",
  ];
  const lists = await Promise.all(cs.map((c) => todos(db, c))),
    data = Object.fromEntries(cs.map((c, i) => [c, lists[i]]));
  const map = (c) => new Map(data[c].map((x) => [x.id, x])),
    productos = map("productos"),
    ingredientes = map("ingredientes"),
    sucursales = map("sucursales"),
    usuarios = map("usuarios"),
    pedidos = map("pedidos");
  const dentro = (t) => fechaHora(t).slice(0, 10) === fecha,
    rows = [];
  const visible = (p) =>
    u.rol === "GERENTE" ||
    p.sucursalId === u.sucursalId ||
    p.origenId === u.sucursalId;
  function fila(cat, t, p = {}, l = {}, e = {}) {
    if (!visible(p)) return;
    const fh = fechaHora(t),
      prod =
        (e.ingrediente ? ingredientes : productos).get(
          l.productoId || l.ingredienteId,
        ) || {};
    const row = [
      fh.slice(0, 10) || fecha,
      fh.slice(11),
      p.numero || "",
      p.sucursalNombre || sucursales.get(p.sucursalId)?.nombre || "",
      usuarios.get(p.vendedorUid)?.nombre || "",
      l.codigo || prod.codigo || "",
      l.nombre || prod.nombre || "",
      e.solicitada ?? "",
      e.despachada ?? "",
      e.entregada ?? "",
      e.cantidad ?? "",
      l.unidad || prod.unidad || "",
      e.actividad || CATEGORIAS[cat],
      e.status || "O",
      p.estado || "",
      p.fechaEntrega || "",
      p.origenNombre || sucursales.get(p.origenId)?.nombre || "",
      p.ruta || "",
      p.unidad || "",
      e.comentarios ?? p.comentarios ?? "",
      usuarios.get(e.uid)?.nombre || "",
      e.audit || "",
      (l.precioUnitarioCentavos ?? l.costoUnitarioCentavos) == null
        ? "Pendiente"
        : (l.precioUnitarioCentavos ?? l.costoUnitarioCentavos) / 100,
      l.importeCentavos == null
        ? "Pendiente o no aplica"
        : l.importeCentavos / 100,
      "GTQ",
      l.tipoMovimiento || "",
      p.esPrueba === true || l.esPrueba === true
        ? "Prueba"
        : "Real o histórico sin clasificar",
    ];
    rows.push({ cat, row });
  }
  function lineas(cat, t, p, e = {}) {
    for (const l of p.detalles || [])
      fila(cat, t, p, l, {
        ...e,
        solicitada: l.cantidad,
        despachada: cat === "despachos" ? l.cantidad : "",
        entregada: cat === "entregas" ? l.cantidad : "",
      });
  }
  const cats = {
    crearPedido: "pedidos",
    modificarPedido: "modificaciones",
    cancelarPedido: "cancelaciones",
    despachar: "despachos",
    entregar: "entregas",
    incidencia: "incidencias",
    reasignar: "reasignaciones",
  };
  for (const h of data.historial_pedidos) {
    if (!dentro(h.creado)) continue;
    const cat = cats[h.accion];
    if (!cat) continue;
    if (h.accion === "modificarPedido" && h.anterior)
      lineas(cat, h.creado, h.anterior, {
        status: "C",
        actividad: "VERSIÓN ANTERIOR SUSTITUIDA",
        uid: h.usuarioUid,
        audit: h.id,
      });
    const p = h.datos || pedidos.get(h.pedidoId) || {};
    lineas(cat, h.creado, p, {
      status: h.status,
      actividad:
        h.accion === "modificarPedido"
          ? "PEDIDO MODIFICADO"
          : h.accion === "cancelarPedido"
            ? "PEDIDO CANCELADO"
            : CATEGORIAS[cat],
      uid: h.usuarioUid,
      audit: h.id,
      comentarios:
        h.accion === "cancelarPedido" ? p.motivoCancelacion : p.comentarios,
    });
  }
  // Los registros anteriores se muestran con el estado conservado; no se inventan versiones.
  for (const p of data.pedidos) {
    for (const [cat, campo, act] of [
      ["pedidos", "creado", "crearPedido"],
      ["despachos", "despachado", "despachar"],
      ["entregas", "entregado", "entregar"],
      ["reasignaciones", "reasignado", "reasignar"],
      ["cancelaciones", "cancelado", "cancelarPedido"],
    ]) {
      if (
        dentro(p[campo]) &&
        !data.historial_pedidos.some(
          (h) => h.pedidoId === p.id && h.accion === act,
        )
      )
        lineas(cat, p[campo], p, {
          status: p.status || "O",
          comentarios:
            (p.comentarios || "") +
            " · Registro anterior: se muestra su estado conservado.",
        });
    }
    if (p.fechaEntrega === fecha)
      lineas("programados", null, p, { status: p.status || "O" });
  }
  for (const i of data.incidencias)
    if (
      dentro(i.creado) &&
      !data.historial_pedidos.some(
        (h) =>
          h.accion === "incidencia" &&
          h.pedidoId === i.pedidoId &&
          dentro(h.creado),
      )
    )
      lineas("incidencias", i.creado, pedidos.get(i.pedidoId) || {}, {
        uid: i.vendedorUid,
        comentarios: i.detalle,
        audit: i.id,
      });
  for (const i of data.incidencias)
    if (dentro(i.resuelto))
      lineas("incidencias", i.resuelto, pedidos.get(i.pedidoId) || {}, {
        uid: i.atendidoPor,
        comentarios: "Incidencia atendida. " + (i.nuevaUnidad || ""),
        audit: i.id,
      });
  for (const p of data.producciones)
    if (dentro(p.creado)) {
      fila("produccion", p.creado, {}, p, {
        cantidad: p.cantidad,
        uid: p.usuarioUid,
        audit: p.id,
      });
      for (const l of p.consumos || [])
        fila("consumos", p.creado, {}, l, {
          ingrediente: true,
          cantidad: l.cantidad,
          uid: p.usuarioUid,
          audit: p.id,
        });
    }
  for (const m of data.movimientos)
    if (dentro(m.creado))
      fila("entradas", m.creado, {}, m, {
        ingrediente: true,
        cantidad: m.cantidad,
        uid: m.usuarioUid,
        audit: m.id,
      });
  for (const m of data.salidas_sucursales)
    if (dentro(m.creado))
      fila("ventas", m.creado, { sucursalId: m.sucursalId }, m, {
        cantidad: m.cantidad,
        uid: m.usuarioUid,
        audit: m.id,
        actividad: m.tipo,
        comentarios: m.motivo,
      });
  for (const n of data.notificaciones) {
    if (dentro(n.creado))
      fila(
        "avisos",
        n.creado,
        { sucursalId: n.sucursalId },
        {},
        { audit: n.id, actividad: n.titulo, comentarios: n.mensaje },
      );
    if (dentro(n.intentado))
      fila(
        "intentos",
        n.intentado,
        { sucursalId: n.sucursalId },
        {},
        { audit: n.id, actividad: n.estado, comentarios: n.mensaje },
      );
  }
  for (const c of data.auditoria_catalogos)
    if (dentro(c.creado))
      fila(
        "catalogos",
        c.creado,
        {},
        { nombre: c.datos?.nombre || c.anterior?.nombre },
        {
          status: c.accion === "desactivarCatalogo" ? "C" : "O",
          actividad: c.accion,
          uid: c.usuarioUid,
          audit: c.id,
          comentarios: c.coleccion + "/" + c.registroId,
        },
      );
  const selected = rows.filter(
    (x) =>
      tipo === "todo" ||
      x.cat === tipo ||
      (tipo === "pedidos" &&
        ["modificaciones", "cancelaciones"].includes(x.cat)),
  );
  selected.sort(
    (a, b) =>
      a.row[0].localeCompare(b.row[0]) ||
      a.row[1].localeCompare(b.row[1]) ||
      a.row[2].localeCompare(b.row[2], undefined, { numeric: true }) ||
      a.row[5].localeCompare(b.row[5]) ||
      a.row[13].localeCompare(b.row[13]),
  );
  const csv =
    "\ufeffsep=;\r\n" +
    [TITULOS, ...selected.map((x) => x.row)]
      .map((x) => x.map(celda).join(";"))
      .join("\r\n") +
    "\r\n";
  return {
    archivo: `QUEPAN_${tipo}_${fecha}.csv`,
    tabla: [TITULOS, ...selected.map((x) => x.row)],
    csv,
    filas: selected.length,
    tipo,
    resumen: Object.fromEntries(
      Object.keys(CATEGORIAS).map((c) => [
        c,
        rows.filter((x) => x.cat === c).length,
      ]),
    ),
  };
}
module.exports = {
  generarReporte,
  limites,
  fechaHora,
  celda,
  CATEGORIAS,
  TITULOS,
};
