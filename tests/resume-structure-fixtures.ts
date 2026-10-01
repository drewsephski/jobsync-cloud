import { tinyDocx, docxEntries } from "./validation-fixtures"
import type { StructuredResume } from "../lib/ai/resume-schema"
export const sanitizedText = `Alex Example
alex@example.test
Chicago, IL
Software engineer building reliable systems.
Skills
TypeScript, PostgreSQL
Experience
Example Labs
Software Engineer
January 2022 - March 2025
Built reliable APIs.
Education
Example University
BS Computer Science
2018 - 2022
Certifications
Example Certificate
Example Institute
2023`
export const sanitizedResume: StructuredResume = {
  contact: {
    name: "Alex Example",
    email: "alex@example.test",
    phone: null,
    location: "Chicago, IL",
    links: [],
  },
  summary: "Software engineer building reliable systems.",
  skills: ["TypeScript", "PostgreSQL"],
  employment: [
    {
      employer: "Example Labs",
      title: "Software Engineer",
      location: null,
      startDate: "January 2022",
      endDate: "March 2025",
      highlights: ["Built reliable APIs."],
      evidence:
        "Example Labs\nSoftware Engineer\nJanuary 2022 - March 2025\nBuilt reliable APIs.",
    },
  ],
  education: [
    {
      institution: "Example University",
      qualification: "BS Computer Science",
      field: null,
      startDate: "2018",
      endDate: "2022",
      evidence: "Example University\nBS Computer Science\n2018 - 2022",
    },
  ],
  credentials: [
    {
      name: "Example Certificate",
      issuer: "Example Institute",
      date: "2023",
      evidence: "Example Certificate\nExample Institute\n2023",
    },
  ],
}
export function resumeDocx(text = sanitizedText) {
  const escape = (line: string) =>
    line
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
  return tinyDocx({
    ...docxEntries,
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text
      .split("\n")
      .map((line) => `<w:p><w:r><w:t>${escape(line)}</w:t></w:r></w:p>`)
      .join("")}</w:body></w:document>`,
  })
}
export function resumePdf(text = sanitizedText) {
  const escape = (line: string) =>
    line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")
  const stream = `BT /F1 10 Tf 20 750 Td 12 TL ${text
    .split("\n")
    .map((line, i) => `${i ? "T* " : ""}(${escape(line)}) Tj`)
    .join("\n")} ET`
  const bodies = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  const parts = ["%PDF-1.4\n"],
    offsets = [0]
  bodies.forEach((body, index) => {
    offsets.push(Buffer.byteLength(parts.join("")))
    parts.push(`${index + 1} 0 obj\n${body}\nendobj\n`)
  })
  const xref = Buffer.byteLength(parts.join(""))
  parts.push(`xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`)
  offsets
    .slice(1)
    .forEach((offset) =>
      parts.push(`${String(offset).padStart(10, "0")} 00000 n \n`)
    )
  parts.push(
    `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  )
  return Buffer.from(parts.join(""))
}
