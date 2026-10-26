# Resumen general y control de producción — QUE PAN

El gerente abre directamente «Resumen general» al iniciar sesión, tanto en la web como en la app Android. La app carga la misma interfaz publicada; no requiere reinstalar el APK para este cambio.

## Resumen mensual
- Selector de mes con horario de Guatemala.
- Pedidos registrados, vigentes y cancelados; un pedido se cuenta una sola vez, sin duplicar versiones de su historial.
- Cantidades solicitadas, entregadas, producidas y vendidas/retiradas, separadas por unidad. Se unifican UND/unidad/unidades como UND y las variantes de kilogramo como KG, sin convertir piezas en peso.
- Entregas por fecha real de confirmación, aunque el pedido se haya creado en otro mes.
- Producto presente en más pedidos vigentes; muestra empates y ranking. La cantidad solicitada de cada producto también se muestra con su unidad.
- Pedidos por sucursal y actividad diaria.
- Recuento global: pedidos, pendientes, en ruta, incidencias abiertas, productos, ingredientes y sucursales activos.
- Existencias actuales, reservas, disponibilidad y alertas de materia prima y producto terminado. No se presentan como un cierre histórico del mes seleccionado.
- Registros sin fecha y conteos pendientes se identifican sin inventar datos.

## Flujo de inventario confirmado por la usuaria
1. Registrar producción consume los ingredientes de la receta proporcionalmente al lote y suma producto terminado.
2. Crear pedido reserva disponibilidad. No consume nuevamente ingredientes.
3. Despachar baja producto terminado del origen y libera la reserva.
4. Entregar suma el producto en la sucursal de destino.
5. Venta/salida baja el producto terminado de la sucursal.

La vista previa muestra existencia, consumo y saldo de cada ingrediente. Bloquea guardar si falta materia prima o la cantidad no permite la precisión requerida. El servidor vuelve a validar dentro de una transacción. Los nuevos registros de producción guardan el saldo anterior y posterior del producto terminado y de cada ingrediente, además de cantidad, receta y responsable. No se modifica el historial anterior.

## Pruebas
26 comprobaciones de cálculo mensual (incluyendo zona horaria, cancelaciones, fechas de entrega, unidades, reservas sin respaldo y meses vacíos).
33 pruebas de negocio en emulador: incluyen regresión de pedidos/entregas y producción sin stock, idempotencia, concurrencia y auditoría de saldos.
15 verificaciones HTTP, incluidas autenticación, autorización de gerente, validación del mes y recursos de la interfaz.
Vista previa revisada en navegador con copia restaurada: cifras y formulario de producción; intento de lote sin materia prima bloqueado sin guardar.
No se hicieron producciones ni pedidos reales para estas pruebas.

## API para Postman
GET https://sipropan-servidor.onrender.com/api/dashboard?mes=2026-10
Authorization: Bearer {{firebase_id_token}}
Solo rol GERENTE. Sin sesión devuelve 401; vendedor 403; mes inválido 400.

## Respaldo
Código: outputs/RESPALDO_DASHBOARD_2026-10-24/codigo_antes_dashboard.zip, integridad ZIP comprobada.
Datos: work/firebase_privado/respaldo_DASHBOARD_2026-10-24.json, 116 documentos, incluidas subcolecciones, restaurados y comparados en emulador. Datos privados excluidos de los entregables y GitHub.

## Datos pendientes previos
Existen pedidos históricos con reservas superiores a su stock físico. Se conservan y se advierten en el dashboard; requieren producción o corrección/cancelación por la usuaria. Existen conteos iniciales de sucursal pendientes; no se simulan existencias. Oracle sigue siendo una implementación separada y no se sincroniza automáticamente con Firebase.

## Corrección del 25 de octubre: pruebas separadas
La propietaria confirmó que todos los siete pedidos anteriores fueron pruebas. Se conservaron completos y se marcaron esPrueba=true. El resumen real debe mostrar 0 pedidos de octubre y excluir sus 221 unidades y sus entregas del ranking y gráficos. Un aviso contabiliza las pruebas excluidas. Los pedidos e historial permanecen consultables; el inventario no se reinicia ni se corrige de forma ficticia. El gerente puede marcar futuros pedidos de prueba en su formulario. La publicación de esta corrección debe comprobarse antes de darla por activa.
