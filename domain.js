"use strict";
// Reglas pequenas que se pueden explicar y probar sin una cuenta de Firebase.
class ErrorNegocio extends Error {
  constructor(message, code = "failed-precondition") {
    super(message);
    this.code = code;
  }
}
const exigir = (ok, msg, code) => {
  if (!ok) throw new ErrorNegocio(msg, code);
};
function texto(v, n = 200) {
  exigir(
    typeof v === "string" && v.trim().length > 0 && v.trim().length <= n,
    "Texto requerido o demasiado largo",
    "invalid-argument",
  );
  return v.trim();
}
function id(v) {
  const s = texto(v, 100);
  exigir(
    /^[A-Za-z0-9_-]+$/.test(s),
    "Identificador no valido",
    "invalid-argument",
  );
  return s;
}
function centavos(n) {
  exigir(
    typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 1000000,
    "Cantidad positiva hasta 1000000",
    "invalid-argument",
  );
  const q = Math.round(n * 100);
  exigir(
    Math.abs(q - n * 100) < 0.000001,
    "Usa hasta dos decimales",
    "invalid-argument",
  );
  return q;
}
function detalles(rows) {
  exigir(
    Array.isArray(rows) && rows.length > 0 && rows.length <= 50,
    "Agrega entre 1 y 50 productos",
    "invalid-argument",
  );
  const seen = new Set();
  return rows.map((r) => {
    const productId = id(r.productoId);
    exigir(!seen.has(productId), "Producto repetido", "invalid-argument");
    seen.add(productId);
    return { productoId: productId, cantidad: centavos(r.cantidad) / 100 };
  });
}
function perfil(p) {
  exigir(
    p && p.activo === true && ["GERENTE", "VENDEDOR"].includes(p.rol),
    "Usuario sin permiso",
    "permission-denied",
  );
  return p;
}
function gerente(p) {
  perfil(p);
  exigir(
    p.rol === "GERENTE",
    "Solo el gerente puede realizar esta operacion",
    "permission-denied",
  );
}
function autor(p, uid, pedido) {
  perfil(p);
  exigir(
    p.rol === "GERENTE" || pedido.vendedorUid === uid,
    "El pedido pertenece a otro vendedor",
    "permission-denied",
  );
}
function consumo(receta, cantidad) {
  exigir(
    receta &&
      receta.rendimiento > 0 &&
      Array.isArray(receta.ingredientes) &&
      receta.ingredientes.length > 0,
    "Producto sin receta valida",
  );
  const lote = centavos(cantidad);
  const rendimiento = centavos(receta.rendimiento),
    seen = new Set();
  return receta.ingredientes.map((d) => {
    const ingredienteId = id(d.ingredienteId);
    exigir(!seen.has(ingredienteId), "Ingrediente duplicado en receta");
    seen.add(ingredienteId);
    const q = (centavos(d.cantidad) * lote) / rendimiento;
    exigir(
      Math.abs(q - Math.round(q)) < 0.000001,
      "El lote pierde precision: ajusta la cantidad",
    );
    return { ingredienteId, cantidad: Math.round(q) / 100 };
  });
}
function descontar(stock, cantidad) {
  const before = Math.round(stock * 100),
    amount = centavos(cantidad);
  exigir(
    Number.isFinite(before) && before >= amount,
    "Inventario insuficiente",
  );
  return (before - amount) / 100;
}
module.exports = {
  ErrorNegocio,
  exigir,
  texto,
  id,
  centavos,
  detalles,
  perfil,
  gerente,
  autor,
  consumo,
  descontar,
};
