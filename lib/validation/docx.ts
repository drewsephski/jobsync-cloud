import { inflateRawSync } from "node:zlib"
import { XMLParser, XMLValidator } from "fast-xml-parser"
import {
  DOCX_MAX_ENTRIES,
  DOCX_MAX_UNCOMPRESSED_BYTES,
  DOCX_MAX_XML_BYTES,
} from "./constants"
import { FileValidationError } from "./errors"

// Classic, single-disk ZIP only. No extraction, filesystem paths or Zip64.
export function validateDocx(bytes: Buffer, documentOnly = false) {
  const invalid = () => {
    throw new FileValidationError("invalid_docx")
  }
  const u16 = (offset: number) => bytes.readUInt16LE(offset)
  const u32 = (offset: number) => bytes.readUInt32LE(offset)
  if (bytes.length < 22 || u32(0) !== 0x04034b50) invalid()
  let eocd = -1
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 65_557);
    i--
  ) {
    if (u32(i) === 0x06054b50 && i + 22 + u16(i + 20) === bytes.length) {
      eocd = i
      break
    }
  }
  if (eocd < 0) invalid()
  const count = u16(eocd + 10)
  const cdSize = u32(eocd + 12)
  const cdOffset = u32(eocd + 16)
  if (
    u16(eocd + 4) ||
    u16(eocd + 6) ||
    u16(eocd + 8) !== count ||
    count === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff ||
    cdOffset + cdSize !== eocd ||
    !count
  )
    invalid()
  if (count > DOCX_MAX_ENTRIES)
    throw new FileValidationError("docx_too_many_entries")
  const names = new Set<string>()
  const entries: Array<{
    name: string
    method: number
    compressed: number
    uncompressed: number
    dataOffset: number
    crc: number
  }> = []
  const ranges: Array<[number, number]> = []
  let cursor = cdOffset
  let total = 0
  for (let entry = 0; entry < count; entry++) {
    if (cursor + 46 > eocd || u32(cursor) !== 0x02014b50) invalid()
    const flags = u16(cursor + 8)
    const method = u16(cursor + 10)
    const compressed = u32(cursor + 20)
    const uncompressed = u32(cursor + 24)
    const nameLength = u16(cursor + 28)
    const extraLength = u16(cursor + 30)
    const commentLength = u16(cursor + 32)
    const localOffset = u32(cursor + 42)
    const next = cursor + 46 + nameLength + extraLength + commentLength
    if (
      next > eocd ||
      !nameLength ||
      u16(cursor + 34) ||
      compressed === 0xffffffff ||
      uncompressed === 0xffffffff ||
      localOffset === 0xffffffff
    )
      invalid()
    if (flags & 0x41) throw new FileValidationError("encrypted_docx")
    // Only deflate/store, UTF-8, data descriptors and normal deflate options.
    if (flags & ~0x080e || (method !== 0 && method !== 8)) invalid()
    total += uncompressed
    if (total > DOCX_MAX_UNCOMPRESSED_BYTES)
      throw new FileValidationError("docx_uncompressed_too_large")
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength)
    let name: string
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(rawName)
    } catch {
      return invalid()
    }
    if (
      /[\\\u0000-\u001f\u007f]/.test(name) ||
      name.startsWith("/") ||
      /^[a-z]:/i.test(name) ||
      name.split("/").some((part) => part === ".." || part === ".") ||
      names.has(name)
    )
      invalid()
    names.add(name)
    // Reject Zip64 and malformed extra-field TLVs.
    for (
      let extra = cursor + 46 + nameLength;
      extra < cursor + 46 + nameLength + extraLength;
    ) {
      if (extra + 4 > cursor + 46 + nameLength + extraLength) invalid()
      const tag = u16(extra),
        size = u16(extra + 2)
      if (
        tag === 1 ||
        extra + 4 + size > cursor + 46 + nameLength + extraLength
      )
        invalid()
      extra += 4 + size
    }
    if (localOffset + 30 > cdOffset || u32(localOffset) !== 0x04034b50)
      invalid()
    if (u16(cursor + 6) > 20 || u16(localOffset + 4) > 20) invalid()
    const localNameLength = u16(localOffset + 26)
    const localExtraLength = u16(localOffset + 28)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength
    if (
      dataOffset + compressed > cdOffset ||
      localNameLength !== nameLength ||
      !bytes
        .subarray(localOffset + 30, localOffset + 30 + localNameLength)
        .equals(rawName) ||
      u16(localOffset + 6) !== flags ||
      u16(localOffset + 8) !== method
    )
      invalid()
    for (let extra = localOffset + 30 + localNameLength; extra < dataOffset;) {
      if (extra + 4 > dataOffset) invalid()
      const tag = u16(extra),
        size = u16(extra + 2)
      if (tag === 1 || extra + 4 + size > dataOffset) invalid()
      extra += 4 + size
    }
    if (
      !(flags & 8) &&
      (u32(localOffset + 18) !== compressed ||
        u32(localOffset + 22) !== uncompressed ||
        u32(localOffset + 14) !== u32(cursor + 16))
    )
      invalid()
    if (method === 0 && compressed !== uncompressed) invalid()
    // Include descriptors in the non-overlap check.
    let end = dataOffset + compressed
    if (flags & 8) {
      const descriptor = end
      if (end + 12 > cdOffset) invalid()
      if (u32(end) === 0x08074b50) end += 4
      if (
        end + 12 > cdOffset ||
        u32(end) !== u32(cursor + 16) ||
        u32(end + 4) !== compressed ||
        u32(end + 8) !== uncompressed
      )
        invalid()
      end += 12
      if (end <= descriptor) invalid()
    }
    entries.push({
      name,
      method,
      compressed,
      uncompressed,
      dataOffset,
      crc: u32(cursor + 16),
    })
    ranges.push([localOffset, end])
    if (
      ["[Content_Types].xml", "word/document.xml", "_rels/.rels"].includes(
        name
      ) &&
      (!uncompressed || uncompressed > DOCX_MAX_XML_BYTES)
    )
      invalid()
    cursor = next
  }
  if (cursor !== eocd) invalid()
  ranges.sort((a, b) => a[0] - b[0])
  if (
    ranges[0][0] !== 0 ||
    ranges.some((range, i) => i > 0 && range[0] < ranges[i - 1][1])
  )
    invalid()
  for (const marker of [
    "[Content_Types].xml",
    "word/document.xml",
    "_rels/.rels",
  ])
    if (!names.has(marker)) invalid()
  // Preflight finishes before any decompression. Enforce actual inflated lengths
  // and CRC as well as claimed totals; never allocate beyond the checked claim.
  const markers = new Map<string, string>()
  for (const entry of entries) {
    // Extraction runs only against a byte-for-byte hashed, validated upload.
    // Avoid expanding media a second time; retain full preflight bounds.
    if (
      documentOnly &&
      !["[Content_Types].xml", "word/document.xml", "_rels/.rels"].includes(
        entry.name
      )
    )
      continue
    const compressed = bytes.subarray(
      entry.dataOffset,
      entry.dataOffset + entry.compressed
    )
    let content: Buffer
    try {
      content =
        entry.method === 0
          ? compressed
          : inflateRawSync(compressed, {
              maxOutputLength: Math.max(1, entry.uncompressed),
            })
    } catch {
      return invalid()
    }
    if (content.length !== entry.uncompressed || crc32(content) !== entry.crc)
      invalid()
    if (
      ["[Content_Types].xml", "word/document.xml", "_rels/.rels"].includes(
        entry.name
      )
    ) {
      if (content.length > DOCX_MAX_XML_BYTES) invalid()
      let xml: string
      try {
        xml = new TextDecoder("utf-8", { fatal: true }).decode(content)
      } catch {
        return invalid()
      }
      if (
        /<!DOCTYPE|<!ENTITY/i.test(xml) ||
        XMLValidator.validate(xml) !== true
      )
        invalid()
      markers.set(entry.name, xml)
    }
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    removeNSPrefix: true,
  })
  const types = parser.parse(markers.get("[Content_Types].xml")!)
  const overrides = [types.Types?.Override].flat().filter(Boolean)
  if (
    !overrides.some(
      (item: Record<string, unknown>) =>
        item["@_PartName"] === "/word/document.xml" &&
        item["@_ContentType"] ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
    )
  )
    invalid()
  const document = parser.parse(markers.get("word/document.xml")!)
  if (!document.document || !("body" in document.document)) invalid()
  const relationships = parser.parse(markers.get("_rels/.rels")!)
  if (!relationships.Relationships) invalid()
  return markers.get("word/document.xml")!
}

// ZIP CRC-32 (IEEE); table built once, no archive libraries or filesystem writes.
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
export function crc32(bytes: Uint8Array) {
  let value = 0xffffffff
  for (const byte of bytes)
    value = crcTable[(value ^ byte) & 255] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}
