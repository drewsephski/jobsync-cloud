import { createHash } from "node:crypto"
import { Worker } from "node:worker_threads"
import { validateDocx } from "./docx"
import { validatePdf } from "./pdf"
import { FileValidationError } from "./errors"
import { MAX_RESUME_FILE_SIZE_BYTES } from "./constants"
export const EXTRACT_MAX_CHARS = 40_000
export const EXTRACT_TIMEOUT_MS = 15_000
export const EXTRACTION_VERSION = "local-text-v1"
const docxSource = `
const {parentPort, workerData} = require('node:worker_threads');
console.log = console.warn = console.error = () => {};
(async () => {
 try {
  const {XMLParser} = await import(workerData.moduleUrl);
  const tree = new XMLParser({preserveOrder:true, ignoreAttributes:true, removeNSPrefix:true, processEntities:true, parseTagValue:false, trimValues:false}).parse(workerData.xml);
  let text = '';
  function add(value) { text += value; if (text.length > workerData.maxChars) throw Error('text_too_large'); }
  function walk(nodes) { for (const node of nodes) for (const [key,value] of Object.entries(node)) {
   if (['del','instrText','delText'].includes(key)) continue;
   if (key === 't') { for (const item of value) if (typeof item['#text'] === 'string') add(item['#text']); }
   else if (key === 'tab') add('\\t');
   if (key !== 't' && Array.isArray(value)) walk(value);
   if (key === 'p' || key === 'br' || key === 'cr') add('\\n');
  }}
  walk(tree); parentPort.postMessage({text});
 } catch (error) { parentPort.postMessage({code:error.message === 'text_too_large' ? 'text_too_large' : 'invalid_docx'}); }
})();`
async function extractDocx(bytes: Buffer) {
  const xml = validateDocx(bytes, true)
  const worker = new Worker(docxSource, {
    eval: true,
    workerData: {
      xml,
      maxChars: EXTRACT_MAX_CHARS,
      moduleUrl: import.meta.resolve("fast-xml-parser"),
    },
    resourceLimits: {
      maxOldGenerationSizeMb: 128,
      maxYoungGenerationSizeMb: 16,
    },
    execArgv: [],
    env: {},
    stdout: true,
    stderr: true,
  })
  worker.stdout?.resume()
  worker.stderr?.resume()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<string>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new FileValidationError("extraction_timeout")),
        EXTRACT_TIMEOUT_MS
      )
      worker.once("message", (message: { text?: string; code?: string }) =>
        typeof message.text === "string"
          ? resolve(message.text)
          : reject(new FileValidationError(message.code ?? "invalid_docx"))
      )
      worker.once("error", () =>
        reject(new FileValidationError("invalid_docx"))
      )
      worker.once("exit", () => reject(new FileValidationError("invalid_docx")))
    })
  } finally {
    clearTimeout(timer)
    await worker.terminate()
  }
}
export async function extractResumeText(
  bytes: Buffer,
  format: "pdf" | "docx",
  expectedHash: string
) {
  if (!bytes.length || bytes.length > MAX_RESUME_FILE_SIZE_BYTES)
    throw new FileValidationError("invalid_object_size")
  if (createHash("sha256").update(bytes).digest("hex") !== expectedHash)
    throw new FileValidationError("source_hash_mismatch")
  const raw =
    format === "pdf"
      ? await validatePdf(bytes, EXTRACT_TIMEOUT_MS, true, EXTRACT_MAX_CHARS)
      : await extractDocx(bytes)
  if (typeof raw !== "string" || raw.length > EXTRACT_MAX_CHARS)
    throw new FileValidationError("text_too_large")
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim()
  if (text.length < 20) throw new FileValidationError("no_extractable_text")
  return text
}
