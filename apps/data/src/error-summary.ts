export interface ErrorSummary {
  name: string;
  message: string;
  causes?: string[];
}

export function summarizeError(error: unknown): ErrorSummary {
  const causes: string[] = [];
  let current: unknown = error instanceof Error ? error.cause : undefined;
  while (current instanceof Error && causes.length < 3) {
    causes.push(`${current.name}: ${current.message}`);
    current = current.cause;
  }
  const summary: ErrorSummary = error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
  return causes.length === 0 ? summary : { ...summary, causes };
}
