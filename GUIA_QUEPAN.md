# Panadería San Carlos «QUE PAN» — Actualización 2.1

## Qué cambió

- Nombre de la web y el APK: Panadería San Carlos «QUE PAN». Diseño verde vintage, musgo, palo rosa y café; pan en pixel art generado originalmente para el proyecto.
- Se retira el nombre de la universidad de las pantallas y documentos editables. Los respaldos anteriores se conservan sin alteración.
- Pedidos de las cinco sucursales con fecha de recepción y comentarios. El vendedor solo solicita para su sucursal; el gerente puede hacerlo para todas.
- Números cortos por sucursal: SC (Central), SCH (Chiva), SB (Barco), SH (Heidy), ST (Terminal). El correlativo continúa los pedidos anteriores y no se reutiliza al cancelar.
- Códigos de producto P-001, P-002… y de ingredientes I-001… Los identificadores internos anteriores se conservan para no romper relaciones.
- Las unidades se reservan al guardar un pedido. Disponible = existencia menos reservas. La validación del servidor es atómica: dos sucursales no pueden consumir las mismas últimas unidades.
- Los listados se actualizan mediante una conexión autenticada de eventos. Si no hay conexión se informa; al guardar siempre se vuelve a validar el stock.
- Modificar pedidos pendientes conserva la versión anterior. Cancelar libera reservas, oculta el pedido del listado operativo y conserva su auditoría.
- O significa operada/vigente; C significa cancelada o versión sustituida. Las columnas Actividad y Estado permiten distinguir cada evento.
- Gerente: agregar, modificar y eliminar mediante desactivación productos, ingredientes, recetas y sucursales. Las recetas e ingredientes referenciados requieren resolver sus dependencias. Editar catálogos no altera el inventario físico.
- Direcciones de sucursal editables y asignación de vendedores ya creados a una sucursal. Las cuentas de acceso se siguen creando en Firebase Authentication; no hay registro público.
- Inventario por sucursal: entrega recibida suma producto; venta/salida descuenta; conteo registra explícitamente el saldo físico con motivo y auditoría. Con una unidad o menos se muestra la necesidad de pedir más.
- Pedido entre sucursales: elegir la sucursal de origen, reservar su stock, despachar desde ella y confirmar la recepción en destino. Se consulta dirección y stock; no se calcula cercanía por GPS ni distancia.
- Filtros de sucursal, producto, ruta y estado en los listados donde aplican.
- Reportes Excel (.xlsx): fecha, hora, número de pedido, sucursal, vendedor, código, descripción, cantidades solicitadas/despachadas/entregadas, cantidad del movimiento, unidad, actividad, O/C, estado, fecha solicitada, origen, ruta, vehículo, comentarios y operador.

## Cómo usarlo

Web: https://sipropan-servidor.onrender.com/web/
APK: https://sipropan-servidor.onrender.com/

Actualiza la app existente; no la desinstales. Entra con la cuenta asignada. En Android pulsa Permitir notificaciones después de iniciar sesión. No se requiere USB. Los vendedores pueden descargar los reportes de su sucursal; el gerente ve todas.

Para corregir un pedido pendiente: Pedidos y entregas → Modificar, o Cancelar pedido. Un pedido en ruta no se cancela mediante este flujo porque ya salió de inventario; se atiende con incidencia, reasignación y entrega.

Para pedir a una sucursal hermana: revisa Inventario por sucursal y sus direcciones. En Nuevo pedido elige esa sucursal en Solicitar producto a. El vendedor de origen o el gerente puede despachar. La recepción la confirma el vendedor de destino o el gerente.

Para el inventario de sucursal anterior a esta actualización, realiza primero un conteo físico. No se supone que toda entrega antigua siga sin venderse. Las nuevas entregas se suman automáticamente.

## Comprobaciones

Respaldo previo de 469 archivos de código verificado como ZIP. Respaldo Firebase de 97 documentos, incluidas subcolecciones, restaurado y comparado en un emulador independiente conservando fechas y tipos. Los archivos con tokens permanecen en la carpeta privada y no se publican.

29 pruebas de negocio en emulador: cinco sucursales, reservas, concurrencia, stock agotado, edición, cancelación, ruta, entrega, venta, conteo, traslado, catálogos, permisos e historial. 10 verificaciones HTTP: rechazo sin sesión, origen ajeno, acceso por rol, imagen y conexión de eventos.

Prueba visual en copia local: Terminal guardó ST-01 con comentarios, fecha y reserva. Esa operación de prueba no se creó en Firebase real.

APK 2.1 compilado con revisión Android sin errores; advertencias de JavaScript requerido y un recurso no utilizado. Firma compatible con la versión anterior. La prueba física de esta actualización debe confirmarse después de instalarla.

## Datos que se conservan y límites

Los pedidos anteriores con cantidades mayores al stock no se eliminan: quedan pendientes y sin disponibilidad para nuevas reservas. Se debe producir lo faltante, reducir o cancelar esos pedidos.

Las versiones históricas anteriores a esta actualización no se pueden reconstruir si no se guardaron. Se conserva el estado disponible y el reporte lo identifica. Las versiones nuevas se auditan desde esta actualización.

El alojamiento gratuito puede entrar en reposo y requiere internet. La recepción física de los nuevos avisos en un teléfono depende de actualizar el APK y registrar el dispositivo con la cuenta correspondiente.

La versión Java/Jersey y Oracle se conserva como otro origen. Esta actualización de reservas e inventario por sucursal corresponde a la web publicada y al APK con Firebase; no se afirma sincronización automática con Oracle.

## Respaldo anterior

Código: outputs/RESPALDO_QUEPAN_2026-10-21/codigo_antes_cambios.zip
Verificación de restauración: outputs/RESPALDO_QUEPAN_2026-10-21/datos_verificacion.json
Datos completos privados: work/firebase_privado/respaldo_QUEPAN_2026-10-21.json

No se incluyen contraseñas ni claves privadas en la entrega.

## Descargar Excel

En Reportes diarios elige fecha y listado y pulsa Descargar Excel (.xlsx). En la web se guarda un libro Excel; queda además el enlace Guardar archivo Excel si el navegador no inicia automáticamente. En Android 2.1 elige la carpeta y confirma Guardar; después puedes pulsar Abrir para elegir Excel u otra aplicación compatible. La descarga CSV de versiones anteriores se conserva por compatibilidad.
