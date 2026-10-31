"use strict";
// Una interfaz compartida por navegador y APK; el servidor valida cada operación.
const $ = (id) => document.getElementById(id);
const API_KEY = "AIzaSyAyK87A9hF5j3s6pY_Zcp2s3zO-Itk-GAc";
let sesion = null,
  perfil = null,
  modulo = "productos",
  datos = [],
  catalogos = {},
  ocupado = false,
  pendiente = null,
  accion = "",
  registroId = "",
  coleccionActual = "",
  editing = null,
  lineasTipo = "productos",
  stream = null,
  refreshTimer;
const nombres = {
  dashboard: "Resumen general",
  solicitudes_produccion: "Solicitudes de producción",
  descuentos: "Descuentos",
  productos: "Productos",
  pedidos: "Pedidos y entregas",
  inventario_sucursales: "Inventario por sucursal",
  salidas_sucursales: "Ventas y salidas",
  producciones: "Producción",
  ingredientes: "Ingredientes",
  recetas: "Recetas",
  movimientos: "Entradas",
  sucursales: "Sucursales",
  usuarios: "Personal",
  incidencias: "Incidencias de ruta",
  reportes: "Reportes diarios",
  alertas: "Alertas de producción",
  notificaciones: "Notificaciones",
};
// null es precio pendiente. Se muestran quetzales sin confundir vacío con cero.
function quetzales(centavos) {
  return centavos == null
    ? "Pendiente de precio"
    : "Q " + (centavos / 100).toFixed(2);
}
function precioCatalogo(valor) {
  return valor == null
    ? "Pendiente de precio"
    : quetzales(Math.round(valor * 100));
}
const gerente = () => perfil?.rol === "GERENTE";
const repartidor = () => perfil?.rol === "REPARTIDOR";
const tituloModulo = (m) =>
  repartidor()
    ? {
        pedidos: "Mis entregas asignadas",
        incidencias: "Mis incidencias de ruta",
      }[m] || nombres[m]
    : nombres[m];
const hoy = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guatemala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function mensaje(s, error = false) {
  $("mensaje").textContent = s;
  $("mensaje").className = error ? "error" : "exito";
}
// Crea un elemento HTML y escribe texto sin interpretarlo como código.
function nodo(tag, texto, parent) {
  const e = document.createElement(tag);
  if (texto !== undefined) e.textContent = texto;
  if (parent) parent.append(e);
  return e;
}
function boton(s, fn, p, clase = "") {
  const b = nodo("button", s, p);
  b.type = "button";
  b.className = clase;
  b.onclick = fn;
  return b;
}
function nombre(c, id) {
  return (catalogos[c] || []).find((x) => x.id === id)?.nombre || id || "";
}
function hora(v) {
  return v
    ? new Date(v).toLocaleString("es-GT", { timeZone: "America/Guatemala" })
    : "";
}
function numero(p) {
  return p.numero || p.id;
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
    if (!r.ok) throw Error("Sesión vencida. Ingresa nuevamente.");
    sesion = {
      id: x.id_token,
      refresh: x.refresh_token,
      vence: Date.now() + Number(x.expires_in) * 1000 - 60000,
    };
  }
  return sesion.id;
}
// Envía una consulta al servidor con la credencial de la sesión.
async function api(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { ...opts.headers, Authorization: "Bearer " + (await token()) },
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
// Al enviar el formulario de acceso se comprueba la cuenta.
$("login").onsubmit = async (e) => {
  e.preventDefault();
  if (ocupado) return;
  ocupado = true;
  mensaje("Iniciando sesión…");
  const pass = $("clave").value;
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
          password: pass,
          returnSecureToken: true,
        }),
        signal: AbortSignal.timeout(90000),
      },
    );
    const x = await r.json();
    if (!r.ok) throw Error("Revisa el correo y la contraseña de tu cuenta.");
    sesion = {
      id: x.idToken,
      refresh: x.refreshToken,
      vence: Date.now() + Number(x.expiresIn) * 1000 - 60000,
    };
    perfil = await api("/api/perfil");
    try {
      const x = JSON.parse(sessionStorage.getItem("quepanPendiente") || "null");
      pendiente = x?.uid === perfil.uid ? x.datos : null;
    } catch {
      pendiente = null;
    }
    $("usuario").textContent =
      perfil.nombre +
      " · " +
      (gerente()
        ? "Gerente"
        : repartidor()
          ? "Repartidor"
          : nombre("sucursales", perfil.sucursalId));
    $("acceso").hidden = true;
    document.body.classList.remove("login-abierto");
    $("aplicacion").hidden = false;
    $("reintentar").hidden = !pendiente;
    $("modulos").replaceChildren();
    for (const [m, s] of Object.entries(nombres))
      if (
        gerente() ||
        (repartidor()
          ? ["pedidos", "incidencias", "notificaciones"].includes(m)
          : [
              "descuentos",
              "productos",
              "pedidos",
              "inventario_sucursales",
              "salidas_sucursales",
              "sucursales",
              "incidencias",
              "reportes",
              "notificaciones",
            ].includes(m))
      )
        boton(tituloModulo(m), () => abrir(m), $("modulos"));
    $("avisos").hidden = !window.QuePanAndroid;
    await cargarCatalogos();
    await abrir(
      gerente() ? "dashboard" : repartidor() ? "pedidos" : "productos",
    );
    AvisosWeb.reiniciar();
    await AvisosWeb.actualizar();
    conectar();
  } catch (err) {
    sesion = null;
    perfil = null;
    mensaje(err.message, true);
  } finally {
    ocupado = false;
  }
};
$("salir").onclick = () => {
  AvisosWeb.reiniciar();
  stream?.abort();
  stream = null;
  sesion = null;
  perfil = null;
  datos = [];
  catalogos = {};
  pendiente = null;
  $("aplicacion").hidden = true;
  $("acceso").hidden = false;
  document.body.classList.add("login-abierto");
  $("filas").replaceChildren();
  if (window.QuePanAndroid) window.QuePanAndroid.cerrarSesion();
  mensaje("Sesión cerrada.");
};
async function cargarCatalogos() {
  if (repartidor()) {
    catalogos = {};
    return;
  }
  const cs = [
    "productos",
    "sucursales",
    ...(!repartidor() ? ["inventario_sucursales"] : []),
    ...(gerente() ? ["ingredientes", "usuarios", "recetas"] : []),
  ];
  await Promise.all(
    cs.map(async (c) => {
      catalogos[c] = (await api("/api/datos?modulo=" + c)).filas;
    }),
  );
}
let refrescando = false;
async function refrescarSilencioso() {
  if (!perfil || refrescando || ocupado) return;
  refrescando = true;
  try {
    await cargarCatalogos();
    if (modulo === "dashboard") {
      await Dashboard.cargar(true);
    } else if (modulo !== "reportes") {
      datos = (await api("/api/datos?modulo=" + modulo)).filas;
      pintar();
    }
    actualizarLimites();
    if (accion === "producir" && !$("captura").hidden) vistaConsumo();
    $("conexion").textContent =
      "● Disponibilidad actualizada · " +
      new Date().toLocaleTimeString("es-GT");
  } catch {
    $("conexion").textContent =
      "Sin actualización. Revisa internet; al guardar se valida el stock.";
  } finally {
    refrescando = false;
  }
}
async function conectar() {
  stream?.abort();
  const controller = new AbortController();
  stream = controller;
  try {
    const r = await fetch("/api/eventos", {
      headers: { Authorization: "Bearer " + (await token()) },
      signal: controller.signal,
    });
    if (!r.ok) throw Error("Conexión interrumpida");
    $("conexion").textContent = "● Conectado en tiempo real";
    const reader = r.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "";
    while (perfil) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let i;
      while ((i = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (event.includes("event: actualizar")) {
          AvisosWeb.actualizar();
          clearTimeout(refreshTimer);
          refreshTimer = setTimeout(refrescarSilencioso, 300);
        }
      }
    }
  } catch (e) {
    if (e.name === "AbortError") return;
    $("conexion").textContent = "Reconectando disponibilidad…";
  }
  if (perfil && stream === controller) setTimeout(conectar, 3000);
}
// Cambia la sección visible y pide sus datos al servidor.
async function abrir(m) {
  modulo = m;
  datos = [];
  for (const id of ["f-sucursal", "f-producto", "f-ruta", "f-estado"])
    $(id).value = "";
  editing = null;
  $("titulo").textContent = tituloModulo(m);
  $("ayuda").textContent = "";
  $("ayuda").hidden = true;
  $("captura").hidden = true;
  $("reporte").hidden = m !== "reportes";
  $("tabla").hidden = ["reportes", "dashboard"].includes(m);
  $("dashboard").hidden = m !== "dashboard";
  $("filtros-avisos").hidden = m !== "notificaciones";
  $("paginas-avisos").hidden = m !== "notificaciones";
  paginaAvisos = 1;
  $("buscar").value = "";
  $("indicadores").replaceChildren();
  for (const b of $("modulos").children)
    b.classList.toggle("activo", b.textContent === tituloModulo(m));
  const alta = {
    pedidos: "Nuevo pedido",
    solicitudes_produccion: "Solicitar producción",
    producciones: "Registrar producción",
    movimientos: "Registrar entrada",
    productos: "Agregar producto",
    ingredientes: "Agregar ingrediente",
    recetas: "Agregar receta",
    sucursales: "Agregar sucursal",
  };
  $("nuevo").hidden =
    repartidor() || !(alta[m] && (m === "pedidos" || gerente()));
  $("nuevo").textContent = alta[m] || "";
  if (m === "dashboard") {
    await Dashboard.cargar();
    return;
  }
  if (m === "reportes") {
    $("fecha-reporte").value = hoy();
    mensaje("");
    return;
  }
  try {
    mensaje("Consultando…");
    const x = await api("/api/datos?modulo=" + m);
    if (modulo !== m) return;
    datos = x.filas;
    prepararFiltros();
    pintar();
    mensaje("");
  } catch (e) {
    mensaje(e.message, true);
  }
}
// Encabezados y valores que se mostrarán en cada tabla.
const cols = {
  solicitudes_produccion: [
    ["Fecha", (x) => hora(x.creado)],
    ["Producto", (x) => x.productoNombre],
    ["Cantidad", (x) => x.cantidad],
    ["Estado", (x) => x.estado],
    ["Comentarios", (x) => x.comentarios],
    ["Autorizó", (x) => nombre("usuarios", x.autorizadoPor)],
    ["Lote finalizado", (x) => x.loteId || ""],
  ],
  descuentos: [
    ["Sucursal", (x) => nombre("sucursales", x.sucursalId)],
    ["Producto", (x) => nombre("productos", x.productoId)],
    ["Precio con descuento", (x) => quetzales(x.precioUnitarioCentavos)],
    ["Unidades restantes", (x) => x.restante],
    ["Vence", (x) => hora(x.vigenteHasta)],
    [
      "Estado",
      (x) =>
        !x.activo
          ? "Cancelado"
          : new Date(x.vigenteHasta) <= new Date()
            ? "Vencido"
            : x.restante <= 0
              ? "Agotado"
              : "Vigente",
    ],
    ["Motivo", (x) => x.motivo],
  ],
  productos: [
    ["Código", (x) => x.codigo],
    ["Producto", (x) => x.nombre],
    ["Precio de venta", (x) => precioCatalogo(x.precioVenta)],
    ["Existencia", (x) => x.existencia],
    ["Reservado", (x) => x.reservado || 0],
    ["Disponible", (x) => x.disponible],
    ["Unidad", (x) => x.unidad],
    ["Mínimo", (x) => x.minimo],
  ],
  ingredientes: [
    ["Código", (x) => x.codigo],
    ["Ingrediente", (x) => x.nombre],
    ["Costo por unidad de medida", (x) => precioCatalogo(x.costoUnitario)],
    ["Existencia", (x) => x.existencia],
    ["Unidad", (x) => x.unidad],
    ["Mínimo", (x) => x.minimo],
  ],
  sucursales: [
    ["Sucursal", (x) => x.nombre],
    ["Prefijo de pedidos", (x) => x.prefijo],
    ["Dirección", (x) => x.direccion || "Pendiente de registrar"],
  ],
  usuarios: [
    ["Vendedor", (x) => x.nombre],
    ["Rol", (x) => x.rol],
    ["Sucursal", (x) => nombre("sucursales", x.sucursalId)],
    ["Activo", (x) => (x.activo ? "Sí" : "No")],
  ],
  pedidos: [
    ["Registro", (x) => (x.esPrueba === true ? "Prueba" : "Real")],
    ["Pedido", numero],
    ["Total del pedido", (x) => quetzales(x.totalCentavos)],
    ["Sucursal", (x) => x.sucursalNombre || nombre("sucursales", x.sucursalId)],
    ["Origen", (x) => x.origenNombre || "Producción central"],
    ["Recibir el", (x) => x.fechaEntrega],
    ["Estado", (x) => x.estado],
    ["Autorización", (x) => x.autorizacion || "Registro anterior"],
    [
      "Productos",
      (x) =>
        (x.detalles || [])
          .map(
            (l) =>
              (l.codigo || nombre("productos", l.productoId)) +
              " · " +
              (l.nombre || nombre("productos", l.productoId)) +
              ": " +
              l.cantidad,
          )
          .join("\n"),
    ],
    ["Repartidor", (x) => x.repartidorNombre || "Sin asignar"],
    ["Ruta / unidad", (x) => [x.ruta, x.unidad].filter(Boolean).join(" / ")],
    ["Comentarios", (x) => x.comentarios || ""],
    ["Registrado", (x) => hora(x.creado)],
  ],
  inventario_sucursales: [
    ["Sucursal", (x) => x.sucursalNombre],
    ["Código", (x) => x.codigo],
    ["Producto", (x) => x.productoNombre],
    ["Existencia", (x) => x.existencia],
    ["Reservado", (x) => x.reservado || 0],
    ["Disponible", (x) => x.disponible],
    ["Alerta", (x) => (x.sinConteo ? "Realizar conteo inicial" : x.alerta)],
  ],
  salidas_sucursales: [
    ["Fecha", (x) => hora(x.creado)],
    ["Sucursal", (x) => nombre("sucursales", x.sucursalId)],
    ["Producto", (x) => nombre("productos", x.productoId)],
    [
      "Tipo",
      (x) =>
        x.tipo === "ventaSucursal" ? "Venta / salida" : "Conteo de existencia",
    ],
    ["Cantidad", (x) => x.cantidad],
    ["Existencia final", (x) => x.existencia],
    ["Movimiento", (x) => x.tipoMovimiento || "Antiguo sin clasificar"],
    [
      "Importe de venta",
      (x) =>
        x.tipoMovimiento === "salida" || x.tipo === "ajustarSucursal"
          ? "No es venta"
          : quetzales(x.importeCentavos),
    ],
    ["Motivo", (x) => x.motivo],
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
            (l) => nombre("ingredientes", l.ingredienteId) + ": " + l.cantidad,
          )
          .join("\n"),
    ],
  ],
  producciones: [
    ["Fecha", (x) => hora(x.creado)],
    ["Producto", (x) => nombre("productos", x.productoId)],
    ["Cantidad", (x) => x.cantidad],
    ["Estado", (x) => x.estado],
    ["Costo de materia prima", (x) => quetzales(x.costo?.totalCentavos)],
  ],
  movimientos: [
    ["Fecha", (x) => hora(x.creado)],
    ["Ingrediente", (x) => nombre("ingredientes", x.ingredienteId)],
    ["Cantidad", (x) => x.cantidad],
    ["Tipo", (x) => x.tipo],
  ],
  incidencias: [
    ["Pedido", (x) => x.numero || x.pedidoId],
    ["Sucursal", (x) => x.sucursalNombre || x.sucursalId || "—"],
    ["Problema", (x) => x.detalle],
    ["Estado", (x) => x.estado],
    ["Reportado", (x) => hora(x.creado)],
    ["Atendido", (x) => hora(x.resuelto)],
  ],
  alertas: [
    ["Producto", (x) => x.nombre],
    ["Existencia", (x) => x.existencia],
    ["Mínimo", (x) => x.minimo],
    ["Alerta", (x) => (x.activa ? "Pedir más producto" : "Suficiente")],
  ],
  notificaciones: [
    ["Aviso", (x) => x.titulo],
    ["Mensaje", (x) => x.mensaje],
    ["Estado", (x) => x.estado],
    ["Fecha", (x) => hora(x.creado)],
  ],
};
const columnasReparto = {
  pedidos: [
    ["Pedido", numero],
    ["Entregar en", (x) => x.sucursalNombre],
    ["Dirección de entrega", (x) => x.direccionEntrega],
    ["Fecha de entrega", (x) => x.fechaEntrega],
    [
      "Productos a entregar",
      (x) =>
        (x.detalles || [])
          .map((l) =>
            [
              l.codigo,
              l.nombre || l.productoId,
              l.cantidad + " " + (l.unidad || "UND"),
            ]
              .filter(Boolean)
              .join(" · "),
          )
          .join("\n"),
    ],
    ["Ruta", (x) => x.ruta || ""],
    ["Unidad", (x) => x.unidad || ""],
    [
      "Estado",
      (x) =>
        x.estado === "INCIDENCIA" ? "Esperando atención de Kevin" : x.estado,
    ],
    ["Comentarios de entrega", (x) => x.comentarios || ""],
  ],
  incidencias: [
    ["Pedido", (x) => x.numero || x.pedidoId],
    ["Sucursal", (x) => x.sucursalNombre || x.sucursalId || "—"],
    ["Sucursal de entrega", (x) => x.sucursalNombre],
    ["Problema reportado", (x) => x.detalle],
    [
      "Estado",
      (x) =>
        x.estado === "ABIERTA"
          ? "Pendiente de Kevin"
          : x.estado === "REASIGNADA"
            ? "Reasignación aprobada"
            : x.estado,
    ],
    ["Reportado", (x) => hora(x.creado)],
    ["Atendido", (x) => hora(x.resuelto)],
    ["Unidad asignada", (x) => x.nuevaUnidad || ""],
  ],
};
function opciones(id, rows, primero) {
  const e = $(id),
    prev = e.value;
  e.replaceChildren();
  const o = nodo("option", primero, e);
  o.value = "";
  for (const x of rows) {
    const o = nodo("option", x.nombre, e);
    o.value = x.id;
  }
  e.value = [...e.options].some((o) => o.value === prev) ? prev : "";
}
function prepararFiltros() {
  const aplican = {
    "f-sucursal": [
      "pedidos",
      "inventario_sucursales",
      "salidas_sucursales",
      "sucursales",
      "usuarios",
    ],
    "f-producto": [
      "productos",
      "pedidos",
      "inventario_sucursales",
      "salidas_sucursales",
      "recetas",
      "producciones",
    ],
    "f-ruta": ["pedidos"],
    "f-estado": ["pedidos", "incidencias", "producciones", "notificaciones"],
  };
  for (const [id, ms] of Object.entries(aplican)) {
    $(id).parentElement.hidden = !ms.includes(modulo);
    if (!ms.includes(modulo)) $(id).value = "";
  }
  opciones(
    "f-sucursal",
    repartidor()
      ? [
          ...new Map(
            datos
              .filter((x) => x.sucursalId)
              .map((x) => [
                x.sucursalId,
                { id: x.sucursalId, nombre: x.sucursalNombre },
              ]),
          ).values(),
        ]
      : (catalogos.sucursales || []).map((s) => ({
          id: s.id,
          nombre: s.nombre,
        })),
    "Todas",
  );
  opciones(
    "f-producto",
    repartidor()
      ? [
          ...new Map(
            datos
              .flatMap((x) => x.detalles || [])
              .map((l) => [
                l.productoId,
                { id: l.productoId, nombre: l.nombre || l.productoId },
              ]),
          ).values(),
        ]
      : (catalogos.productos || []).map((p) => ({
          id: p.id,
          nombre: p.nombre,
        })),
    "Todos",
  );
  opciones(
    "f-ruta",
    [...new Set(datos.map((x) => x.ruta).filter(Boolean))].map((x) => ({
      id: x,
      nombre: x,
    })),
    "Todas",
  );
  opciones(
    "f-estado",
    [...new Set(datos.map((x) => x.estado).filter(Boolean))].map((x) => ({
      id: x,
      nombre: x,
    })),
    "Todos",
  );
  if (modulo === "inventario_sucursales" && !gerente())
    $("f-sucursal").value = perfil.sucursalId;
}
let paginaAvisos = 1;
const TAMANO_PAGINA_AVISOS = 50;
function tipoAviso(aviso) {
  const tipo = String(aviso.tipo || "").toUpperCase();
  if (/MATERIA|INGREDIENT/.test(tipo) || aviso.ingredienteId) return "MATERIA_PRIMA";
  if (/INCIDENCIA|RUTA|ASIGNACION|DESPACHO|ENTREGA/.test(tipo)) return "RUTA";
  if (/PEDIDO|SOLICITUD/.test(tipo)) return "PEDIDOS";
  if (/STOCK|PRODUCTO|EXISTENCIA/.test(tipo)) return "PRODUCTOS";
  return "OTROS";
}
function fechaAviso(aviso) {
  const fecha = new Date(aviso.creado);
  if (!Number.isFinite(+fecha)) return "";
  return new Intl.DateTimeFormat("en-CA", {timeZone:"America/Guatemala",year:"numeric",month:"2-digit",day:"2-digit"}).format(fecha);
}
function coincideAviso(aviso, fecha, tipo) {
  return (!fecha || fechaAviso(aviso) === fecha) && (!tipo || tipoAviso(aviso) === tipo);
}
// Recorre los datos y construye las filas de la tabla.
function pintar() {
  const cs = repartidor() && modulo !== "notificaciones" ? columnasReparto[modulo] : cols[modulo];
  if (!cs) return;
  const q = $("buscar").value.toLocaleLowerCase(),
    s = $("f-sucursal").value,
    p = $("f-producto").value,
    r = $("f-ruta").value,
    e = $("f-estado").value;
  const list = datos.filter(
    (x) =>
      (!s || x.sucursalId === s || (modulo === "sucursales" && x.id === s)) &&
      (!p ||
        x.productoId === p ||
        (modulo === "productos" && x.id === p) ||
        (modulo === "recetas" && x.id === p) ||
        x.detalles?.some((l) => l.productoId === p)) &&
      (!r || x.ruta === r) &&
      (!e || x.estado === e) &&
      (modulo !== "notificaciones" || coincideAviso(x, $("fecha-aviso").value, $("tipo-aviso").value)) &&
      cs
        .map((c) => c[1](x))
        .join(" ")
        .toLocaleLowerCase()
        .includes(q),
  );
  list.sort(
    (a, b) =>
      String(b.creado || "").localeCompare(String(a.creado || "")) ||
      String(a.numero || a.codigo || a.nombre || a.id).localeCompare(
        String(b.numero || b.codigo || b.nombre || b.id),
        "es",
        { numeric: true },
      ),
  );
  $("columnas").replaceChildren();
  $("filas").replaceChildren();
  const tr = nodo("tr", undefined, $("columnas"));
  cs.forEach((c) => nodo("th", c[0], tr));
  nodo("th", "Acciones", tr);
  let visibles = list;
  if (modulo === "notificaciones") {
    const paginas = Math.max(1, Math.ceil(list.length / TAMANO_PAGINA_AVISOS));
    paginaAvisos = Math.min(paginaAvisos, paginas);
    visibles = list.slice((paginaAvisos - 1) * TAMANO_PAGINA_AVISOS, paginaAvisos * TAMANO_PAGINA_AVISOS);
    $("aviso-pagina").textContent = "Página " + paginaAvisos + " de " + paginas;
    $("avisos-anterior").disabled = paginaAvisos <= 1;
    $("avisos-siguiente").disabled = paginaAvisos >= paginas;
  }
  for (const x of visibles) {
    const tr = nodo("tr", undefined, $("filas"));
    cs.forEach(([name, fn]) => {
      const td = nodo("td", undefined, tr);
      if (["Estado", "Alerta"].includes(name)) {
        const badge = nodo("span", fn(x), td);
        badge.className =
          "pill" + (/Pedir|conteo|INCIDENCIA/.test(fn(x)) ? " low" : "");
      } else td.textContent = fn(x) ?? "";
    });
    const td = nodo("td", undefined, tr);
    acciones(x, td);
  }
  if (!list.length) {
    const tr = nodo("tr", undefined, $("filas")),
      td = nodo(
        "td",
        repartidor()
          ? "No tienes entregas o incidencias asignadas para estos filtros."
          : "No hay registros para estos filtros.",
        tr,
      );
    td.colSpan = cs.length + 1;
    td.className = "empty";
  }
  $("resumen").textContent = "";
  $("resumen").hidden = true;
  metricas(list);
}
function metricas(list) {
  $("indicadores").replaceChildren();
  let ms = [];
  if (modulo === "productos")
    ms = [
      ["Productos", list.length],
      [
        "Unidades disponibles",
        list.reduce((n, p) => n + (p.disponible || 0), 0),
      ],
      ["Sin disponibilidad", list.filter((x) => x.disponible <= 0).length],
    ];
  if (modulo === "pedidos")
    ms = [
      ["Pendientes", list.filter((x) => x.estado === "PENDIENTE").length],
      ["En ruta", list.filter((x) => x.estado === "EN_RUTA").length],
      ["Entregados", list.filter((x) => x.estado === "ENTREGADO").length],
    ];
  if (modulo === "inventario_sucursales")
    ms = [
      [
        "Productos con una unidad o menos",
        list.filter((x) => x.existencia <= 1 && !x.sinConteo).length,
      ],
      ["Conteos iniciales pendientes", list.filter((x) => x.sinConteo).length],
    ];
  for (const [name, n] of ms) {
    const e = nodo("div", undefined, $("indicadores"));
    e.className = "metric";
    nodo("strong", String(n), e);
    nodo("span", name, e);
  }
}
function acciones(x, td) {
  if (gerente() && modulo === "incidencias" && x.estado === "ABIERTA")
    boton(
      "Atender y reasignar",
      async () => {
        try {
          const pedidos = (await api("/api/datos?modulo=pedidos")).filas;
          const p = pedidos.find((p) => p.id === x.pedidoId);
          if (!p || p.estado !== "INCIDENCIA")
            throw Error("La incidencia ya fue atendida. Actualiza la lista.");
          formulario("reasignar", p);
        } catch (e) {
          mensaje(e.message, true);
        }
      },
      td,
    );
  if (modulo === "solicitudes_produccion" && gerente()) {
    if (x.estado === "PENDIENTE")
      boton(
        "Autorizar",
        () => confirmarComplemento("autorizarProduccion", x),
        td,
      );
    if (x.estado === "APROBADA")
      boton(
        "Finalizar producción",
        () => confirmarComplemento("finalizarSolicitudProduccion", x),
        td,
      );
    if (["PENDIENTE", "APROBADA"].includes(x.estado))
      boton(
        "Cancelar solicitud",
        () => confirmarComplemento("cancelarSolicitudProduccion", x),
        td,
      );
  }
  if (modulo === "descuentos" && gerente() && x.activo)
    boton(
      "Cancelar descuento",
      () => confirmarComplemento("cancelarDescuento", x),
      td,
    );
  if (modulo === "inventario_sucursales" && gerente())
    boton("Autorizar descuento", () => formulario("autorizarDescuento", x), td);
  if (modulo === "pedidos") {
    const propio =
        !repartidor() && (gerente() || x.sucursalId === perfil.sucursalId),
      origen = !repartidor() && (gerente() || x.origenId === perfil.sucursalId);
    if (x.estado === "PENDIENTE") {
      if (gerente() && x.autorizacion !== "APROBADA")
        boton(
          "Autorizar pedido",
          () => confirmarComplemento("autorizarPedido", x),
          td,
        );
      if (propio) {
        boton(
          "Modificar",
          () => formulario("modificarPedido", x),
          td,
          "secondary",
        );
        boton("Cancelar pedido", () => cancelarPedido(x), td, "danger");
      }
      if (origen) boton("Despachar", () => formulario("despachar", x), td);
    }
    if (x.estado === "INCIDENCIA" && gerente())
      boton("Asignar otra unidad", () => formulario("reasignar", x), td);
    if (
      x.estado === "EN_RUTA" &&
      (gerente() ||
        (x.repartidorUid
          ? repartidor() && x.repartidorUid === perfil.uid
          : x.vendedorUid === perfil.uid))
    ) {
      if (repartidor() && x.repartidorUid === perfil.uid)
        boton("Confirmar entrega", () => confirmarEntrega(x), td);
      boton(
        "Reportar problema",
        () => formulario("incidencia", x),
        td,
        "secondary",
      );
    }
  }
  if (
    modulo === "inventario_sucursales" &&
    (gerente() || x.sucursalId === perfil.sucursalId)
  ) {
    boton("Venta / salida", () => formulario("ventaSucursal", x), td);
    boton("Conteo", () => formulario("ajustarSucursal", x), td, "secondary");
  }
  if (
    gerente() &&
    ["productos", "ingredientes", "recetas", "sucursales"].includes(modulo)
  ) {
    boton("Modificar", () => formulario("guardarCatalogo", x), td, "secondary");
    boton("Eliminar", () => eliminarCatalogo(x), td, "danger");
  }
  if (gerente() && modulo === "usuarios" && x.rol === "VENDEDOR")
    boton(
      "Asignar sucursal",
      () => formulario("guardarCatalogo", x),
      td,
      "secondary",
    );
  if (modulo === "productos" && gerente())
    boton("Producir", () => formulario("producir", x), td);
  if (modulo === "ingredientes" && gerente())
    boton("Registrar entrada", () => formulario("entrada", x), td);
}
function campo(id, titulo, tipo = "text", options, value) {
  const lab = nodo("label", titulo, $("campos"));
  let e;
  if (options) {
    e = nodo("select", undefined, lab);
    for (const x of options) {
      const o = nodo("option", x.nombre, e);
      o.value = x.id;
    }
  } else {
    e = nodo(tipo === "textarea" ? "textarea" : "input", undefined, lab);
    if (tipo !== "textarea") e.type = tipo;
  }
  e.id = id;
  e.required = true;
  if (tipo === "number") {
    e.min = "0.01";
    e.max = "1000000";
    e.step = ".01";
  }
  if (tipo === "text" || tipo === "textarea")
    e.maxLength = tipo === "textarea" ? 500 : 120;
  if (value !== undefined) e.value = value;
  return e;
}
function origen() {
  return $("origen")?.value || editing?.origenId || "PRODUCCION";
}
function disponible(pid) {
  const p = (catalogos.productos || []).find((p) => p.id === pid),
    o = origen();
  let n =
    o === "PRODUCCION"
      ? p?.disponible
      : (catalogos.inventario_sucursales || []).find(
          (x) => x.sucursalId === o && x.productoId === pid,
        )?.disponible;
  const credito =
    accion === "modificarPedido"
      ? editing?.detalles?.find((l) => l.productoId === pid)?.cantidad || 0
      : 0;
  return Math.max(0, (n || 0) + credito);
}
function detalle(l = {}) {
  const row = nodo("div", undefined, $("detalles"));
  row.className = "detail";
  const sel = nodo("select", undefined, row);
  sel.required = true;
  sel.setAttribute(
    "aria-label",
    lineasTipo === "ingredientes" ? "Ingrediente" : "Producto",
  );
  const rows = catalogos[lineasTipo] || [];
  for (const p of rows) {
    const o = nodo("option", (p.codigo || p.id) + " · " + p.nombre, sel);
    o.value = p.id;
  }
  const q = nodo("input", undefined, row);
  q.type = "number";
  q.min = ".01";
  q.step = ".01";
  q.max = "1000000";
  q.required = true;
  q.value = l.cantidad ?? 1;
  q.setAttribute("aria-label", "Cantidad");
  if (l.productoId || l.ingredienteId)
    sel.value = l.productoId || l.ingredienteId;
  boton(
    "Quitar",
    () => {
      row.remove();
      vistaTotalPedido();
    },
    row,
    "secondary",
  );
  nodo("small", "", row);
  sel.onchange = actualizarLimites;
  actualizarLimites();
}
// Cada casilla agrega un producto distinto al mismo pedido.
function detallePedido(producto, anterior) {
  const fila = nodo("div", undefined, $("detalles"));
  fila.className = "pedido-producto";
  const etiqueta = nodo("label", undefined, fila);
  const elegir = nodo("input", undefined, etiqueta);
  elegir.type = "checkbox";
  elegir.checked = Boolean(anterior);
  elegir.setAttribute("aria-label", "Agregar " + producto.nombre);
  nodo("span", (producto.codigo || producto.id) + " · " + producto.nombre, etiqueta);
  const selector = nodo("select", undefined, fila);
  selector.hidden = true;
  const opcion = nodo("option", producto.nombre, selector); opcion.value = producto.id;
  selector.value = producto.id;
  const cantidad = nodo("input", undefined, fila);
  cantidad.type = "number"; cantidad.min = ".01"; cantidad.step = ".01";
  cantidad.required = true; cantidad.value = anterior?.cantidad ?? 1;
  cantidad.setAttribute("aria-label", "Cantidad de " + producto.nombre);
  nodo("small", "", fila);
  elegir.onchange = actualizarLimites;
}
function productosDelPedido() {
  return [...$("detalles").children]
    .filter(f => !f.querySelector('input[type="checkbox"]') || f.querySelector('input[type="checkbox"]').checked)
    .map(f => ({productoId: f.querySelector("select").value, cantidad: Number(f.querySelector('input[type="number"]').value)}));
}
function actualizarLimites() {
  if (
    !["crearPedido", "modificarPedido"].includes(accion) ||
    $("captura").hidden
  )
    return;
  for (const row of $("detalles").children) {
    const sel = row.querySelector("select"),
      q = row.querySelector('input[type="number"]');
    for (const o of sel.options) {
      const p = (catalogos.productos || []).find((p) => p.id === o.value),
        n = disponible(o.value);
      o.textContent =
        (p?.codigo || o.value) + " · " + p?.nombre + " · " + n + " disponibles";
      o.disabled = n <= 0 && o.value !== sel.value;
    }
    const n = disponible(sel.value);
    const casilla = row.querySelector('input[type="checkbox"]');
    if (casilla) {
      casilla.disabled = n <= 0 && !casilla.checked;
      q.disabled = !casilla.checked;
      row.classList.toggle("seleccionado", casilla.checked);
    }
    q.max = String(n);
    q.setCustomValidity(
      Number(q.value) > n
        ? "Falta de stock: solo hay " + n + " unidades disponibles."
        : "",
    );
    row.querySelector("small").textContent =
      n > 0
        ? "Disponible para reservar: " + n + " unidades."
        : "Sin unidades disponibles. No se puede agregar este artículo.";
    q.oninput = () => {
      q.setCustomValidity(
        Number(q.value) > disponible(sel.value)
          ? "La cantidad supera el stock disponible."
          : "",
      );
      vistaTotalPedido();
    };
  }
  vistaTotalPedido();
}
// Prepara los campos del formulario para la acción seleccionada.
function formulario(a, x = null) {
  if (ocupado || pendiente) {
    mensaje("Completa la solicitud pendiente antes de iniciar otra.", true);
    return;
  }
  accion = a;
  editing = x;
  registroId = x?.id || "";
  coleccionActual = modulo;
  lineasTipo = "productos";
  $("registro").querySelector("button[type=submit]").disabled = false;
  $("campos").replaceChildren();
  $("detalles").replaceChildren();
  $("captura").hidden = false;
  $("agregar").hidden = true;
  $("total-pedido").hidden = true;
  const titles = {
    crearPedido: "Nuevo pedido",
    modificarPedido: "Modificar pedido",
    despachar: "Despachar pedido",
    reasignar: "Aprobar reasignación de reparto",
    incidencia: "Reportar problema",
    solicitarProduccion: "Solicitar producción",
    autorizarDescuento: "Autorizar descuento por 12 horas",
    producir: "Registrar producción",
    entrada: "Registrar entrada",
    guardarCatalogo: (x ? "Modificar " : "Agregar ") + (nombres[modulo] || ""),
    ventaSucursal: "Registrar venta / salida",
    ajustarSucursal: "Registrar conteo físico",
  };
  $("titulo-formulario").textContent =
    titles[a] + (x?.numero ? " · " + x.numero : "");
  if (["crearPedido", "modificarPedido"].includes(a)) {
    const bs = (catalogos.sucursales || []).filter(
      (s) => gerente() || s.id === perfil.sucursalId,
    );
    campo("sucursal", "Sucursal que recibirá", "text", bs, x?.sucursalId);
    if (x) $("sucursal").disabled = true;
    const source = campo(
      "origen",
      "Solicitar producto a",
      "text",
      [
        { id: "PRODUCCION", nombre: "Producción central" },
        ...(catalogos.sucursales || []).filter(
          (s) => s.id !== $("sucursal").value,
        ),
      ],
      x?.origenId || "PRODUCCION",
    );
    source.disabled = !!x;
    source.onchange = actualizarLimites;
    $("sucursal").onchange = () => {
      const val = source.value;
      source.replaceChildren();
      for (const s of [
        { id: "PRODUCCION", nombre: "Producción central" },
        ...(catalogos.sucursales || []).filter(
          (s) => s.id !== $("sucursal").value,
        ),
      ]) {
        const o = nodo("option", s.nombre, source);
        o.value = s.id;
      }
      source.value = [...source.options].some((o) => o.value === val)
        ? val
        : "PRODUCCION";
      actualizarLimites();
    };
    const f = campo(
      "fecha",
      "Fecha en que deseas recibirlo",
      "date",
      null,
      x?.fechaEntrega || hoy(),
    );
    f.min = hoy();
    const c = campo(
      "comentarios",
      "Comentarios del pedido (opcional)",
      "textarea",
      null,
      x?.comentarios || "",
    );
    c.required = false;
    if (gerente()) {
      const label = nodo("label", undefined, $("campos"));
      label.className = "check-prueba";
      const check = nodo("input", undefined, label);
      check.type = "checkbox";
      check.id = "pedido-prueba";
      check.checked = x?.esPrueba === true;
      nodo(
        "span",
        "Pedido de prueba (no se incluye en el dashboard real)",
        label,
      );
    }
    $("agregar").hidden = true;
    const productos = [...(catalogos.productos || [])];
    for (const l of x?.detalles || []) {
      if (!productos.some(p => p.id === l.productoId)) productos.push({id:l.productoId, codigo:l.codigo, nombre:l.nombre || l.productoId});
    }
    productos.forEach(p => detallePedido(p, x?.detalles?.find(l => l.productoId === p.id)));
    actualizarLimites();
  }
  if (["producir", "entrada", "solicitarProduccion"].includes(a)) {
    const c = a !== "entrada" ? "productos" : "ingredientes";
    const ps = (catalogos[c] || []).filter(
      (p) =>
        a !== "producir" ||
        (catalogos.recetas || []).some(
          (r) => r.id === p.id && r.activo !== false,
        ),
    );
    const s = campo(
      "articulo",
      a !== "entrada" ? "Producto" : "Ingrediente",
      "text",
      ps,
      x?.id,
    );
    const q = campo(
      "cantidad",
      a !== "entrada" ? "Unidades a producir" : "Cantidad recibida",
      "number",
    );
    if (a === "producir") {
      const lote = () =>
        (q.value =
          (catalogos.recetas || []).find((r) => r.id === s.value)
            ?.rendimiento || 1);
      const vista = nodo("div", undefined, $("campos"));
      vista.id = "vista-consumo";
      vista.className = "consumo-previo";
      s.onchange = () => {
        lote();
        vistaConsumo();
      };
      q.oninput = vistaConsumo;
      lote();
      vistaConsumo();
    }
  }
  if (a === "solicitarProduccion") {
    const comentario = campo(
      "comentarios-produccion",
      "Comentarios",
      "textarea",
    );
    comentario.required = false;
    nodo(
      "p",
      "Solicitar no consume ingredientes. Autoriza y después finaliza desde Solicitudes de producción.",
      $("campos"),
    );
  }
  if (a === "autorizarDescuento") {
    nodo("p", x.sucursalNombre + " · " + x.productoNombre, $("campos"));
    campo("cantidad", "Unidades aptas incluidas", "number");
    const precio = campo(
      "precio-descuento",
      "Precio por unidad en quetzales",
      "number",
    );
    precio.min = "0";
    campo("motivo", "Motivo del descuento", "textarea");
    const label = nodo("label", undefined, $("campos")),
      check = nodo("input", undefined, label);
    check.type = "checkbox";
    check.id = "apto-descuento";
    check.required = true;
    nodo("span", "Confirmo que el producto es apto para venta", label);
  }
  if (["despachar", "reasignar"].includes(a)) {
    if (gerente())
      campo(
        "repartidor",
        "Repartidor",
        "text",
        (catalogos.usuarios || []).filter(
          (v) => v.activo && v.rol === "REPARTIDOR",
        ),
        x.repartidorUid,
      );
    if (gerente())
      campo(
        "vendedor",
        "Vendedor de destino",
        "text",
        (catalogos.usuarios || []).filter(
          (v) =>
            v.activo && v.rol === "VENDEDOR" && v.sucursalId === x.sucursalId,
        ),
        x.vendedorUid,
      );
    campo("unidad", "Unidad del vehículo", "text", null, x.unidad || "");
    if (a === "despachar") campo("ruta", "Ruta", "text", [{id: "NORTE", nombre: "Norte"}, {id: "SUR", nombre: "Sur"}]);
  }
  if (a === "incidencia") campo("problema", "Describe el problema", "textarea");
  if (["ventaSucursal", "ajustarSucursal"].includes(a)) {
    nodo("p", x.sucursalNombre + " · " + x.productoNombre, $("campos"));
    if (a === "ventaSucursal") {
      campo("tipo-movimiento", "Tipo de movimiento", "text", [
        { id: "venta", nombre: "Venta (genera ingreso)" },
        { id: "salida", nombre: "Salida sin venta (merma, consumo u otro)" },
      ]);
      const labelDescuento = nodo("label", undefined, $("campos")),
        checkDescuento = nodo("input", undefined, labelDescuento);
      checkDescuento.type = "checkbox";
      checkDescuento.id = "usar-descuento";
      nodo(
        "span",
        "Aplicar descuento autorizado (consultar vigencia en Descuentos)",
        labelDescuento,
      );
      const producto = catalogos.productos.find((p) => p.id === x.productoId);
      nodo(
        "p",
        "Precio por unidad: " + precioCatalogo(producto?.precioVenta),
        $("campos"),
      );
      if (gerente()) {
        const label = nodo("label", undefined, $("campos"));
        const check = nodo("input", undefined, label);
        check.type = "checkbox";
        check.id = "venta-prueba";
        nodo("span", "Movimiento de prueba (excluir de ingresos)", label);
      }
    }
    const q = campo(
      "cantidad",
      a === "ventaSucursal"
        ? "Unidades vendidas o retiradas"
        : "Existencia física contada",
      "number",
      null,
      a === "ajustarSucursal" ? x.existencia : "",
    );
    if (a === "ajustarSucursal") q.min = "0";
    campo(
      "motivo",
      a === "ventaSucursal"
        ? "Detalle de la venta / salida"
        : "Motivo del conteo",
      "textarea",
      null,
      a === "ajustarSucursal" ? "Conteo físico" : "",
    );
  }
  if (a === "guardarCatalogo") {
    if (modulo === "recetas") {
      campo(
        "articulo",
        "Producto de la receta",
        "text",
        catalogos.productos,
        x?.id,
      );
      if (x) $("articulo").disabled = true;
      campo("nombre", "Nombre de la receta", "text", null, x?.nombre || "");
      campo(
        "rendimiento",
        "Unidades que rinde",
        "number",
        null,
        x?.rendimiento || 1,
      );
      lineasTipo = "ingredientes";
      $("agregar").hidden = false;
      (x?.ingredientes || [{}]).forEach(detalle);
    } else {
      campo("nombre", "Nombre", "text", null, x?.nombre || "");
      if (modulo === "sucursales") {
        const p = campo(
          "prefijo",
          "Prefijo único (ej. ST)",
          "text",
          null,
          x?.prefijo || "",
        );
        p.maxLength = 5;
        p.disabled = !!x;
        campo(
          "direccion",
          "Dirección (opcional)",
          "textarea",
          null,
          x?.direccion || "",
        ).required = false;
      } else if (modulo === "usuarios") {
        campo(
          "sucursal",
          "Sucursal asignada",
          "text",
          catalogos.sucursales,
          x?.sucursalId,
        );
        campo(
          "activo",
          "Acceso",
          "text",
          [
            { id: "si", nombre: "Activo" },
            { id: "no", nombre: "Inactivo" },
          ],
          x?.activo ? "si" : "no",
        );
      } else {
        campo("unidad", "Unidad de medida", "text", null, x?.unidad || "UND");
        const m = campo(
          "minimo",
          "Existencia mínima",
          "number",
          null,
          x?.minimo ?? 1,
        );
        m.min = "0";
        const esProducto = modulo === "productos";
        const precio = campo(
          "precio",
          esProducto
            ? "Precio de venta por unidad (Q)"
            : "Costo por unidad de medida (Q)",
          "number",
          null,
          (esProducto ? x?.precioVenta : x?.costoUnitario) ?? "",
        );
        precio.min = "0";
        precio.required = false;
        nodo(
          "p",
          "Deja vacío si todavía no conoces el precio. Cero significa gratuito. El costo se expresa en la unidad indicada, por ejemplo quetzales por kilogramo.",
          $("campos"),
        );
        campo(
          "descripcion",
          "Descripción (opcional)",
          "textarea",
          null,
          x?.descripcion || "",
        ).required = false;
        nodo(
          "p",
          "Las existencias se actualizan mediante producción o entradas; no se cambian al editar el catálogo.",
          $("campos"),
        );
      }
    }
  }
  $("captura").scrollIntoView({ block: "start" });
}
async function enviar(a) {
  pendiente = { solicitudId: crypto.randomUUID(), ...a };
  sessionStorage.setItem(
    "quepanPendiente",
    JSON.stringify({ uid: perfil.uid, datos: pendiente }),
  );
  await guardar();
}
// Guarda la solicitud. El servidor verifica permisos y existencias.
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
    sessionStorage.removeItem("quepanPendiente");
    $("captura").hidden = true;
    await cargarCatalogos();
    await abrir(modulo);
    mensaje(r.result.mensaje);
  } catch (e) {
    if (e.http >= 400 && e.http < 500) {
      pendiente = null;
      sessionStorage.removeItem("quepanPendiente");
    } else $("reintentar").hidden = false;
    mensaje(
      e.message +
        (pendiente
          ? " Reintenta la misma solicitud para evitar duplicados."
          : ""),
      true,
    );
  } finally {
    ocupado = false;
  }
}
$("registro").onsubmit = async (e) => {
  e.preventDefault();
  if (ocupado || pendiente) return;
  try {
    const a = { accion };
    const v = (id) => $(id).value.trim(),
      n = (id) => Number(v(id));
    if (["crearPedido", "modificarPedido"].includes(accion)) {
      a.sucursalId = v("sucursal");
      a.origenId = origen();
      a.fechaEntrega = v("fecha");
      a.comentarios = v("comentarios");
      if (gerente() && $("pedido-prueba"))
        a.esPrueba = $("pedido-prueba").checked;
      a.detalles = productosDelPedido();
      if (!a.detalles.length) throw Error("Agrega al menos un producto.");
      if (accion === "modificarPedido") a.pedidoId = registroId;
    }
    if (["producir", "entrada", "solicitarProduccion"].includes(accion)) {
      a[accion !== "entrada" ? "productoId" : "ingredienteId"] = v("articulo");
      if (accion === "solicitarProduccion")
        a.comentarios = v("comentarios-produccion");
      a.cantidad = n("cantidad");
    }
    if (accion === "autorizarDescuento") {
      a.sucursalId = editing.sucursalId;
      a.productoId = editing.productoId;
      a.cantidad = n("cantidad");
      a.precioVenta = n("precio-descuento");
      a.motivo = v("motivo");
      a.apto = $("apto-descuento").checked;
    }
    if (["despachar", "reasignar", "incidencia"].includes(accion)) {
      a.pedidoId = registroId;
      if (accion === "incidencia") a.detalle = v("problema");
      else {
        a.vendedorUid = $("vendedor") ? v("vendedor") : editing.vendedorUid;
        if ($("repartidor")) a.repartidorUid = v("repartidor");
        a.unidad = v("unidad");
        if (accion === "despachar") a.ruta = v("ruta");
      }
    }
    if (["ventaSucursal", "ajustarSucursal"].includes(accion)) {
      a.sucursalId = editing.sucursalId;
      a.productoId = editing.productoId;
      a.motivo = v("motivo");
      if (accion === "ventaSucursal") {
        a.tipoMovimiento = v("tipo-movimiento");
        a.usarDescuento = $("usar-descuento").checked;
        if ($("venta-prueba")) a.esPrueba = $("venta-prueba").checked;
      }
      a[accion === "ventaSucursal" ? "cantidad" : "existencia"] = n("cantidad");
    }
    if (accion === "guardarCatalogo") {
      a.coleccion = coleccionActual;
      if (registroId) a.id = registroId;
      a.datos = { nombre: v("nombre") };
      if (coleccionActual === "recetas") {
        a.id = v("articulo");
        a.datos.rendimiento = n("rendimiento");
        a.datos.ingredientes = [...$("detalles").children].map((row) => ({
          ingredienteId: row.querySelector("select").value,
          cantidad: Number(row.querySelector("input").value),
        }));
      } else if (coleccionActual === "sucursales") {
        a.datos.prefijo = v("prefijo");
        a.datos.direccion = v("direccion");
      } else if (coleccionActual === "usuarios") {
        a.datos.sucursalId = v("sucursal");
        a.datos.activo = v("activo") === "si";
      } else {
        a.datos.unidad = v("unidad");
        a.datos.minimo = n("minimo");
        a.datos.descripcion = v("descripcion");
        a.datos[
          coleccionActual === "productos" ? "precioVenta" : "costoUnitario"
        ] = v("precio") === "" ? null : n("precio");
      }
    }
    await enviar(a);
  } catch (e) {
    mensaje(e.message, true);
  }
};
async function cancelarPedido(p) {
  if (
    !confirm(
      "¿Cancelar " +
        numero(p) +
        "? Se liberarán sus unidades reservadas y quedará en el reporte con status C.",
    )
  )
    return;
  const motivo = prompt("Motivo de cancelación", "Error en el pedido");
  if (motivo === null) return;
  await enviar({ accion: "cancelarPedido", pedidoId: p.id, motivo });
}
async function eliminarCatalogo(p) {
  if (
    confirm(
      "¿Eliminar " +
        (p.nombre || nombre("productos", p.id)) +
        " de los listados? Su historial se conservará.",
    )
  )
    await enviar({ accion: "desactivarCatalogo", coleccion: modulo, id: p.id });
}
async function confirmarComplemento(accion, x) {
  if (!confirm("¿Confirmar esta operación? El historial se conservará."))
    return;
  const a = { accion };
  if (accion === "autorizarPedido") a.pedidoId = x.id;
  else if (accion === "cancelarDescuento") {
    a.sucursalId = x.sucursalId;
    a.productoId = x.productoId;
  } else a.produccionId = x.id;
  if (accion === "cancelarSolicitudProduccion") {
    a.motivo = prompt("Motivo de cancelación");
    if (!a.motivo?.trim()) return;
  }
  await enviar(a);
}
async function confirmarEntrega(p) {
  if (confirm("¿Confirmas que " + numero(p) + " fue recibido por la sucursal?"))
    await enviar({ accion: "entregar", pedidoId: p.id });
}
$("nuevo").onclick = () =>
  formulario(
    modulo === "solicitudes_produccion"
      ? "solicitarProduccion"
      : modulo === "pedidos"
        ? "crearPedido"
        : modulo === "producciones"
          ? "producir"
          : modulo === "movimientos"
            ? "entrada"
            : "guardarCatalogo",
  );
$("agregar").onclick = () => detalle();
$("cancelar").onclick = $("cerrar-form").onclick = () => {
  $("captura").hidden = true;
  accion = "";
};
$("actualizar").onclick = refrescarSilencioso;
$("buscar").oninput = () => { paginaAvisos = 1; pintar(); };
for (const id of ["f-sucursal", "f-producto", "f-ruta", "f-estado"])
  $(id).onchange = () => { paginaAvisos = 1; pintar(); };
$("reintentar").onclick = guardar;
// Solicita al servidor el reporte Excel de la fecha seleccionada.
$("descargar").onsubmit = async (e) => {
  e.preventDefault();
  if (ocupado) return;
  ocupado = true;
  try {
    const fecha = $("fecha-reporte").value,
      tipo = $("tipo-reporte").value;
    if (window.QuePanAndroid) {
      if (typeof window.QuePanAndroid.descargarExcel !== "function")
        throw Error(
          "Actualiza QUE PAN a la versión 2.1 para descargar archivos Excel.",
        );
      window.QuePanAndroid.descargarExcel(fecha, tipo, await token());
      mensaje("Elige dónde guardar el listado.");
    } else {
      mensaje("Preparando listado…");
      const r = await fetch(
        "/reportes/diario.xlsx?fecha=" +
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
      const url = URL.createObjectURL(await r.blob()),
        a = nodo("a");
      a.href = url;
      a.download = "QUEPAN_" + tipo + "_" + fecha + ".xlsx";
      a.textContent = "Guardar archivo Excel";
      a.className = "app-link";
      $("enlace-descarga")?.remove();
      a.id = "enlace-descarga";
      $("descargar").append(a);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      mensaje(
        "Excel preparado. Si no inició la descarga, pulsa Guardar archivo Excel.",
      );
    }
  } catch (e) {
    mensaje(e.message, true);
  } finally {
    ocupado = false;
  }
};
$("avisos").onclick = async () => {
  try {
    window.QuePanAndroid.permitirNotificaciones(await token());
  } catch (e) {
    mensaje(e.message, true);
  }
};
window.resultadoAndroid = (texto, error) => mensaje(texto, error);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && perfil) refrescarSilencioso();
});

// Vista previa educativa; la transacción del servidor vuelve a validar todos los saldos.
function vistaConsumo() {
  const box = $("vista-consumo");
  if (!box || accion !== "producir") return;
  box.replaceChildren();
  const cantidad = Number($("cantidad").value),
    id = $("articulo").value;
  const receta = (catalogos.recetas || []).find((x) => x.id === id);
  const producto = (catalogos.productos || []).find((x) => x.id === id);
  const guardar = $("registro").querySelector("button[type=submit]");
  guardar.disabled = true;
  if (
    !receta ||
    !producto ||
    cantidad <= 0 ||
    !Number.isFinite(cantidad) ||
    cantidad > 1000000 ||
    Math.abs(cantidad * 100 - Math.round(cantidad * 100)) > 0.000001
  ) {
    nodo(
      "p",
      "Elige una receta y una cantidad válida (hasta dos decimales).",
      box,
    );
    return;
  }
  let valido = true;
  let costoTotal = 0,
    costosPendientes = 0;
  nodo("h4", "Consumo de materia prima", box);
  const tabla = nodo("table", undefined, box),
    head = nodo("tr", undefined, nodo("thead", undefined, tabla));
  [
    "Ingrediente",
    "Existencia",
    "Consumo",
    "Saldo previsto",
    "Costo por unidad",
    "Costo del consumo",
  ].forEach((t) => nodo("th", t, head));
  const body = nodo("tbody", undefined, tabla);
  for (const l of receta.ingredientes || []) {
    const i = (catalogos.ingredientes || []).find(
      (x) => x.id === l.ingredienteId,
    );
    const calculo =
        (Number(l.cantidad) * cantidad) / Number(receta.rendimiento),
      uso = Math.round(calculo * 100) / 100;
    const exacto =
      Number.isFinite(calculo) &&
      Math.abs(calculo * 100 - Math.round(calculo * 100)) < 0.000001 &&
      uso > 0;
    const saldo = Math.round(((i?.existencia || 0) - uso) * 100) / 100;
    if (!i || !exacto || saldo < 0) valido = false;
    const costoCentavos =
      i?.costoUnitario == null ? null : Math.round(i.costoUnitario * 100);
    const costoConsumo =
      costoCentavos == null || !exacto
        ? null
        : Math.round((Math.round(uso * 100) * costoCentavos) / 100);
    if (costoConsumo == null) costosPendientes++;
    else costoTotal += costoConsumo;
    const tr = nodo("tr", undefined, body),
      u = i?.unidad || "";
    [
      i?.nombre || l.ingredienteId,
      (i?.existencia || 0) + " " + u,
      exacto ? uso + " " + u : "Ajustar cantidad del lote",
      exacto ? saldo + " " + u : "—",
      quetzales(costoCentavos),
      quetzales(costoConsumo),
    ].forEach((t) => nodo("td", t, tr));
  }
  nodo(
    "p",
    costosPendientes
      ? "Costo parcial conocido: " +
          quetzales(costoTotal) +
          ". Ingredientes sin costo: " +
          costosPendientes
      : "Costo de materia prima del lote: " + quetzales(costoTotal),
    box,
  );
  const despues =
    Math.round((Number(producto.existencia || 0) + cantidad) * 100) / 100;
  if (!receta.ingredientes?.length || despues > 1000000) valido = false;
  nodo(
    "p",
    `Producto terminado: ${producto.existencia || 0} + ${cantidad} = ${despues} ${producto.unidad || ""}.`,
    box,
  );
  nodo(
    "p",
    valido
      ? "Listo para confirmar. Se guardará el consumo junto con la producción."
      : "No se puede producir este lote: revisa la materia prima disponible, el límite de existencia o la precisión de la receta.",
    box,
  ).className = valido ? "nota" : "error";
  guardar.disabled = !valido;
}

// El total visible es una ayuda. El servidor calcula el importe definitivo.
function vistaTotalPedido() {
  const salida = $("total-pedido");
  if (!salida || !["crearPedido", "modificarPedido"].includes(accion)) return;
  salida.hidden = false;
  let total = 0,
    pendientes = 0;
  for (const fila of $("detalles").children) {
    const casilla = fila.querySelector('input[type="checkbox"]');
    if (casilla && !casilla.checked) continue;
    const id = fila.querySelector("select").value;
    const cantidad = Number(fila.querySelector('input[type="number"]').value);
    const producto = catalogos.productos.find((p) => p.id === id);
    const anterior = editing?.detalles?.find((l) => l.productoId === id);
    const precio = anterior
      ? (anterior.precioUnitarioCentavos ?? null)
      : producto?.precioVenta == null
        ? null
        : Math.round(producto.precioVenta * 100);
    if (precio == null) pendientes++;
    else total += Math.round((Math.round(cantidad * 100) * precio) / 100);
    const nota = fila.querySelector("small");
    nota.textContent =
      nota.textContent.split(" Precio:")[0] +
      " Precio: " +
      quetzales(precio) +
      ".";
  }
  salida.textContent = pendientes
    ? "Subtotal con precio: " +
      quetzales(total) +
      ". Productos sin precio: " +
      pendientes +
      ". Total pendiente."
    : "Total del pedido: " + quetzales(total);
}

// Avisos visuales: la primera lectura muestra historial; solo los nuevos abren una ventana.
const AvisosWeb = (() => {
  let ultimoId = null, inicio = false, leyendo = false, generacion = 0;
  function reiniciar() {
    generacion++; ultimoId = null; inicio = false; leyendo = false;
    $("avisos-emergentes").replaceChildren(); $("avisos-recientes").replaceChildren();
  }
  async function actualizar() {
    if (!perfil || leyendo) return;
    leyendo = true; const turno = generacion;
    try {
      const respuesta = await api("/api/datos?modulo=notificaciones");
      if (!perfil || turno !== generacion) return;
      const filas = respuesta.filas.sort((a, b) => String(b.creado || "").localeCompare(String(a.creado || "")) || a.id.localeCompare(b.id));
      const panel = $("avisos-recientes"); panel.replaceChildren();
      if (!filas.length) nodo("p", "Sin alertas", panel);
      for (const aviso of filas.slice(0, 1)) {
        const item = nodo("div", undefined, panel); item.className = "aviso-reciente";
        nodo("strong", aviso.titulo || "Aviso", item);
        nodo("p", aviso.mensaje || "", item);
        nodo("small", hora(aviso.creado), item);
      }
      const ultimo = filas[0];
      if (inicio && ultimo && ultimo.id !== ultimoId) emergente(ultimo);
      ultimoId = ultimo?.id || null;
      inicio = true;
    } catch { /* La siguiente actualización vuelve a consultar sin borrar el historial. */ }
    finally { if (turno === generacion) leyendo = false; }
  }
  function emergente(aviso) {
    const contenedor = $("avisos-emergentes");
    contenedor.replaceChildren();
    const item = nodo("div", undefined, contenedor); item.className = "aviso-emergente";
    nodo("strong", aviso.titulo || "Aviso", item);
    nodo("p", aviso.mensaje || "", item);
    const cerrar = nodo("button", "Cerrar aviso", item); cerrar.type = "button";
    cerrar.onclick = () => item.remove();
    setTimeout(() => item.remove(), 15000);
  }
  return { actualizar, reiniciar };
})();

$("ver-historial-avisos").onclick = () => abrir("notificaciones");
for (const id of ["fecha-aviso", "tipo-aviso"]) $(id).onchange = () => { paginaAvisos = 1; pintar(); };
$("limpiar-avisos").onclick = () => { $("fecha-aviso").value = ""; $("tipo-aviso").value = ""; paginaAvisos = 1; pintar(); };
$("avisos-anterior").onclick = () => { paginaAvisos = Math.max(1, paginaAvisos - 1); pintar(); };
$("avisos-siguiente").onclick = () => { paginaAvisos++; pintar(); };
