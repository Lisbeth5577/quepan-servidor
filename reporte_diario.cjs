"use strict";
const d = require("./domain");

// Guatemala usa UTC-6. El limite final es exclusivo: no mezcla dos dias.
function limites(fecha) {
  d.exigir(
    typeof fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fecha),
    "Usa una fecha AAAA-MM-DD",
    "invalid-argument",
  );
  const inicio = new Date(fecha + "T06:00:00.000Z");
  d.exigir(
    !Number.isNaN(inicio.getTime()) &&
      inicio.toISOString().slice(0, 10) === fecha,
    "Fecha no valida",
    "invalid-argument",
  );
  return { inicio, fin: new Date(inicio.getTime() + 86400000) };
}
function fechaHora(valor) {
  if (!valor) return "";
  const date = valor.toDate ? valor.toDate() : new Date(valor);
  const parts = Object.fromEntries(
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
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
function celda(valor) {
  let s = valor == null ? "" : String(valor);
  // Los nombres y descripciones nunca deben convertirse en formulas de Excel.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
async function paginas(query) {
  const docs = [];
  let ultimo;
  do {
    const pagina = await (ultimo ? query.startAfter(ultimo) : query)
      .limit(250)
      .get();
    docs.push(...pagina.docs);
    if (pagina.size < 250) break;
    ultimo = pagina.docs[pagina.docs.length - 1];
  } while (true);
  return docs.map((s) => ({ id: s.id, ...s.data() }));
}
async function nombres(db, coleccion, ids) {
  const mapa = new Map();
  mapa.unidades = new Map();
  const unicos = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += 100) {
    const docs = await db.getAll(
      ...unicos.slice(i, i + 100).map((id) => db.collection(coleccion).doc(id)),
    );
    docs.forEach((s) => {
      mapa.set(s.id, s.exists ? s.data().nombre || s.id : s.id);
      mapa.unidades.set(s.id, s.exists ? s.data().unidad || "" : "");
    });
  }
  return mapa;
}
async function generarReporte(db, uid, fecha) {
  d.exigir(uid, "Inicia sesion", "unauthenticated");
  const perfil = await db.collection("usuarios").doc(uid).get();
  d.gerente(perfil.data());
  const { inicio, fin } = limites(fecha);
  // Son consultas de solo lectura, paginadas. No se corta el listado a 250 filas.
  const durante = (coleccion, campo = "creado") =>
    paginas(
      db
        .collection(coleccion)
        .where(campo, ">=", inicio)
        .where(campo, "<", fin)
        .orderBy(campo),
    );
  const [
    creados,
    programados,
    despachados,
    entregados,
    reasignados,
    operaciones,
    incidencias,
    resueltas,
    entradas,
    producciones,
    avisos,
    intentos,
  ] = await Promise.all([
    durante("pedidos"),
    paginas(
      db
        .collection("pedidos")
        .where("fechaEntrega", "==", fecha)
        .orderBy("fechaEntrega"),
    ),
    durante("pedidos", "despachado"),
    durante("pedidos", "entregado"),
    durante("pedidos", "reasignado"),
    durante("operaciones"),
    durante("incidencias"),
    durante("incidencias", "resuelto"),
    durante("movimientos"),
    durante("producciones"),
    durante("notificaciones"),
    durante("notificaciones", "intentado"),
  ]);
  const pedidos = new Map(
    [
      ...creados,
      ...programados,
      ...despachados,
      ...entregados,
      ...reasignados,
    ].map((p) => [p.id, p]),
  );
  const ids = [
    ...new Set(
      [
        ...operaciones.map((o) => o.resultado?.id),
        ...incidencias.map((i) => i.pedidoId),
        ...resueltas.map((i) => i.pedidoId),
      ].filter(Boolean),
    ),
  ].filter((id) => !pedidos.has(id));
  // Algunas operaciones apuntan a producciones o movimientos, no a pedidos.
  for (let i = 0; i < ids.length; i += 100) {
    const docs = await db.getAll(
      ...ids.slice(i, i + 100).map((id) => db.collection("pedidos").doc(id)),
    );
    docs
      .filter((s) => s.exists)
      .forEach((s) => pedidos.set(s.id, { id: s.id, ...s.data() }));
  }
  const [productos, sucursales, usuarios, ingredientes] = await Promise.all([
    nombres(
      db,
      "productos",
      [...pedidos.values()]
        .flatMap((p) => (p.detalles || []).map((l) => l.productoId))
        .concat(producciones.map((p) => p.productoId)),
    ),
    nombres(
      db,
      "sucursales",
      [...pedidos.values()].map((p) => p.sucursalId),
    ),
    nombres(
      db,
      "usuarios",
      [...operaciones, ...entradas, ...producciones]
        .map((p) => p.usuarioUid)
        .concat(incidencias.map((i) => i.vendedorUid)),
    ),
    nombres(
      db,
      "ingredientes",
      entradas
        .map((e) => e.ingredienteId)
        .concat(
          producciones.flatMap((p) =>
            (p.consumos || []).map((c) => c.ingredienteId),
          ),
        ),
    ),
  ]);
  const encabezado = [
    "seccion",
    "fecha_hora_guatemala",
    "id",
    "pedido",
    "producto_ingrediente",
    "cantidad",
    "unidad",
    "estado_actual",
    "usuario",
    "sucursal",
    "vehiculo_actual",
    "ruta_actual",
    "detalle",
  ];
  const filas = [];
  const fila = (seccion, tiempo, id, pedido = {}, extra = {}) =>
    filas.push([
      seccion,
      fechaHora(tiempo),
      id,
      pedido.id || "",
      extra.producto || "",
      extra.cantidad ?? "",
      extra.unidad || "",
      extra.estado || pedido.estado || "",
      extra.usuario
        ? `${usuarios.get(extra.usuario) || extra.usuario} (${extra.usuario})`
        : "",
      sucursales.get(pedido.sucursalId) || pedido.sucursalId || "",
      pedido.unidad || "",
      pedido.ruta || "",
      extra.detalle || "",
    ]);
  const lineasPedido = (seccion, tiempo, p) => {
    const lineas = p.detalles?.length ? p.detalles : [{}];
    lineas.forEach((l) =>
      fila(seccion, tiempo, p.id, p, {
        producto: productos.get(l.productoId) || l.productoId,
        cantidad: l.cantidad,
        unidad: productos.unidades.get(l.productoId),
        detalle: "Entrega programada: " + (p.fechaEntrega || ""),
      }),
    );
  };
  creados.forEach((p) => lineasPedido("PEDIDOS CREADOS", p.creado, p));
  programados.forEach((p) => lineasPedido("PEDIDOS PROGRAMADOS", null, p));
  const eventos = operaciones.map((o) => ({
    accion: o.accion,
    fecha: o.creado,
    id: o.id,
    pedido: pedidos.get(o.resultado?.id),
    usuario: o.usuarioUid,
    detalle: o.resultado?.mensaje || "",
  }));
  // Compatibilidad con pedidos antiguos sin una entrada en operaciones.
  for (const [lista, accion, campo] of [
    [despachados, "despachar", "despachado"],
    [entregados, "entregar", "entregado"],
    [reasignados, "reasignar", "reasignado"],
  ])
    lista.forEach((p) => {
      if (!eventos.some((e) => e.accion === accion && e.pedido?.id === p.id))
        eventos.push({
          accion,
          fecha: p[campo],
          id: p.id,
          pedido: p,
          detalle: "Registro del pedido; sin auditoria de usuario",
        });
    });
  const secciones = {
    crearPedido: "ALTA DE PEDIDO",
    despachar: "DESPACHOS",
    entregar: "ENTREGAS",
    incidencia: "REPORTE DE INCIDENCIA",
    reasignar: "REASIGNACIONES",
    entrada: "OPERACION DE ENTRADA",
    producir: "OPERACION DE PRODUCCION",
  };
  eventos.sort(
    (a, b) => (a.fecha?.toMillis?.() || 0) - (b.fecha?.toMillis?.() || 0),
  );
  eventos.forEach((e) => {
    if (e.accion === "entregar" && e.pedido)
      (e.pedido.detalles || []).forEach((l) =>
        fila("ENTREGAS", e.fecha, e.id, e.pedido, {
          producto: productos.get(l.productoId) || l.productoId,
          cantidad: l.cantidad,
          unidad: productos.unidades.get(l.productoId),
          usuario: e.usuario,
          detalle: e.detalle,
        }),
      );
    else
      fila(secciones[e.accion] || e.accion, e.fecha, e.id, e.pedido, {
        usuario: e.usuario,
        detalle: e.detalle,
      });
  });
  incidencias.forEach((i) =>
    fila(
      "INCIDENCIAS ABIERTAS EN EL DIA",
      i.creado,
      i.id,
      pedidos.get(i.pedidoId),
      { usuario: i.vendedorUid, estado: i.estado, detalle: i.detalle },
    ),
  );
  resueltas.forEach((i) =>
    fila(
      "INCIDENCIAS ATENDIDAS EN EL DIA",
      i.resuelto,
      i.id,
      pedidos.get(i.pedidoId),
      {
        usuario: i.atendidoPor,
        estado: i.estado,
        detalle: "Nueva unidad: " + (i.nuevaUnidad || ""),
      },
    ),
  );
  entradas.forEach((e) =>
    fila(
      "MOVIMIENTOS DE INGREDIENTES",
      e.creado,
      e.id,
      {},
      {
        producto: ingredientes.get(e.ingredienteId) || e.ingredienteId,
        cantidad: e.cantidad,
        unidad: ingredientes.unidades.get(e.ingredienteId),
        usuario: e.usuarioUid,
        detalle: e.tipo,
      },
    ),
  );
  producciones.forEach((p) => {
    fila(
      "PRODUCCION",
      p.creado,
      p.id,
      {},
      {
        producto: productos.get(p.productoId) || p.productoId,
        cantidad: p.cantidad,
        unidad: productos.unidades.get(p.productoId),
        usuario: p.usuarioUid,
        estado: p.estado,
      },
    );
    (p.consumos || []).forEach((c) =>
      fila(
        "CONSUMO EN PRODUCCION",
        p.creado,
        p.id,
        {},
        {
          producto: ingredientes.get(c.ingredienteId) || c.ingredienteId,
          cantidad: c.cantidad,
          unidad: ingredientes.unidades.get(c.ingredienteId),
          usuario: p.usuarioUid,
        },
      ),
    );
  });
  avisos.forEach((n) =>
    fila(
      "AVISOS",
      n.creado,
      n.id,
      {},
      {
        estado: n.estado,
        detalle: `${n.titulo || n.tipo}: ${n.mensaje || ""}. Enviados: ${n.enviados || 0}; fallos: ${n.fallos || 0}`,
      },
    ),
  );
  intentos.forEach((n) =>
    fila(
      "INTENTOS DE ENVIO DE AVISOS",
      n.intentado,
      n.id,
      {},
      {
        estado: n.estado,
        detalle: `${n.titulo || n.tipo}: ${n.mensaje || ""}. Enviados: ${n.enviados || 0}; fallos: ${n.fallos || 0}`,
      },
    ),
  );
  const resumen = {
    pedidos_creados: creados.length,
    pedidos_programados: programados.length,
    despachos: eventos.filter((e) => e.accion === "despachar").length,
    entregas: eventos.filter((e) => e.accion === "entregar").length,
    incidencias: incidencias.length,
    reasignaciones: eventos.filter((e) => e.accion === "reasignar").length,
    entradas: entradas.length,
    producciones: producciones.length,
    avisos: avisos.length,
    intentos_envio: intentos.length,
  };
  const meta = [
    [
      "REPORTE DIARIO",
      fecha,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Actividad registrada en Firebase. Estado, unidad y ruta son los actuales al descargar; no un cierre contable inmutable.",
    ],
    [
      "GENERADO",
      fechaHora(new Date()),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "Zona horaria: America/Guatemala",
    ],
  ];
  Object.entries(resumen).forEach(([nombre, total]) =>
    meta.push([
      "RESUMEN",
      fecha,
      nombre,
      "",
      "",
      total,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]),
  );
  if (!filas.length)
    meta.push([
      "SIN ACTIVIDAD",
      fecha,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "No se encontraron registros para esta fecha.",
    ]);
  const csv =
    "\ufeffsep=;\r\n" +
    [encabezado, ...meta, ...filas]
      .map((row) => row.map(celda).join(";"))
      .join("\r\n") +
    "\r\n";
  return { archivo: `SIPROPAN_diario_${fecha}.csv`, csv, resumen };
}
module.exports = { limites, fechaHora, celda, generarReporte };
