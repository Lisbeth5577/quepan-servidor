"use strict";
// Frontend de la plantilla adaptado a las mismas operaciones REST del Android.
const $ = (id) => document.getElementById(id);
const API_KEY = "AIzaSyAyK87A9hF5j3s6pY_Zcp2s3zO-Itk-GAc"; // Identificador publico Firebase, no credencial administrativa.
let sesion = null,
  perfil = null,
  modulo = "productos",
  ocupado = false;
let datos = [],
  catalogos = {},
  accion = "",
  pedidoActual = "",
  pendiente = null;
const nombres = {
  productos: "Productos",
  ingredientes: "Ingredientes",
  recetas: "Recetas",
  pedidos: "Pedidos y entregas",
  producciones: "Producción",
  movimientos: "Entradas",
  sucursales: "Sucursales",
  incidencias: "Incidencias de ruta",
  alertas: "Alertas de existencia",
  notificaciones: "Avisos",
  reportes: "Reportes diarios",
};
const hoy = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guatemala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const gerente = () => perfil?.rol === "GERENTE";
function mensaje(texto, error = false) {
  $("mensaje").textContent = texto;
  $("mensaje").className = error ? "error" : "exito";
}
function nodo(tag, texto, contenedor) {
  const e = document.createElement(tag);
  if (texto !== undefined) e.textContent = texto;
  if (contenedor) contenedor.append(e);
  return e;
}
function boton(texto, fn, contenedor) {
  const e = nodo("button", texto, contenedor);
  e.type = "button";
  e.addEventListener("click", fn);
  return e;
}
function nombre(c, id) {
  return (catalogos[c] || []).find((x) => x.id === id)?.nombre || id || "";
}
function hora(fecha) {
  return fecha
    ? new Date(fecha).toLocaleString("es-GT", { timeZone: "America/Guatemala" })
    : "";
}
async function token() {
  if (!sesion) throw Error("Inicia sesión");
  if (Date.now() > sesion.vence) {
    const r = await fetch(
      "https://securetoken.googleapis.com/v1/token?key=" + API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: sesion.refresh,
        }),
      },
    );
    const x = await r.json();
    if (!r.ok)
      throw Error("La sesión venció. Cierra sesión e ingresa otra vez.");
    sesion = {
      id: x.id_token,
      refresh: x.refresh_token,
      vence: Date.now() + Number(x.expires_in) * 1000 - 60000,
    };
  }
  return sesion.id;
}
async function api(ruta, opciones = {}) {
  const r = await fetch(ruta, {
    ...opciones,
    headers: {
      ...opciones.headers,
      Authorization: "Bearer " + (await token()),
    },
    signal: AbortSignal.timeout(90000),
  });
  const x = await r.json();
  if (!r.ok) {
    const e = Error(x.error?.message || "No se completó la operación");
    e.http = r.status;
    throw e;
  }
  return x;
}
$("login").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (ocupado) return;
  ocupado = true;
  mensaje("Iniciando sesión…");
  const clave = $("clave").value;
  $("clave").value = "";
  try {
    const r = await fetch(
      "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" +
        API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: $("correo").value.trim(),
          password: clave,
          returnSecureToken: true,
        }),
      },
    );
    const x = await r.json();
    if (!r.ok)
      throw Error(
        "No se pudo iniciar sesión. Revisa el correo y la contraseña de tu cuenta asignada.",
      );
    // Sesion solo en memoria; la contraseña no se guarda ni se envia a nuestro servidor.
    sesion = {
      id: x.idToken,
      refresh: x.refreshToken,
      vence: Date.now() + Number(x.expiresIn) * 1000 - 60000,
    };
    perfil = await api("/api/perfil");
    $("usuario").textContent = perfil.nombre + " · " + perfil.rol;
    try {
      const guardado = JSON.parse(
        sessionStorage.getItem("sipropanPendiente") || "null",
      );
      pendiente = guardado?.uid === perfil.uid ? guardado.datos : null;
    } catch {
      pendiente = null;
    }
    $("reintentar").hidden = !pendiente;
    $("acceso").hidden = true;
    $("aplicacion").hidden = false;
    $("modulos").replaceChildren();
    for (const [id, texto] of Object.entries(nombres))
      if (
        gerente() ||
        ["productos", "pedidos", "sucursales", "incidencias"].includes(id)
      )
        boton(texto, () => abrir(id), $("modulos"));
    await cargarCatalogos();
    await abrir("productos");
  } catch (err) {
    sesion = null;
    perfil = null;
    $("acceso").hidden = false;
    $("aplicacion").hidden = true;
    mensaje(err.message, true);
  } finally {
    ocupado = false;
  }
});
$("salir").addEventListener("click", () => {
  sesion = null;
  perfil = null;
  catalogos = {};
  datos = [];
  pendiente = null;
  $("filas").replaceChildren();
  $("aplicacion").hidden = true;
  $("acceso").hidden = false;
  mensaje("Sesión cerrada.");
});
async function cargarCatalogos() {
  const listas = [
    "productos",
    "sucursales",
    ...(gerente() ? ["ingredientes", "usuarios", "recetas"] : []),
  ];
  await Promise.all(
    listas.map(async (c) => {
      catalogos[c] = (await api("/api/datos?modulo=" + c)).filas;
    }),
  );
}
async function abrir(id) {
  modulo = id;
  datos = [];
  $("columnas").replaceChildren();
  $("filas").replaceChildren();
  $("resumen").textContent = "";
  $("titulo").textContent = nombres[id];
  $("captura").hidden = true;
  $("buscar").value = "";
  $("reporte").hidden = id !== "reportes";
  $("tabla").hidden = id === "reportes";
  $("nuevo").hidden = !(
    id === "pedidos" ||
    (gerente() && ["producciones", "movimientos"].includes(id))
  );
  $("nuevo").textContent =
    id === "pedidos"
      ? "Nuevo pedido"
      : id === "producciones"
        ? "Registrar producción"
        : "Entrada de ingrediente";
  for (const b of $("modulos").children)
    b.classList.toggle("activo", b.textContent === nombres[id]);
  if (id === "reportes") {
    $("fecha-reporte").value = hoy();
    mensaje("Elige la fecha y el tipo de listado.");
    return;
  }
  try {
    mensaje("Consultando…");
    const resultado = await api("/api/datos?modulo=" + id);
    if (modulo !== id) return; // Una respuesta anterior no sustituye el modulo actual.
    datos = resultado.filas;
    pintar();
    mensaje("Información actualizada.");
  } catch (e) {
    if (modulo !== id) return;
    datos = [];
    pintar();
    mensaje(e.message, true);
  }
}
const columnas = {
  productos: [
    ["Producto", (x) => x.nombre],
    ["Existencia", (x) => x.existencia],
    ["Mínimo", (x) => x.minimo],
    ["Unidad", (x) => x.unidad],
  ],
  ingredientes: [
    ["Ingrediente", (x) => x.nombre],
    ["Existencia", (x) => x.existencia],
    ["Mínimo", (x) => x.minimo],
    ["Unidad", (x) => x.unidad],
  ],
  sucursales: [
    ["Sucursal", (x) => x.nombre],
    ["Activa", (x) => (x.activo ? "Sí" : "No")],
  ],
  pedidos: [
    ["Pedido", (x) => x.id],
    ["Sucursal", (x) => nombre("sucursales", x.sucursalId)],
    ["Programado", (x) => x.fechaEntrega],
    ["Estado", (x) => x.estado],
    [
      "Productos",
      (x) =>
        (x.detalles || [])
          .map((l) => nombre("productos", l.productoId) + ": " + l.cantidad)
          .join("\n"),
    ],
    ["Unidad / ruta", (x) => [x.unidad, x.ruta].filter(Boolean).join(" / ")],
    ["Registrado", (x) => hora(x.creado)],
    ["Entregado", (x) => hora(x.entregado)],
  ],
  recetas: [
    ["Producto", (x) => nombre("productos", x.id)],
    ["Receta", (x) => x.nombre],
    ["Rendimiento", (x) => x.rendimiento],
    [
      "Ingredientes",
      (x) =>
        (x.ingredientes || [])
          .map(
            (l) =>
              nombre("ingredientes", l.ingredienteId) +
              ": " +
              l.cantidad +
              " " +
              ((catalogos.ingredientes || []).find(
                (i) => i.id === l.ingredienteId,
              )?.unidad || ""),
          )
          .join("\n"),
    ],
    ["Tipo", (x) => (x.academica ? "Académica de demostración" : "Registrada")],
  ],
  producciones: [
    ["Fecha", (x) => hora(x.creado)],
    ["Producto", (x) => nombre("productos", x.productoId)],
    ["Cantidad", (x) => x.cantidad],
    ["Estado", (x) => x.estado],
    [
      "Consumos",
      (x) =>
        (x.consumos || [])
          .map(
            (l) => nombre("ingredientes", l.ingredienteId) + ": " + l.cantidad,
          )
          .join("\n"),
    ],
  ],
  movimientos: [
    ["Fecha", (x) => hora(x.creado)],
    ["Ingrediente", (x) => nombre("ingredientes", x.ingredienteId)],
    ["Cantidad", (x) => x.cantidad],
    ["Tipo", (x) => x.tipo],
  ],
  incidencias: [
    ["Pedido", (x) => x.pedidoId],
    ["Problema", (x) => x.detalle],
    ["Estado", (x) => x.estado],
    ["Reportado", (x) => hora(x.creado)],
    ["Atendido", (x) => hora(x.resuelto)],
    ["Nueva unidad", (x) => x.nuevaUnidad],
  ],
  alertas: [
    ["Producto", (x) => x.nombre],
    ["Existencia", (x) => x.existencia],
    ["Mínimo", (x) => x.minimo],
    ["Alerta activa", (x) => (x.activa ? "Sí" : "No")],
    ["Actualizado", (x) => hora(x.actualizado)],
  ],
  notificaciones: [
    ["Aviso", (x) => x.titulo],
    ["Mensaje", (x) => x.mensaje],
    ["Estado de envío", (x) => x.estado],
    ["Enviados", (x) => x.enviados || 0],
    ["Fallos", (x) => x.fallos || 0],
    ["Fecha", (x) => hora(x.creado)],
  ],
};
function pintar() {
  const cols = columnas[modulo];
  if (!cols) return;
  const filtro = $("buscar").value.toLocaleLowerCase();
  const lista = datos.filter((x) =>
    cols
      .map((c) => c[1](x))
      .join(" ")
      .toLocaleLowerCase()
      .includes(filtro),
  );
  lista.sort(
    (a, b) =>
      String(b.creado || b.actualizado || "").localeCompare(
        String(a.creado || a.actualizado || ""),
      ) || String(a.nombre || a.id).localeCompare(String(b.nombre || b.id)),
  );
  $("columnas").replaceChildren();
  $("filas").replaceChildren();
  const head = nodo("tr", undefined, $("columnas"));
  cols.forEach((c) => nodo("th", c[0], head));
  if (modulo === "pedidos") nodo("th", "Acciones", head);
  for (const x of lista) {
    const tr = nodo("tr", undefined, $("filas"));
    cols.forEach((c) => {
      const td = nodo("td", c[1](x) ?? "", tr);
      td.className = "detalle-texto";
    });
    if (modulo === "pedidos") {
      const td = nodo("td", undefined, tr);
      if (gerente() && x.estado === "PENDIENTE")
        boton("Despachar", () => formulario("despachar", x.id), td);
      if (gerente() && x.estado === "INCIDENCIA")
        boton("Asignar otra unidad", () => formulario("reasignar", x.id), td);
      if (x.estado === "EN_RUTA") {
        boton("Confirmar entrega", () => formulario("entregar", x.id), td);
        boton("Reportar problema", () => formulario("incidencia", x.id), td);
      }
    }
  }
  $("resumen").textContent =
    lista.length +
    " registros. " +
    (lista.length ? "" : "No hay registros para este listado.");
}
function campo(id, titulo, tipo = "text", opciones) {
  const lab = nodo("label", titulo, $("campos"));
  let e;
  if (opciones) {
    e = nodo("select", undefined, lab);
    opciones.forEach((x) => {
      const o = nodo("option", x.nombre, e);
      o.value = x.id;
    });
  } else {
    e = nodo(tipo === "textarea" ? "textarea" : "input", undefined, lab);
    if (tipo !== "textarea") e.type = tipo;
  }
  e.id = id;
  e.required = true;
  if (tipo === "number") {
    e.min = "0.01";
    e.max = "1000000";
    e.step = "0.01";
  }
  if (tipo === "text" || tipo === "textarea")
    e.maxLength = tipo === "textarea" ? 500 : 60;
  return e;
}
function detalle() {
  const row = nodo("div", undefined, $("detalles"));
  row.className = "detalle";
  const sel = nodo("select", undefined, row);
  sel.required = true;
  sel.setAttribute("aria-label", "Producto");
  (catalogos.productos || [])
    .filter((x) => x.activo && !x.nombre.startsWith("PRUEBA ACADEMICA"))
    .forEach((p) => {
      const o = nodo("option", p.nombre, sel);
      o.value = p.id;
    });
  const q = nodo("input", undefined, row);
  q.type = "number";
  q.required = true;
  q.min = "0.01";
  q.step = "0.01";
  q.max = "1000000";
  q.value = "1";
  q.setAttribute("aria-label", "Cantidad");
  boton("Quitar", () => row.remove(), row);
}
function formulario(a, id = "") {
  if (ocupado || pendiente) {
    mensaje(
      "Completa o reintenta la solicitud pendiente antes de iniciar otra.",
      true,
    );
    return;
  }
  accion = a;
  pedidoActual = id;
  $("captura").hidden = false;
  $("campos").replaceChildren();
  $("detalles").replaceChildren();
  $("agregar").hidden = a !== "crearPedido";
  const titulos = {
    crearPedido: "Nuevo pedido",
    producir: "Registrar producción",
    entrada: "Entrada de ingrediente",
    despachar: "Despachar pedido",
    reasignar: "Asignar otra unidad",
    entregar: "Confirmar entrega",
    incidencia: "Reportar problema en ruta",
  };
  $("titulo-formulario").textContent = titulos[a] + (id ? " · " + id : "");
  if (a === "crearPedido") {
    campo(
      "sucursal",
      "Sucursal",
      "text",
      (catalogos.sucursales || []).filter((s) => s.activo),
    );
    const f = campo("fecha", "Fecha de entrega", "date");
    f.value = hoy();
    f.min = hoy();
    detalle();
  }
  if (a === "producir") {
    const producto = campo(
      "producto",
      "Producto",
      "text",
      (catalogos.productos || []).filter(
        (p) => p.activo && (catalogos.recetas || []).some((r) => r.id === p.id),
      ),
    );
    const cantidad = campo("cantidad", "Unidades a producir", "number");
    const sugerirLote = () => {
      cantidad.value =
        (catalogos.recetas || []).find((r) => r.id === producto.value)
          ?.rendimiento || "";
    };
    producto.addEventListener("change", sugerirLote);
    sugerirLote();
    nodo(
      "p",
      "Se propone el lote de la receta para conservar la precisión de los ingredientes. Puedes ajustar la cantidad; el servidor valida el consumo y las existencias.",
      $("campos"),
    );
  }
  if (a === "entrada") {
    campo(
      "ingrediente",
      "Ingrediente (respetar su unidad)",
      "text",
      (catalogos.ingredientes || [])
        .filter((x) => x.activo)
        .map((x) => ({ id: x.id, nombre: x.nombre + " · " + x.unidad })),
    );
    campo("cantidad", "Cantidad recibida", "number");
  }
  if (["despachar", "reasignar"].includes(a)) {
    campo(
      "vendedor",
      "Vendedor",
      "text",
      (catalogos.usuarios || []).filter(
        (x) => x.activo && x.rol === "VENDEDOR",
      ),
    );
    campo("unidad", "Unidad del vehículo");
    if (a === "despachar") campo("ruta", "Ruta");
  }
  if (a === "incidencia") campo("problema", "Describe el problema", "textarea");
  if (a === "entregar")
    nodo(
      "p",
      "Confirma únicamente si el pedido fue entregado a la sucursal.",
      $("campos"),
    );
  $("captura").scrollIntoView({ behavior: "smooth", block: "start" });
}
async function guardar() {
  if (ocupado || !pendiente) return;
  ocupado = true;
  $("reintentar").hidden = true;
  mensaje("Guardando… espera la confirmación.");
  try {
    const r = await api("/operacion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: pendiente }),
    });
    pendiente = null;
    sessionStorage.removeItem("sipropanPendiente");
    $("captura").hidden = true;
    await cargarCatalogos();
    await abrir(modulo);
    mensaje(r.result.mensaje);
  } catch (e) {
    if (e.http >= 400 && e.http < 500) {
      pendiente = null;
      sessionStorage.removeItem("sipropanPendiente");
    } else $("reintentar").hidden = false;
    mensaje(
      e.message +
        (pendiente
          ? " Si no hubo confirmación, reintenta la MISMA solicitud para evitar duplicados."
          : ""),
      true,
    );
  } finally {
    ocupado = false;
  }
}
$("registro").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (ocupado || pendiente) return;
  const a = { accion, solicitudId: crypto.randomUUID() };
  if (pedidoActual) a.pedidoId = pedidoActual;
  if (accion === "crearPedido") {
    a.sucursalId = $("sucursal").value;
    a.fechaEntrega = $("fecha").value;
    a.detalles = [...$("detalles").children].map((r) => ({
      productoId: r.querySelector("select").value,
      cantidad: Number(r.querySelector("input").value),
    }));
    if (!a.detalles.length) {
      mensaje("Agrega al menos un producto.", true);
      return;
    }
  }
  if (accion === "producir") {
    a.productoId = $("producto").value;
    a.cantidad = Number($("cantidad").value);
  }
  if (accion === "entrada") {
    a.ingredienteId = $("ingrediente").value;
    a.cantidad = Number($("cantidad").value);
  }
  if (["despachar", "reasignar"].includes(accion)) {
    a.vendedorUid = $("vendedor").value;
    a.unidad = $("unidad").value.trim();
    if (accion === "despachar") a.ruta = $("ruta").value.trim();
  }
  if (accion === "incidencia") a.detalle = $("problema").value.trim();
  pendiente = a;
  sessionStorage.setItem(
    "sipropanPendiente",
    JSON.stringify({ uid: perfil.uid, datos: a }),
  );
  await guardar();
});
$("descargar").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (ocupado) return;
  ocupado = true;
  mensaje("Preparando listado…");
  try {
    const tipo = $("tipo-reporte").value,
      fecha = $("fecha-reporte").value;
    const r = await fetch(
      "/reportes/diario.csv?fecha=" +
        encodeURIComponent(fecha) +
        "&tipo=" +
        tipo,
      {
        headers: { Authorization: "Bearer " + (await token()) },
        signal: AbortSignal.timeout(90000),
      },
    );
    if (!r.ok) {
      const x = await r.json();
      throw Error(x.error?.message || "No se pudo descargar");
    }
    const blob = await r.blob(),
      url = URL.createObjectURL(blob);
    const a = nodo("a");
    a.href = url;
    a.download = "SIPROPAN_" + tipo + "_" + fecha + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    mensaje("Descarga preparada. Revisa las descargas del navegador.");
  } catch (e) {
    mensaje(e.message, true);
  } finally {
    ocupado = false;
  }
});
$("nuevo").addEventListener("click", () =>
  formulario(
    modulo === "pedidos"
      ? "crearPedido"
      : modulo === "producciones"
        ? "producir"
        : "entrada",
  ),
);
$("agregar").addEventListener("click", detalle);
$("cancelar").addEventListener("click", () => {
  $("captura").hidden = true;
});
$("buscar").addEventListener("input", pintar);
$("actualizar").addEventListener("click", async () => {
  if (!ocupado) {
    await cargarCatalogos();
    await abrir(modulo);
  }
});
$("reintentar").addEventListener("click", guardar);
