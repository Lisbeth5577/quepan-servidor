# Integración del paquete recibido el 30 de octubre de 2026

La versión principal sigue siendo QUE PAN con Firebase y Android, publicada en Render. Se conservaron el diseño básico, el menú vertical y las funciones existentes.

## Funciones incorporadas

- Solicitudes de producción: registrar, autorizar, cancelar y finalizar. Registrar y autorizar no cambian saldos. Finalizar utiliza la misma transacción de producción, comprueba ingredientes y guarda el lote. Una solicitud finalizada no se procesa de nuevo.
- Autorización explícita de pedidos por el gerente, con responsable y fecha. Editar devuelve la autorización a pendiente. Se conserva el despacho actual: la confirmación de despacho también registra autorización. No se vuelve a reservar ni se descuenta al autorizar.
- Descuentos por producto y sucursal: solo gerente, precio inferior al normal, producto apto, cantidad limitada al saldo libre, vigencia de 12 horas. El vendedor debe marcar Aplicar descuento autorizado. La venta guarda su precio histórico, consume el cupo y rebaja inventario dentro de una transacción. Se puede cancelar el descuento conservando historial.
- Consultas y reportes separados de autorizaciones, solicitudes y descuentos, conservando las 27 columnas del Excel.

## Funciones que ya estaban y se conservaron

Reservas concurrentes, actualización de disponibilidad, bloqueo de stock insuficiente, catálogos editables, cancelaciones y versiones O/C, códigos cortos, traslados entre sucursales, ventas y salidas, precios en quetzales, ingresos por sucursal, dashboard, aplicación Android, avisos al teléfono y publicación en internet.

## Decisiones del ZIP que no sustituyen nuestra solución

El adjunto usa otro modelo PAN_* y usuarios locales, sin reservas, sin aplicación Android ni avisos con la aplicación cerrada. No se ejecutaron sus scripts sobre el esquema existente. Se conserva como referencia aislada para no perder sus clases, scripts y pruebas. La versión original Java con Oracle también permanece separada y documentada; Firebase y Oracle no están sincronizados.

El cierre a las 19:00, el bloqueo de pedidos para hoy, el despacho exclusivamente desde las 04:00 y la limitación fija a dos vehículos son decisiones particulares del código adjunto. No aparecen como requisitos en el documento del ingeniero revisado y restringirían el flujo que la usuaria pidió conservar. No se impusieron a QUE PAN. Los pedidos siguen usando fecha solicitada y comentarios; unidad y ruta se registran en el despacho. No se inventaron vehículos, repartidores ni cuentas de producción nuevas.

La identidad institucional del adjunto no se incorpora, conforme a la instrucción de la usuaria. Se mantiene el identificador técnico interno Android para conservar la actualización de la aplicación.

## Validación y límites

Respaldo de código previo verificado y 117 documentos restaurados y comparados en emulador. Pruebas de los nuevos flujos realizadas con datos ficticios en un proyecto de emulador identificado. Ninguna venta, descuento, pedido o producción se creó en la base real para esta integración.

Continúan pendientes los precios reales y los conteos físicos no proporcionados; no se fabricaron importes ni saldos. Las siete pruebas de pedidos se conservan excluidas de los totales reales. La última comprobación física Android corresponde a las pruebas previas de la usuaria; esta integración comparte la interfaz web y requiere una comprobación nueva en el teléfono.
