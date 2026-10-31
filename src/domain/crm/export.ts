/** CSV para planilhas, com escape de aspas e proteção contra fórmulas em dados externos. */
export function csvCell(value: unknown): string {
  let text = String(value ?? "").replace(/\r\n?/g, "\n");
  if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvLine(values: unknown[]): string {
  return `${values.map(csvCell).join(";")}\r\n`;
}
