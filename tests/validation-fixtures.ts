import { crc32 } from "../lib/validation/docx"

export function tinyPdf() {
  const parts = ["%PDF-1.4\n"]
  const offsets = [0]
  for (const [id, body] of [
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [
      3,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Contents 4 0 R /Resources << >> >>",
    ],
    [4, "<< /Length 0 >>\nstream\n\nendstream"],
  ] as const) {
    offsets[id] = Buffer.byteLength(parts.join(""), "ascii")
    parts.push(`${id} 0 obj\n${body}\nendobj\n`)
  }
  const xref = Buffer.byteLength(parts.join(""), "ascii")
  parts.push("xref\n0 5\n0000000000 65535 f \n")
  for (let id = 1; id <= 4; id++)
    parts.push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`)
  parts.push(`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return Buffer.from(parts.join(""), "ascii")
}
export const docxEntries: Record<string, string> = {
  "[Content_Types].xml":
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  "_rels/.rels":
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  "word/document.xml":
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>',
}
export function tinyDocx(entries = docxEntries) {
  const locals: Buffer[] = [],
    central: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(entries)) {
    const filename = Buffer.from(name),
      data = Buffer.from(text),
      crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(filename.length, 26)
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(filename.length, 28)
    cd.writeUInt32LE(offset, 42)
    locals.push(local, filename, data)
    central.push(cd, filename)
    offset += local.length + filename.length + data.length
  }
  const directory = Buffer.concat(central),
    eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50)
  eocd.writeUInt16LE(central.length / 2, 8)
  eocd.writeUInt16LE(central.length / 2, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, eocd])
}
