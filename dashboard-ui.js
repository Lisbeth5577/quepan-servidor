"use strict";
// Presentación del dashboard. Todos los cálculos llegan de una consulta autenticada del servidor.
const Dashboard = (() => {
  let peticion = 0;
  const cantidad = (n) =>
    new Intl.NumberFormat("es-GT", { maximumFractionDigits: 2 }).format(n || 0);
  const unidades = (xs) =>
    xs?.length
      ? xs.map((x) => cantidad(x.cantidad) + " " + x.unidad).join(" · ")
      : "Sin movimientos";
  // Cada indicador es una fila de una tabla: concepto, valor y aclaración.
  function filaResumen(p, titulo, valor, nota = "") {
    let tabla = p.querySelector("table");
    if (!tabla) {
      tabla = nodo("table", undefined, p);
      const encabezado = nodo("tr", undefined, nodo("thead", undefined, tabla));
      nodo("th", "Concepto", encabezado);
      nodo("th", "Valor", encabezado);
      nodo("th", "Detalle", encabezado);
      nodo("tbody", undefined, tabla);
    }
    const fila = nodo("tr", undefined, tabla.querySelector("tbody"));
    nodo("td", titulo, fila);
    nodo("td", String(valor), fila);
    nodo("td", nota, fila);
  }
  function recuentos(id, lista) {
    const contenedor = $(id);
    contenedor.replaceChildren();
    for (const item of lista) filaResumen(contenedor, item[0], item[1]);
  }
  function tabla(id, cols, filas) {
    const p = $(id);
    p.replaceChildren();
    if (!filas.length) {
      nodo("p", "Sin registros para mostrar.", p).className = "nota";
      return;
    }
    const t = nodo("table", undefined, p),
      h = nodo("tr", undefined, nodo("thead", undefined, t));
    cols.forEach(([s]) => nodo("th", s, h));
    const b = nodo("tbody", undefined, t);
    for (const f of filas) {
      const r = nodo("tr", undefined, b);
      cols.forEach(([, fn]) => nodo("td", fn(f), r));
    }
  }
  async function cargar(silencioso = false) {
    if (!gerente() || modulo !== "dashboard") return;
    if (!$("dash-mes").value) $("dash-mes").value = hoy().slice(0, 7);
    const mes = $("dash-mes").value,
      id = ++peticion;
    if (!/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(mes)) {
      mensaje("Elige un mes válido.", true);
      return;
    }
    if (!silencioso) {
      mensaje("Preparando el resumen general…");
      $("dash-actualizado").textContent = "Consultando el mes " + mes + "…";
      // No mostrar cifras del mes anterior mientras responde el nuevo.
      [
        "dash-pruebas",
        "dash-finanzas",
        "dash-ingresos",
        "dash-cifras",
        "dash-cantidades",
        "dash-top",
        "dash-ranking",
        "dash-sucursales",
        "dash-dias",
        "dash-estados",
        "dash-totales",
        "dash-inventario",
        "dash-alertas-productos",
        "dash-alertas-ingredientes",
        "dash-faltantes",
      ].forEach((k) => $(k).replaceChildren());
    }
    try {
      const x = await api("/api/dashboard?mes=" + mes);
      if (id !== peticion || modulo !== "dashboard" || !perfil) return;
      pintar(x);
      if (!silencioso) mensaje("Resumen actualizado. No se modificaron datos.");
    } catch (e) {
      if (id === peticion && modulo === "dashboard") {
        $("dash-actualizado").textContent =
          "No se pudo actualizar el resumen de " +
          mes +
          ". No uses las cifras anteriores como datos de este mes.";
        [
          "dash-pruebas",
          "dash-finanzas",
          "dash-ingresos",
          "dash-cifras",
          "dash-cantidades",
          "dash-top",
          "dash-ranking",
          "dash-sucursales",
          "dash-dias",
          "dash-estados",
          "dash-totales",
          "dash-inventario",
          "dash-alertas-productos",
          "dash-alertas-ingredientes",
          "dash-faltantes",
        ].forEach((k) => $(k).replaceChildren());
        mensaje(e.message, true);
      }
    }
  }
  function pintar(x) {
    const filas = x.finanzas?.sucursales || [];
    const formatoQ = (centavos) =>
      centavos == null ? "Pendiente" : "Q " + (centavos / 100).toFixed(2);
    const parcial = (valor) =>
      valor.preciosPendientes
        ? formatoQ(valor.subtotalConocidoCentavos) +
          " conocidos; " +
          valor.preciosPendientes +
          " sin precio"
        : formatoQ(valor.totalCentavos);
    const ingreso = filas.reduce(
      (s, f) => s + f.ventas.subtotalConocidoCentavos,
      0,
    );
    const pendientes = filas.reduce(
      (s, f) => s + f.ventas.preciosPendientes + f.ventasSinClasificar,
      0,
    );
    $("dash-ingresos").textContent =
      "Ingresos registrados con precio: " +
      formatoQ(ingreso) +
      ". Registros de venta o salida pendientes: " +
      pendientes +
      ". No es utilidad ni confirmación de cobros.";
    tabla(
      "dash-finanzas",
      [
        ["Sucursal", (f) => f.nombre],
        ["Total pedidos vigentes", (f) => parcial(f.pedidos)],
        ["Total entregas", (f) => parcial(f.entregas)],
        ["Ingresos por ventas", (f) => parcial(f.ventas)],
        ["Ventas registradas", (f) => f.numeroVentas],
        ["Salidas antiguas sin clasificar", (f) => f.ventasSinClasificar],
        ["Salidas sin venta", (f) => f.salidasSinVenta],
      ],
      filas,
    );

    $("dash-pruebas").textContent =
      `Resumen de pedidos reales. Se excluyen ${x.pruebasExcluidas?.pedidosMes || 0} pedidos de prueba en este mes (${unidades(x.pruebasExcluidas?.cantidadesMes)}). Las pruebas se conservan en pedidos e historial. Las existencias siguen mostrando los saldos registrados; esta clasificación no corrige el inventario físico.`;
    const m = x.mesResumen,
      t = x.total,
      p = $("dash-cifras");
    p.replaceChildren();
    filaResumen(
      p,
      "Pedidos reales del mes",
      cantidad(m.registrados),
      "Incluye cancelados; cada pedido una vez",
    );
    filaResumen(
      p,
      "Pedidos vigentes del mes",
      cantidad(m.vigentes),
      "Excluye cancelados",
    );
    filaResumen(
      p,
      "Pedidos cancelados del mes",
      cantidad(m.cancelados),
      "Creados en el mes y actualmente cancelados",
    );
    filaResumen(
      p,
      "Entregas confirmadas en el mes",
      cantidad(m.entregas),
      "Según fecha real de confirmación",
    );
    filaResumen(p, "Lotes producidos en el mes", cantidad(m.lotes));
    filaResumen(
      p,
      "Ventas / salidas en el mes",
      cantidad(m.ventasSalidas),
      "Registros de salida; no importe de dinero",
    );
    const q = $("dash-cantidades");
    q.replaceChildren();
    filaResumen(
      q,
      "Cantidad solicitada del mes",
      unidades(m.solicitado),
      "Pedidos vigentes, por unidad",
    );
    filaResumen(q, "Cantidad entregada del mes", unidades(m.entregado));
    filaResumen(q, "Cantidad producida del mes", unidades(m.producido));
    filaResumen(q, "Cantidad vendida / retirada", unidades(m.vendido));
    const top = $("dash-top");
    top.replaceChildren();
    if (x.ranking.length) {
      const a = x.ranking[0];
      nodo("p", a.codigo + " · " + a.nombre, top).className = "dash-top";
      nodo(
        "p",
        cantidad(a.pedidos) +
          " pedidos · " +
          cantidad(a.cantidad) +
          " " +
          a.unidad +
          " solicitados",
        top,
      );
      const empates = x.ranking.filter((b) => b.pedidos === a.pedidos);
      if (empates.length > 1)
        nodo(
          "p",
          "Empate en número de pedidos: " +
            empates.map((b) => b.nombre).join(", ") +
            ".",
          top,
        ).className = "nota";
    } else nodo("p", "Todavía no hay pedidos vigentes en este mes.", top);
    tabla(
      "dash-ranking",
      [
        ["Producto", (a) => a.nombre],
        ["Pedidos", (a) => cantidad(a.pedidos)],
        ["Solicitado", (a) => cantidad(a.cantidad) + " " + a.unidad],
      ],
      x.ranking.slice(0, 10),
    );
    tabla(
      "dash-sucursales",
      [
        ["Sucursal", (a) => a.nombre],
        ["Pedidos", (a) => cantidad(a.pedidos)],
      ],
      x.sucursales,
    );
    const dias = $("dash-dias");
    dias.replaceChildren();
    // La actividad diaria se presenta como tabla, sin barras gráficas.
    tabla(
      "dash-dias",
      [
        ["Fecha", (fila) => fila.dia],
        ["Pedidos", (fila) => cantidad(fila.vigentes)],
      ],
      x.dias.filter((fila) => fila.vigentes > 0),
    );
    const etiquetas = {
      PENDIENTE: "Pendientes",
      EN_RUTA: "En ruta",
      ENTREGADO: "Entregados",
      INCIDENCIA: "Con incidencia",
      CANCELADO: "Cancelados",
      SIN_ESTADO: "Sin estado",
    };
    recuentos(
      "dash-estados",
      Object.entries(x.estados).map(([e, n]) => [
        etiquetas[e] || e,
        cantidad(n),
      ]),
    );
    recuentos("dash-totales", [
      ["Pedidos reales (todos los meses)", cantidad(t.pedidos)],
      ["Pedidos vigentes (todos los meses)", cantidad(t.vigentes)],
      ["Pedidos cancelados (todos los meses)", cantidad(t.cancelados)],
      ["Pendientes actuales", cantidad(t.pendientes)],
      ["Pedidos en ruta actuales", cantidad(t.enRuta)],
      ["Incidencias abiertas", cantidad(t.incidencias)],
      ["Productos activos", cantidad(t.productos)],
      ["Ingredientes activos", cantidad(t.ingredientes)],
      ["Sucursales activas", cantidad(t.sucursales)],
    ]);
    const inv = $("dash-inventario");
    inv.replaceChildren();
    filaResumen(inv, "Terminado en producción", unidades(t.stockProduccion));
    filaResumen(inv, "Reservado en producción", unidades(t.reservado));
    filaResumen(inv, "Disponible en producción", unidades(t.disponible));
    filaResumen(
      inv,
      "Terminado en sucursales",
      unidades(t.stockSucursales),
      "Solo saldos registrados; no inventa conteos",
    );
    tabla(
      "dash-alertas-productos",
      [
        ["Producto", (a) => a.nombre],
        ["Disponible", (a) => cantidad(a.disponible) + " " + a.unidad],
        ["Mínimo", (a) => cantidad(a.minimo)],
      ],
      x.alertasProductos,
    );
    tabla(
      "dash-alertas-ingredientes",
      [
        ["Ingrediente", (a) => a.nombre],
        ["Existencia", (a) => cantidad(a.existencia) + " " + a.unidad],
        ["Mínimo", (a) => cantidad(a.minimo)],
      ],
      x.alertasIngredientes,
    );
    $("dash-faltantes").textContent =
      (t.reservasSinRespaldo?.length
        ? `Reservas históricas sin existencia física: ${unidades(t.reservasSinRespaldo)}. Se debe producir o corregir esos pedidos; no se inventaron existencias. La disponibilidad se calcula producto por producto. `
        : "") +
      `Conteos de sucursal pendientes: ${t.conteosPendientes}. Pedidos sin fecha de creación: ${x.faltantes.pedidosSinFecha}; entregados sin fecha de confirmación: ${x.faltantes.entregadosSinFecha}. Los registros sin fecha no se atribuyen a un mes.`;
    $("dash-actualizado").textContent =
      "Mes: " +
      x.mes +
      " · Actualizado: " +
      hora(x.actualizado) +
      " · Horario de Guatemala";
  }
  $("dash-mes").addEventListener("change", () => cargar());
  return { cargar };
})();
