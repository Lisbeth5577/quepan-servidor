"use strict";
// XLSX (Office Open XML): se entrega un libro real, sin macros ni fórmulas recibidas del usuario.
// Se usan únicamente las funciones ZIP/deflate de Node; no requiere instalar Excel en el servidor.
const { deflateRawSync } = require("node:zlib");
const xml = (s) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const chunks = [],
    central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name),
      raw = Buffer.from(text, "utf8"),
      data = deflateRawSync(raw),
      crc = crc32(raw),
      h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x800, 6);
    h.writeUInt16LE(8, 8);
    h.writeUInt16LE(33, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(data.length, 18);
    h.writeUInt32LE(raw.length, 22);
    h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(33, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    chunks.push(h, n, data);
    central.push(c, n);
    offset += h.length + n.length + data.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22),
    count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, end]);
}
function letra(col) {
  let s = "";
  for (let x = col + 1; x; x = Math.floor((x - 1) / 26))
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
const widths = [
  14, 12, 19, 34, 26, 20, 30, 18, 18, 18, 19, 15, 30, 14, 19, 20, 34, 28, 20,
  60, 26, 40, 23, 23, 12, 23, 30, 26,
];
function celda(v, col, row) {
  const r = letra(col) + row;
  if (row === 1)
    return `<c r="${r}" s="1" t="inlineStr"><is><t>${xml(v)}</t></is></c>`;
  if (v === "" || v == null) return "";
  if ((col === 0 || col === 15) && /^\d{4}-\d{2}-\d{2}$/.test(v))
    return `<c r="${r}" s="2"><v>${Date.parse(v + "T00:00:00Z") / 86400000 + 25569}</v></c>`;
  if (col === 1 && /^\d{2}:\d{2}:\d{2}$/.test(v)) {
    const [h, m, s] = v.split(":").map(Number);
    return `<c r="${r}" s="3"><v>${(h * 3600 + m * 60 + s) / 86400}</v></c>`;
  }
  if (typeof v === "number" && Number.isFinite(v))
    return `<c r="${r}" s="${col === 22 || col === 23 ? 4 : Number.isInteger(v) ? 7 : 4}"><v>${v}</v></c>`;
  return `<c r="${r}" s="${col === 13 && v === "C" ? 5 : row % 2 === 0 ? 6 : 0}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
}
async function crearExcel(reporte) {
  const tabla = reporte.tabla;
  if (!Array.isArray(tabla) || !tabla.length || tabla.length > 1048576)
    throw Error("Tabla no válida para Excel");
  const last = tabla.length,
    range = "A1:" + letra(tabla[0].length - 1) + last;
  const rows = tabla
    .map((row, i) => {
      const height =
        i === 0
          ? 44
          : Math.max(
              26,
              ...row.map((v, c) =>
                typeof v === "string"
                  ? String(v)
                      .split("\n")
                      .reduce(
                        (n, t) =>
                          n +
                          Math.max(
                            1,
                            Math.ceil(t.length / ((widths[c] || 20) - 2)),
                          ),
                        0,
                      ) *
                      12 +
                    12
                  : 26,
              ),
            );
      return `<row r="${i + 1}" ht="${Math.min(180, height)}" customHeight="1">${row.map((v, c) => celda(v, c, i + 1)).join("")}</row>`;
    })
    .join("");
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><dimension ref="${range}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="4" ySplit="1" topLeftCell="E2" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="E2" sqref="E2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="26"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${rows}${last === 1 ? '<row r="3"><c r="A3" t="inlineStr"><is><t>Sin actividad</t></is></c></row>' : ""}</sheetData><autoFilter ref="${range}"/><pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup orientation="landscape" paperSize="9"/></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${ns}"><numFmts count="3"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="hh:mm:ss"/><numFmt numFmtId="166" formatCode="#,##0.00"/></numFmts><fonts count="3"><font><sz val="10"/><color rgb="FF4C362C"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FF884B43"/><name val="Arial"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF49634F"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3DEDB"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF6F4EE"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" horizontal="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="center"/></xf><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="${rel}"><bookViews><workbookView/></bookViews><sheets><sheet name="Listado" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": styles,
    "xl/worksheets/sheet1.xml": worksheet,
  });
}
module.exports = { crearExcel, zip, crc32 };
