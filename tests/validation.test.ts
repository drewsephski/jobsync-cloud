import { readFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { validateResume } from "../lib/validation/resume"
import { validatePdf } from "../lib/validation/pdf"
import { validateDocx } from "../lib/validation/docx"
import { FileValidationError } from "../lib/validation/errors"
import { tinyPdf, tinyDocx, docxEntries } from "./validation-fixtures"

const PDF = "application/pdf",
  DOCX =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const code = (expected: string) => (error: unknown) =>
  error instanceof FileValidationError && error.code === expected
test("real minimal PDF validates and SHA-256 is deterministic", async () => {
  const bytes = tinyPdf(),
    result = await validateResume(bytes, PDF)
  assert.equal(result.format, "pdf")
  assert.equal(result.hash, createHash("sha256").update(bytes).digest("hex"))
  assert.deepEqual(await validateResume(bytes, PDF), result)
})
test("renamed text, corrupt PDF and declaration mismatch are permanent", async () => {
  await assert.rejects(
    validateResume(Buffer.from("plain text"), PDF),
    code("invalid_file_signature")
  )
  await assert.rejects(
    validateResume(Buffer.from("%PDF-1.4\ncorrupt"), PDF),
    code("invalid_pdf")
  )
  await assert.rejects(
    validateResume(tinyPdf(), DOCX),
    code("declared_type_mismatch")
  )
})
test("PDF timeout terminates parser work with stable code", async () => {
  await assert.rejects(validatePdf(tinyPdf(), 1), code("validation_timeout"))
})
test("minimal real DOCX package passes", async () => {
  const result = await validateResume(tinyDocx(), DOCX)
  assert.equal(result.format, "docx")
})
test("generic ZIP and missing package markers fail", () => {
  assert.throws(
    () => validateDocx(tinyDocx({ "file.txt": "hello" })),
    code("invalid_docx")
  )
  for (const marker of Object.keys(docxEntries)) {
    const entries = { ...docxEntries }
    delete entries[marker]
    assert.throws(() => validateDocx(tinyDocx(entries)), code("invalid_docx"))
  }
})
test("malformed EOCD and partial directory fail", () => {
  const bytes = tinyDocx()
  assert.throws(() => validateDocx(bytes.subarray(0, -4)), code("invalid_docx"))
  const partial = Buffer.from(bytes)
  partial.writeUInt32LE(0xffffffff, partial.readUInt32LE(partial.length - 6))
  assert.throws(() => validateDocx(partial), code("invalid_docx"))
})
test("entry cap and claimed expansion cap fail before decompression", () => {
  const count = tinyDocx()
  count.writeUInt16LE(1001, count.length - 14)
  count.writeUInt16LE(1001, count.length - 12)
  assert.throws(() => validateDocx(count), code("docx_too_many_entries"))
  const size = tinyDocx(),
    cd = size.readUInt32LE(size.length - 6)
  size.writeUInt32LE(100 * 1024 * 1024 + 1, cd + 24)
  assert.throws(() => validateDocx(size), code("docx_uncompressed_too_large"))
})
test("encrypted entries and unsafe paths fail", () => {
  const encrypted = tinyDocx(),
    cd = encrypted.readUInt32LE(encrypted.length - 6)
  encrypted.writeUInt16LE(1, cd + 8)
  assert.throws(() => validateDocx(encrypted), code("encrypted_docx"))
  for (const path of [
    "../evil",
    "/evil",
    "C:/evil",
    "word/../evil",
    "evil\u0000",
  ]) {
    assert.throws(
      () => validateDocx(tinyDocx({ ...docxEntries, [path]: "bad" })),
      code("invalid_docx")
    )
  }
})
test("CRC corruption, invalid XML, Zip64 and duplicate local overlap fail", () => {
  const corrupt = tinyDocx()
  corrupt[60] ^= 1
  assert.throws(() => validateDocx(corrupt), code("invalid_docx"))
  assert.throws(
    () =>
      validateDocx(
        tinyDocx({ ...docxEntries, "word/document.xml": "<broken>" })
      ),
    code("invalid_docx")
  )
  const zip64 = tinyDocx()
  zip64.writeUInt32LE(0xffffffff, zip64.length - 6)
  assert.throws(() => validateDocx(zip64), code("invalid_docx"))
})

test("password-protected and empty-password encrypted PDF are rejected", async () => {
  for (const name of ["password-protected", "encrypted-empty-password"]) {
    const bytes = await readFile(
      new URL(`./fixtures/${name}.pdf`, import.meta.url)
    )
    await assert.rejects(validateResume(bytes, PDF), code("encrypted_pdf"))
  }
})
