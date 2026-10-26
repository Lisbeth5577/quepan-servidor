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
  function tarjeta(p, t, v, nota = "") {
    const c = nodo("article", undefined, p);
    c.className = "dash-cifra";
    nodo("span", t, c);
    nodo("strong", String(v), c);
    if (nota) nodo("small", nota, c);
  }
  function recuentos(id, lista) {
    const p = $(id);
    p.replaceChildren();
    for (const [t, v] of lista) {
      const d = nodo("div", undefined, p);
      d.className = "dash-recuento";
      nodo("span", t, d);
      nodo("strong", String(v), d);
    }
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
    $("dash-pruebas").textContent =
      `Resumen de pedidos reales. Se excluyen ${x.pruebasExcluidas?.pedidosMes || 0} pedidos de prueba en este mes (${unidades(x.pruebasExcluidas?.cantidadesMes)}). Las pruebas se conservan en pedidos e historial. Las existencias siguen mostrando los saldos registrados; esta clasificación no corrige el inventario físico.`;
    const m = x.mesResumen,
      t = x.total,
      p = $("dash-cifras");
    p.replaceChildren();
    tarjeta(
      p,
      "Pedidos reales del mes",
      cantidad(m.registrados),
      "Incluye cancelados; cada pedido una vez",
    );
    tarjeta(
      p,
      "Pedidos vigentes del mes",
      cantidad(m.vigentes),
      "Excluye cancelados",
    );
    tarjeta(
      p,
      "Pedidos cancelados del mes",
      cantidad(m.cancelados),
      "Creados en el mes y actualmente cancelados",
    );
    tarjeta(
      p,
      "Entregas confirmadas en el mes",
      cantidad(m.entregas),
      "Según fecha real de confirmación",
    );
    tarjeta(p, "Lotes producidos en el mes", cantidad(m.lotes));
    tarjeta(
      p,
      "Ventas / salidas en el mes",
      cantidad(m.ventasSalidas),
      "Registros de salida; no importe de dinero",
    );
    const q = $("dash-cantidades");
    q.replaceChildren();
    tarjeta(
      q,
      "Cantidad solicitada del mes",
      unidades(m.solicitado),
      "Pedidos vigentes, por unidad",
    );
    tarjeta(q, "Cantidad entregada del mes", unidades(m.entregado));
    tarjeta(q, "Cantidad producida del mes", unidades(m.producido));
    tarjeta(q, "Cantidad vendida / retirada", unidades(m.vendido));
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
    const max = Math.max(1, ...x.dias.map((a) => a.vigentes));
    const diasConActividad = x.dias.filter((a) => a.vigentes > 0);
    if (!diasConActividad.length)
      nodo("p", "Sin pedidos vigentes en este mes.", dias).className = "nota";
    for (const a of diasConActividad) {
      const f = nodo("div", undefined, dias);
      f.className = "dash-barra";
      nodo("span", a.dia.slice(8), f);
      const meter = nodo("meter", undefined, f);
      meter.min = 0;
      meter.max = max;
      meter.value = a.vigentes;
      meter.setAttribute(
        "aria-label",
        a.dia + ": " + a.vigentes + " pedidos vigentes",
      );
      nodo("strong", String(a.vigentes), f);
    }
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
    tarjeta(inv, "Terminado en producción", unidades(t.stockProduccion));
    tarjeta(inv, "Reservado en producción", unidades(t.reservado));
    tarjeta(inv, "Disponible en producción", unidades(t.disponible));
    tarjeta(
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
