import { Worker } from "node:worker_threads"
import { PDF_MAX_PAGES, PDF_TIMEOUT_MS } from "./constants"
import { FileValidationError } from "./errors"

// The external unpdf package is staged beside the Neon bundle. The worker has
// no DB/storage access; all messages are sanitized codes. Termination bounds CPU.
const parserSource = `
const { parentPort, workerData } = require("node:worker_threads");
console.log = console.warn = console.error = () => {};
(async () => {
  let document;
  try {
    const { getDocumentProxy } = await import(workerData.moduleUrl).catch(() => { throw { name: "ParserUnavailable" }; });
    document = await getDocumentProxy(new Uint8Array(workerData.bytes), {
      stopAtErrors: true, isEvalSupported: false, verbosity: 0,
    });
    if (await document.getPermissions() !== null) throw { name: "PasswordException" };
    if (!document.numPages || document.numPages > workerData.maxPages) throw { name: "InvalidPDFException" };
    let text = "";
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      await page.getOperatorList();
      if (workerData.extract) {
        const content = await page.getTextContent();
        for (const item of content.items) {
          if (typeof item.str === "string") text += item.str + (item.hasEOL ? "\\n" : " ");
          if (text.length > workerData.maxChars) throw { name: "TextLimit" };
        }
        text += "\\n";
      }
      page.cleanup();
    }
    parentPort.postMessage(workerData.extract ? { text } : null);
  } catch (error) {
    parentPort.postMessage(error?.name === "ParserUnavailable" ? "parser_unavailable" : error?.name === "TextLimit" ? "text_too_large" : error?.name === "PasswordException" ? "encrypted_pdf" : "invalid_pdf");
  } finally {
    if (document) await document.destroy().catch(() => {});
  }
})();
`
export async function validatePdf(
  bytes: Buffer,
  timeoutMs = PDF_TIMEOUT_MS,
  extract = false,
  maxChars = 40_000
) {
  const worker = new Worker(parserSource, {
    eval: true,
    workerData: {
      bytes,
      extract,
      maxChars,
      maxPages: PDF_MAX_PAGES,
      moduleUrl: import.meta.resolve("unpdf"),
    },
    resourceLimits: {
      maxOldGenerationSizeMb: 256,
      maxYoungGenerationSizeMb: 32,
    },
    // Do not inherit tsx/Next runtime hooks or unrelated secrets.
    execArgv: [],
    env: {},
    stdout: true,
    stderr: true,
  })
  worker.stdout?.resume()
  worker.stderr?.resume()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<string | void>((resolve, reject) => {
      timer = setTimeout(
        () => reject(new FileValidationError("validation_timeout")),
        timeoutMs
      )
      worker.once("message", (code: unknown) =>
        typeof code === "object" &&
        code !== null &&
        "text" in code &&
        typeof code.text === "string"
          ? resolve(code.text)
          : code === null
            ? resolve()
            : code === "parser_unavailable"
              ? reject(new Error("parser_unavailable"))
              : reject(
                  new FileValidationError(
                    code === "encrypted_pdf" || code === "text_too_large"
                      ? code
                      : "invalid_pdf"
                  )
                )
      )
      worker.once("error", () => reject(new FileValidationError("invalid_pdf")))
      worker.once("exit", () => reject(new FileValidationError("invalid_pdf")))
    })
  } finally {
    clearTimeout(timer)
    await worker.terminate()
  }
}
