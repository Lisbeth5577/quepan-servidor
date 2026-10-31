"use strict";
// Resumen de solo lectura. No suma versiones del historial ni inventa importes de ventas.
const dinero = require("./precios.cjs");
const d = require("./domain"),
  { todos } = require("./consultas.cjs");
const formato = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Guatemala",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function dia(v) {
  const x = v?.toDate ? v.toDate() : v ? new Date(v) : null;
  return x && Number.isFinite(+x) ? formato.format(x) : "";
}
function mesValido(mes) {
  d.exigir(
    typeof mes === "string" && /^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(mes),
    "Elige un mes válido (AAAA-MM)",
    "invalid-argument",
  );
  return mes;
}
const red = (n) => Math.round(n * 100) / 100;
// Unificar solo equivalencias de la misma unidad, sin convertir kilogramos a piezas.
function unidadNormalizada(v) {
  const u = String(v || "SIN UNIDAD")
    .trim()
    .toUpperCase();
  return ["UNIDAD", "UNIDADES", "UND"].includes(u)
    ? "UND"
    : ["KG", "KILOGRAMO", "KILOGRAMOS"].includes(u)
      ? "KG"
      : u;
}
function agruparCantidades(filas) {
  const m = new Map();
  for (const x of filas) {
    const u = unidadNormalizada(x.unidad);
    m.set(u, red((m.get(u) || 0) + Number(x.cantidad || 0)));
  }
  return [...m].sort().map(([unidad, cantidad]) => ({ unidad, cantidad }));
}
function resumir(datos, mes) {
  mesValido(mes);
  const {
    pedidos: pedidosGuardados = [],
    productos = [],
    ingredientes = [],
    sucursales = [],
    producciones = [],
    salidas_sucursales: salidas = [],
    inventario_sucursales: inventario = [],
    incidencias = [],
  } = datos;
  // La usuaria puede conservar pedidos de prueba sin mezclarlos con operaciones reales.
  const pedidosPrueba = pedidosGuardados.filter((x) => x.esPrueba === true);
  const pedidos = pedidosGuardados.filter((x) => x.esPrueba !== true);
  const idsPrueba = new Set(pedidosPrueba.map((x) => x.id));
  const pm = new Map(productos.map((x) => [x.id, x]));
  const activos = (xs) => xs.filter((x) => x.activo !== false);
  const cancelado = (x) => x.status === "C" || x.estado === "CANCELADO";
  const dentro = (v) => dia(v).slice(0, 7) === mes;
  // El mes de pedidos corresponde a su creación; las entregas a su confirmación real.
  const delMes = pedidos.filter((x) => dentro(x.creado)),
    vigentes = delMes.filter((x) => !cancelado(x));
  const entregas = pedidos.filter(
    (x) => !cancelado(x) && x.estado === "ENTREGADO" && dentro(x.entregado),
  );
  const hechos = producciones.filter(
    (x) => x.estado === "FINALIZADA" && dentro(x.creado),
  );
  const ventas = salidas.filter(
    (x) =>
      x.tipo === "ventaSucursal" && x.esPrueba !== true && dentro(x.creado),
  );
  const lineas = (pedidos) =>
    pedidos.flatMap((p) =>
      (p.detalles || []).map((l) => ({
        ...l,
        unidad: unidadNormalizada(l.unidad || pm.get(l.productoId)?.unidad),
      })),
    );
  const ranking = new Map(),
    porSucursal = new Map();
  for (const pedido of vigentes) {
    const ids = new Set();
    for (const l of pedido.detalles || []) {
      const prod = pm.get(l.productoId) || {},
        unidad = unidadNormalizada(l.unidad || prod.unidad),
        key = l.productoId + "|" + unidad;
      const a = ranking.get(key) || {
        productoId: l.productoId,
        codigo: l.codigo || prod.codigo || l.productoId,
        nombre:
          l.productoId === "demo-ruta-20261019"
            ? "Producto de prueba (histórico)"
            : l.nombre || prod.nombre || l.productoId,
        unidad,
        cantidad: 0,
        pedidos: 0,
      };
      a.cantidad = red(a.cantidad + Number(l.cantidad || 0));
      if (!ids.has(key)) {
        a.pedidos++;
        ids.add(key);
      }
      ranking.set(key, a);
    }
    const a = porSucursal.get(pedido.sucursalId) || {
      sucursalId: pedido.sucursalId,
      nombre:
        pedido.sucursalNombre ||
        sucursales.find((s) => s.id === pedido.sucursalId)?.nombre ||
        pedido.sucursalId,
      pedidos: 0,
    };
    a.pedidos++;
    porSucursal.set(pedido.sucursalId, a);
  }
  // Ordenar por número de pedidos permite comparar productos con unidades distintas.
  const masPedidos = [...ranking.values()].sort(
    (a, b) => b.pedidos - a.pedidos || a.nombre.localeCompare(b.nombre, "es"),
  );
  const dias = Array.from(
    {
      length: new Date(
        Number(mes.slice(0, 4)),
        Number(mes.slice(5)),
        0,
      ).getDate(),
    },
    (_, i) => ({
      dia: mes + "-" + String(i + 1).padStart(2, "0"),
      registrados: 0,
      vigentes: 0,
      entregas: 0,
    }),
  );
  for (const p of delMes) {
    const a = dias[Number(dia(p.creado).slice(8)) - 1];
    a.registrados++;
    if (!cancelado(p)) a.vigentes++;
  }
  for (const p of entregas)
    dias[Number(dia(p.entregado).slice(8)) - 1].entregas++;
  const prods = activos(productos),
    ings = activos(ingredientes),
    sucs = activos(sucursales);
  const inventarioActivo = inventario.filter(
    (x) =>
      sucs.some((s) => s.id === x.sucursalId) &&
      prods.some((p) => p.id === x.productoId),
  );
  const conteos = new Set(
    inventarioActivo.map((x) => x.sucursalId + "|" + x.productoId),
  );
  const alertasProductos = prods
    .filter(
      (x) =>
        Math.max(0, Number(x.existencia || 0) - Number(x.reservado || 0)) <=
        Number(x.minimo || 0),
    )
    .map((x) => ({
      codigo: x.codigo || x.id,
      nombre: x.nombre,
      existencia: x.existencia || 0,
      reservado: x.reservado || 0,
      disponible: Math.max(
        0,
        red(Number(x.existencia || 0) - Number(x.reservado || 0)),
      ),
      unidad: x.unidad || "SIN UNIDAD",
      minimo: x.minimo || 0,
    }));
  const alertasIngredientes = ings
    .filter((x) => Number(x.existencia || 0) <= Number(x.minimo || 0))
    .map((x) => ({
      codigo: x.codigo || x.id,
      nombre: x.nombre,
      existencia: x.existencia || 0,
      unidad: x.unidad || "SIN UNIDAD",
      minimo: x.minimo || 0,
    }));
  const estados = {};
  for (const p of delMes) {
    const e = cancelado(p) ? "CANCELADO" : p.estado || "SIN ESTADO";
    estados[e] = (estados[e] || 0) + 1;
  }
  return {
    mes,
    zonaHoraria: "America/Guatemala",
    actualizado: new Date().toISOString(),
    criterios: {
      pedidos:
        "Pedidos reales creados en el mes. Se excluyen pruebas; vigentes también excluye cancelados. Cada pedido se cuenta una sola vez.",
      entregas:
        "Confirmaciones de entrega realizadas en el mes, aunque el pedido se haya creado antes.",
      producto:
        "Producto presente en más pedidos vigentes del mes; las cantidades se muestran con su unidad.",
      inventario:
        "Existencias actuales; no son un cierre histórico del mes seleccionado.",
    },
    pruebasExcluidas: {
      pedidosMes: pedidosPrueba.filter((x) => dentro(x.creado)).length,
      pedidosTotal: pedidosPrueba.length,
      cantidadesMes: agruparCantidades(
        lineas(pedidosPrueba.filter((x) => dentro(x.creado))),
      ),
      nota: "Pedidos marcados como prueba excluidos del resumen real; sus registros e inventario se conservan.",
    },
    finanzas: {
      moneda: "GTQ",
      sucursales: dinero.resumenSucursales({
        sucursales,
        pedidos: vigentes,
        entregas,
        salidas,
        mes,
        dia,
      }),
    },
    mesResumen: {
      registrados: delMes.length,
      vigentes: vigentes.length,
      cancelados: delMes.length - vigentes.length,
      entregas: entregas.length,
      lotes: hechos.length,
      ventasSalidas: ventas.length,
      solicitado: agruparCantidades(lineas(vigentes)),
      entregado: agruparCantidades(lineas(entregas)),
      producido: agruparCantidades(
        hechos.map((x) => ({
          cantidad: x.cantidad,
          unidad: pm.get(x.productoId)?.unidad || "SIN UNIDAD",
        })),
      ),
      vendido: agruparCantidades(
        ventas.map((x) => ({
          cantidad: x.cantidad,
          unidad: pm.get(x.productoId)?.unidad || "SIN UNIDAD",
        })),
      ),
    },
    total: {
      pedidos: pedidos.length,
      vigentes: pedidos.filter((x) => !cancelado(x)).length,
      cancelados: pedidos.filter(cancelado).length,
      pendientes: pedidos.filter(
        (x) => !cancelado(x) && x.estado === "PENDIENTE",
      ).length,
      enRuta: pedidos.filter((x) => !cancelado(x) && x.estado === "EN_RUTA")
        .length,
      incidencias: incidencias.filter(
        (x) =>
          x.estado === "ABIERTA" &&
          !idsPrueba.has(x.pedidoId) &&
          x.esPrueba !== true,
      ).length,
      productos: prods.length,
      ingredientes: ings.length,
      sucursales: sucs.length,
      stockProduccion: agruparCantidades(
        prods.map((x) => ({ cantidad: x.existencia, unidad: x.unidad })),
      ),
      reservado: agruparCantidades(
        prods.map((x) => ({ cantidad: x.reservado || 0, unidad: x.unidad })),
      ),
      disponible: agruparCantidades(
        prods.map((x) => ({
          cantidad: Math.max(0, red((x.existencia || 0) - (x.reservado || 0))),
          unidad: x.unidad,
        })),
      ),
      reservasSinRespaldo: agruparCantidades(
        prods
          .filter((x) => (x.reservado || 0) > (x.existencia || 0))
          .map((x) => ({
            cantidad: red(x.reservado - x.existencia),
            unidad: x.unidad,
          })),
      ),
      stockSucursales: agruparCantidades(
        inventarioActivo.map((x) => ({
          cantidad: x.existencia,
          unidad: pm.get(x.productoId)?.unidad,
        })),
      ),
      conteosPendientes: Math.max(0, sucs.length * prods.length - conteos.size),
    },
    faltantes: {
      pedidosSinFecha: pedidos.filter((x) => !dia(x.creado)).length,
      entregadosSinFecha: pedidos.filter(
        (x) => x.estado === "ENTREGADO" && !dia(x.entregado),
      ).length,
    },
    estados,
    dias,
    ranking: masPedidos,
    sucursales: [...porSucursal.values()].sort(
      (a, b) => b.pedidos - a.pedidos || a.nombre.localeCompare(b.nombre, "es"),
    ),
    inventarioProduccion: prods.map(p => ({sucursal: "Producción central", codigo: p.codigo || p.id, producto: p.nombre, existencia: Number(p.existencia || 0), unidad: unidadNormalizada(p.unidad)})),
    inventarioSucursales: inventarioActivo.map((x) => ({
      sucursalId: x.sucursalId,
      sucursal: sucs.find((s) => s.id === x.sucursalId)?.nombre || x.sucursalId,
      codigo: pm.get(x.productoId)?.codigo || x.productoId,
      producto: pm.get(x.productoId)?.nombre || x.productoId,
      existencia: Number(x.existencia || 0),
      unidad: unidadNormalizada(pm.get(x.productoId)?.unidad),
    })).sort((a, b) => a.sucursal.localeCompare(b.sucursal, "es") || a.producto.localeCompare(b.producto, "es")),
    alertasProductos,
    alertasIngredientes,
  };
}
async function generarDashboard(db, uid, mes) {
  const u = (await db.doc("usuarios/" + uid).get()).data();
  d.gerente(u);
  mesValido(mes);
  const cs = [
    "pedidos",
    "productos",
    "ingredientes",
    "sucursales",
    "producciones",
    "salidas_sucursales",
    "inventario_sucursales",
    "incidencias",
  ];
  const listas = await Promise.all(cs.map((c) => todos(db, c)));
  return resumir(Object.fromEntries(cs.map((c, i) => [c, listas[i]])), mes);
}
module.exports = { generarDashboard, resumir, dia, agruparCantidades };
