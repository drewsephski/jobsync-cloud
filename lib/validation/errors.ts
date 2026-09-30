export class FileValidationError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}
