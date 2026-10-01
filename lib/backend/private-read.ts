/** Avoid forwarding database/provider messages into Next's default error log. */
export async function privateRead<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch {
    throw new Error("workspace_unavailable")
  }
}
