import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { test } from "node:test"
import { extractResumeText, EXTRACT_MAX_CHARS } from "../lib/validation/extract"
import { validateResume } from "../lib/validation/resume"
import {
  resumeDocx,
  resumePdf,
  sanitizedText,
} from "./resume-structure-fixtures"
import { tinyPdf, tinyDocx, docxEntries } from "./validation-fixtures"
import { validatePdf } from "../lib/validation/pdf"
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
for (const [format, bytes] of [
  ["pdf", resumePdf()],
  ["docx", resumeDocx()],
] as const) {
  test(`${format}: deterministic ordered text and source integrity`, async () => {
    const validated = await validateResume(
      bytes,
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    const text = await extractResumeText(bytes, format, validated.hash)
    assert.equal(text.replace(/\s+/g, " "), sanitizedText.replace(/\s+/g, " "))
    assert.equal(await extractResumeText(bytes, format, hash(bytes)), text)
    await assert.rejects(extractResumeText(bytes, format, "0".repeat(64)), {
      message: "source_hash_mismatch",
    })
  })
  test(`${format}: blank documents fail, no OCR`, async () => {
    const blank = format === "pdf" ? tinyPdf() : tinyDocx()
    await assert.rejects(extractResumeText(blank, format, hash(blank)), {
      message: "no_extractable_text",
    })
  })
  test(`${format}: excessive text is rejected, never silently truncated`, async () => {
    const large =
      format === "pdf"
        ? resumePdf("x".repeat(EXTRACT_MAX_CHARS + 1))
        : resumeDocx("x".repeat(EXTRACT_MAX_CHARS + 1))
    await assert.rejects(
      format === "pdf"
        ? validatePdf(resumePdf(), 15_000, true, 20)
        : extractResumeText(large, format, hash(large)),
      {
        message: "text_too_large",
      }
    )
  })
}
test("DOCX preserves text/entities/tables and ignores deleted text and field instructions", async () => {
  const bytes = tinyDocx({
    ...docxEntries,
    "word/_rels/document.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/profile" TargetMode="External"/></Relationships>',
    "word/document.xml":
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>Alex &amp; Example</w:t><w:tab/><w:t>Resume</w:t></w:r><w:hyperlink r:id="rIdExternal"><w:r><w:t>Portfolio</w:t></w:r></w:hyperlink><w:del><w:r><w:delText>Invented Employer</w:delText></w:r></w:del><w:instrText>malicious instructions</w:instrText></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>TypeScript</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
  })
  const text = await extractResumeText(bytes, "docx", hash(bytes))
  assert.equal(text, "Alex & Example\tResumePortfolio\n\nTypeScript")
  assert.equal(text.includes("example.invalid"), false)
})
test("PDF extraction has a terminable deadline", async () => {
  await assert.rejects(validatePdf(resumePdf(), 1, true), {
    message: "validation_timeout",
  })
})
