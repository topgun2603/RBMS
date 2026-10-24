import ExcelJS from "exceljs";

/** A cell as the text a person would see: dates become YYYY-MM-DD, formulas their result, rich text plain text. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)));
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((r) => r.text).join("");
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as { result?: ExcelJS.CellValue }).result;
      return result === undefined || (typeof result === "object" && result !== null && "error" in result) ? "" : cellText(result);
    }
    if ("hyperlink" in value && "text" in value) return String((value as { text: unknown }).text ?? "");
    if ("error" in value) return "";
  }
  return String(value);
}

export class XlsxError extends Error {}

/** Every worksheet of a workbook as rows of cell text (trailing empty cells trimmed), at most `maxRows` rows per sheet. */
export async function readWorkbook(data: Buffer | Uint8Array, maxRows = 50_000): Promise<Record<string, string[][]>> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ExcelJS.Buffer);
  } catch {
    throw new XlsxError("This file is not a valid .xlsx workbook");
  }
  const out: Record<string, string[][]> = {};
  for (const ws of wb.worksheets) {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= maxRows) return;
      const cells: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) cells.push(cellText(row.getCell(c).value).trim());
      while (cells.length && cells[cells.length - 1] === "") cells.pop();
      if (cells.length) rows.push(cells);
    });
    out[ws.name] = rows;
  }
  return out;
}
