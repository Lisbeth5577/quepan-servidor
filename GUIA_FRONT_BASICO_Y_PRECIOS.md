# Guía para entender la página básica de QUE PAN

## Qué se simplificó
La página usa fondo blanco, letra Arial, encabezados normales, botones, formularios y tablas con bordes. Se quitaron el banner, las tarjetas decorativas y las barras del resumen. No utiliza React, Bootstrap ni una biblioteca de gráficos. La página y Android siguen compartiendo funciones.

## Qué hace cada archivo
- index.html: define encabezado, acceso, menú, formularios, filtros y lugares donde aparecerán tablas.
- panaderia.css: establece letra, colores, bordes, tamaños y separación. Sus bloques están comentados.
- panaderia.js: responde a botones, consulta al servidor y dibuja filas. También gestiona sesión y formularios.
- dashboard-ui.js: presenta el resumen en tablas. No calcula los ingresos por su cuenta.
- web.cjs: entrega archivos y atiende consultas autorizadas.
- negocio.cjs: valida y guarda pedidos, ventas, producción y catálogos.
- precios.cjs: valida precios, calcula en centavos y agrupa importes.
- dashboard.cjs: calcula resumen mensual y separa pruebas.
- consultas.cjs: determina qué puede consultar cada perfil.

## Cómo explicar un botón
Un botón tiene un texto y una acción. Al pulsar Productos se llama abrir con el nombre del módulo. Esa función consulta al servidor y guarda la respuesta en datos. pintar recorre datos y agrega filas. La tabla no es una fotografía: se construye con la respuesta de la base.

## Cómo explicar la consulta
El acceso identifica a la persona mediante Firebase Authentication. La función api utiliza fetch para enviar una solicitud con la credencial temporal. El servidor comprueba quién es y qué puede ver. La respuesta contiene datos y JavaScript los coloca en elementos de la página. El navegador no conoce la clave privada de Firebase.

Ejemplo reducido para estudiar, no reemplazo de la protección completa:
```javascript
async function consultarProductos() {
  const respuesta = await api('/api/datos?modulo=productos');
  datos = respuesta.filas;
  pintar();
}
```
async permite esperar una respuesta sin bloquear toda la página. await espera el resultado. La protección y los errores se resuelven en api y en el servidor.

## Formularios
label indica qué se escribe. input recibe texto, número o fecha. select permite elegir. form agrupa los campos. El evento de envío impide recargar la página y prepara los datos. El servidor valida otra vez: no se confía únicamente en que el navegador tenga un límite de cantidad.

## Pedidos y reservas
Guardar pedido reserva unidades. Despachar descuenta del origen y libera reserva. Entregar suma en destino. Cancelar un pendiente libera reserva y conserva historial. Las transacciones aseguran que no se guarde solo la mitad de una operación. Esta parte debe mantenerse aunque el diseño sea sencillo.

## Precios y totales en quetzales
En Productos, el gerente abre Modificar y escribe precio de venta por unidad. En Ingredientes escribe costo por su unidad de medida: por ejemplo, quetzales por kilogramo, no el precio de una bolsa si el inventario se lleva en kilogramos. Vacío es pendiente y cero es gratuito. No se cargaron precios de ejemplo en la base real.

Una línea cuesta cantidad por precio. Para no acumular errores decimales, el servidor trabaja con centavos enteros y redondea cada línea al centavo. Suma los importes de las líneas. El pedido conserva el precio que tuvo al guardarse. Modificar la cantidad conserva el precio original de esa línea. Una línea nueva usa el precio vigente. Cambiar el catálogo no cambia pedidos o ventas anteriores.

Si un pedido anterior no tiene precio, se muestra pendiente. No se calcula su historia usando el precio de hoy. La producción conserva costos de ingredientes al momento de producir. Es costo de materia prima; no incorpora automáticamente salarios, gas, electricidad u otros gastos.

## Ingresos mensuales
La usuaria eligió contar ventas registradas en sucursal. Al registrar una venta o salida se elige Venta o Salida sin venta. Solo Venta con precio suma ingresos. Una merma no es ingreso. El conteo físico tampoco. Pedidos y entregas se muestran como importes separados y no se suman como si fueran ventas.

El resumen usa fecha de registro en Guatemala y agrupa por sucursal. Excluye movimientos marcados de prueba. Las salidas anteriores que mezclaban venta y retiro no se convierten en ingresos: se muestran como pendientes de clasificación. Estos ingresos no son utilidad ni una confirmación independiente de cobros. Para eso se necesitarían gastos y pagos.

## Reportes
El libro mantiene las veintidós columnas anteriores y agrega precio o costo unitario, importe de línea, moneda, tipo de salida y clasificación real o prueba. El importe corresponde al movimiento guardado. No se debe sumar juntos pedidos, despachos y entregas como ingresos, porque son etapas del mismo producto. Para ingresos se usa la tabla mensual de ventas.

## Orden sugerido para demostrarlo
1. Mostrar index.html y ubicar un formulario y una tabla.
2. Mostrar panaderia.css y cambiar un color en una copia local.
3. Ubicar abrir, api y pintar en panaderia.js y explicar el recorrido.
4. Consultar productos sin modificar datos.
5. Explicar un pedido y su reserva con un ejemplo en papel.
6. Mostrar los campos de precio y costo sin inventar valores.
7. Explicar el total del pedido y el ingreso mensual por sucursal.
8. Mostrar una prueba de permisos y los resultados del emulador.

## Cómo describir la participación
El proyecto se construyó con asistencia de herramientas de desarrollo. Para defenderlo, identifica las decisiones que tomaste, las pruebas que realizaste, lo que entiendes y lo que aún estás aprendiendo. Un diseño básico ayuda a leer el código, pero no sustituye comprenderlo ni corresponde presentar asistencia como trabajo realizado sin ayuda. Puedes explicar y modificar partes concretas con tus propias palabras.

## Prácticas pequeñas
Identifica el encabezado de Productos, encuentra dónde se agrega Precio de venta a la tabla y explica por qué solo el gerente puede editarlo. Sigue una solicitud desde el botón hasta el servidor. Explica por qué una salida sin venta no suma ingreso y por qué un precio vacío no es cero. Haz estas prácticas en una copia o en el emulador.
