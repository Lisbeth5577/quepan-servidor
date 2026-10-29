"use strict";
// Dinero en centavos enteros. null significa precio pendiente, nunca cero.
const d = require("./domain");
function precio(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  d.exigir(
    typeof valor === "number" &&
      Number.isFinite(valor) &&
      valor >= 0 &&
      valor <= 1000000 &&
      Math.abs(Math.round(valor * 100) - valor * 100) < 0.00001,
    "El precio debe tener como máximo dos decimales y no ser negativo",
    "invalid-argument",
  );
  return Math.round(valor * 100);
}
function importe(cantidad, centavos) {
  if (centavos === null || centavos === undefined) return null;
  d.exigir(
    Number.isSafeInteger(centavos) && centavos >= 0,
    "Precio guardado no válido",
  );
  return Math.round((Math.round(cantidad * 100) * centavos) / 100);
}
function sumar(lineas, campo = "importeCentavos") {
  let conocido = 0,
    pendientes = 0;
  for (const linea of lineas) {
    const valor = linea[campo];
    if (Number.isSafeInteger(valor) && valor >= 0) conocido += valor;
    else pendientes++;
  }
  return {
    moneda: "GTQ",
    totalCentavos: pendientes ? null : conocido,
    subtotalConocidoCentavos: conocido,
    preciosPendientes: pendientes,
  };
}
module.exports = { precio, importe, sumar };
// Resume únicamente importes guardados; nunca aplica precios actuales a registros antiguos.
function resumenSucursales({
  sucursales,
  pedidos,
  entregas,
  salidas,
  mes,
  dia,
}) {
  const mapa = new Map();
  function fila(id) {
    if (!mapa.has(id))
      mapa.set(id, {
        sucursalId: id,
        nombre:
          sucursales.find((s) => s.id === id)?.nombre || id || "Sin sucursal",
        pedidos: [],
        entregas: [],
        ventas: [],
        ventasSinClasificar: 0,
        salidasSinVenta: 0,
      });
    return mapa.get(id);
  }
  for (const s of sucursales) if (s.activo !== false) fila(s.id);
  for (const p of pedidos)
    fila(p.sucursalId).pedidos.push({ importeCentavos: p.totalCentavos });
  for (const p of entregas)
    fila(p.sucursalId).entregas.push({ importeCentavos: p.totalCentavos });
  for (const v of salidas) {
    if (
      dia(v.creado).slice(0, 7) !== mes ||
      v.esPrueba === true ||
      v.tipo !== "ventaSucursal"
    )
      continue;
    const f = fila(v.sucursalId);
    if (!v.tipoMovimiento) {
      f.ventasSinClasificar++;
      continue;
    }
    if (v.tipoMovimiento === "venta") f.ventas.push(v);
    else f.salidasSinVenta++;
  }
  return [...mapa.values()]
    .map((f) => ({
      sucursalId: f.sucursalId,
      nombre: f.nombre,
      pedidos: sumar(f.pedidos),
      entregas: sumar(f.entregas),
      ventas: sumar(f.ventas),
      numeroVentas: f.ventas.length,
      ventasSinClasificar: f.ventasSinClasificar,
      salidasSinVenta: f.salidasSinVenta,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}
module.exports.resumenSucursales = resumenSucursales;
