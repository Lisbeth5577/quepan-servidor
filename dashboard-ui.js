"use strict";
// Resumen breve. No cambia datos ni sustituye valores reales por ceros.
const Dashboard = (() => {
  let peticion = 0;
  const cantidad = (n) => new Intl.NumberFormat("es-GT", { maximumFractionDigits: 2 }).format(n || 0);
  const dinero = (centavos) => centavos == null ? "Pendiente" : "Q " + (centavos / 100).toFixed(2);
  const unidades = (filas) => filas?.length
    ? filas.map((x) => cantidad(x.cantidad) + " " + x.unidad).join(" · ") : "0";
  function tabla(id, columnas, filas) {
    const p = $(id); p.replaceChildren();
    if (!filas.length) { nodo("p", "Sin registros", p).className = "nota"; return; }
    const t = nodo("table", undefined, p);
    const h = nodo("tr", undefined, nodo("thead", undefined, t));
    columnas.forEach(([titulo]) => nodo("th", titulo, h));
    const cuerpo = nodo("tbody", undefined, t);
    for (const fila of filas) {
      const tr = nodo("tr", undefined, cuerpo);
      columnas.forEach(([, valor]) => nodo("td", String(valor(fila)), tr));
    }
  }
  function pintar(x) {
    const m = x.mesResumen, t = x.total, sucursales = x.finanzas?.sucursales || [];
    const pendientes = sucursales.some((s) => s.ventas.preciosPendientes);
    const ingresos = sucursales.reduce((s, f) => s + f.ventas.subtotalConocidoCentavos, 0);
    const tarjetas = $("dash-cifras"); tarjetas.replaceChildren();
    for (const [titulo, valor] of [
      ["Pedidos del mes", cantidad(m.registrados)],
      ["Pendientes", cantidad(t.pendientes)],
      ["En ruta", cantidad(t.enRuta)],
      ["Entregas del mes", cantidad(m.entregas)],
      ["Producciones registradas", cantidad(m.lotes)],
      ["Ingresos del mes", pendientes ? "Pendiente" : dinero(ingresos)]
    ]) {
      const tarjeta = nodo("div", undefined, tarjetas); tarjeta.className = "resumen-tarjeta";
      nodo("span", titulo, tarjeta); nodo("strong", valor, tarjeta);
    }
    const rankingSucursales = sucursales.map(s => ({
      nombre: s.nombre,
      pedidos: (x.sucursales || []).find(p => p.sucursalId === s.sucursalId)?.pedidos || 0
    })).sort((a, b) => b.pedidos - a.pedidos || a.nombre.localeCompare(b.nombre, "es"));
    const panelSucursales = nodo("div", undefined, tarjetas);
    panelSucursales.className = "resumen-tarjeta resumen-sucursales";
    nodo("span", "Pedidos por sucursal", panelSucursales);
    const lista = nodo("ol", undefined, panelSucursales);
    for (const s of rankingSucursales) {
      nodo("li", s.nombre + ": " + cantidad(s.pedidos) + (s.pedidos === 1 ? " pedido" : " pedidos"), lista);
    }
    tabla("dash-finanzas", [
      ["Sucursal", (f) => f.nombre],
      ["Ventas", (f) => cantidad(f.numeroVentas)],
      ["Ingresos", (f) => dinero(f.ventas.totalCentavos)]
    ], sucursales);
    tabla("dash-ranking", [
      ["Producto", (p) => p.nombre], ["Pedidos", (p) => cantidad(p.pedidos)],
      ["Cantidad", (p) => cantidad(p.cantidad) + " " + p.unidad]
    ], x.ranking.slice(0, 5));
    tabla("dash-inventario", [["Ubicación", (f) => f[0]], ["Cantidad", (f) => f[1]]], [
      ["Producción", unidades(t.stockProduccion)], ["Disponible", unidades(t.disponible)],
      ["Reservado", unidades(t.reservado)], ["Sucursales", unidades(t.stockSucursales)]
    ]);
    $("dash-actualizado").textContent = "";
  }
  async function cargar(silencioso = false) {
    if (!gerente() || modulo !== "dashboard") return;
    if (!$("dash-mes").value) $("dash-mes").value = hoy().slice(0, 7);
    const mes = $("dash-mes").value, id = ++peticion;
    if (!/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(mes)) { mensaje("Elige un mes válido.", true); return; }
    if (!silencioso) {
      $("dash-actualizado").textContent = "Cargando…";
      ["dash-cifras", "dash-finanzas", "dash-ranking", "dash-inventario"].forEach((k) => $(k).replaceChildren());
    }
    try {
      const x = await api("/api/dashboard?mes=" + mes);
      if (id !== peticion || modulo !== "dashboard" || !perfil) return;
      pintar(x);
      if (!silencioso) mensaje("");
    } catch (e) {
      if (id === peticion && modulo === "dashboard") {
        $("dash-actualizado").textContent = "No se pudo actualizar.";
        ["dash-cifras", "dash-finanzas", "dash-ranking", "dash-inventario"].forEach((k) => $(k).replaceChildren());
        mensaje(e.message, true);
      }
    }
  }
  $("dash-mes").addEventListener("change", () => cargar());
  return { cargar };
})();
