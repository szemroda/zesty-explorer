import { strToU8, zipSync } from 'fflate';
import type { ContentScope } from '../domain';
import type { ExportCell, ExportTable } from './table-export';

export type ExportFormat = 'csv' | 'xlsx' | 'json';

export interface ExportFile {
  readonly name: string;
  readonly blob: Blob;
}

/** Writes `table` about `subject`, e.g. a collection name, as `<baseName>.<format>`. */
export function exportFile(
  table: ExportTable,
  format: ExportFormat,
  subject: string,
  baseName: string,
): ExportFile {
  const name = `${baseName}.${format}`;
  if (format === 'csv') return { name, blob: new Blob([csvText(table)], { type: 'text/csv' }) };
  if (format === 'json') {
    return { name, blob: new Blob([jsonText(table)], { type: 'application/json' }) };
  }
  // A copy, because Blob takes only bytes backed by a plain ArrayBuffer.
  return { name, blob: new Blob([new Uint8Array(xlsxBytes(table, subject))], { type: xlsxType }) };
}

/** `articles_latest_en-us_2026-11-19`: what was exported, from which content, and when. */
export function exportBaseName(subject: string, scope: ContentScope, date: Date): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  // The user's own calendar day; the Swedish locale writes it as YYYY-MM-DD.
  const day = date.toLocaleDateString('sv-SE');
  return [slug(subject) || 'export', scope.state, slug(scope.language), day].join('_');
}

export function saveFile(file: ExportFile): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  // The download starts from the click; the URL is no longer needed after this task.
  window.setTimeout(() => URL.revokeObjectURL(url));
}

// A spreadsheet runs a cell that starts with one of these as a formula.
const formulaStart = /^[=+\-@\t\r]/;

export function csvText(table: ExportTable): string {
  const cell = (value: ExportCell) => {
    if (value === null) return '';
    if (typeof value === 'number') return String(value);
    const text = formulaStart.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [table.headers, ...table.rows].map((row) => row.map(cell).join(','));
  // The byte order mark makes Excel read the file as UTF-8.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** One object per row, keyed by column header. */
export function jsonText(table: ExportTable): string {
  const records = table.rows.map((row) =>
    Object.fromEntries(table.headers.map((header, index) => [header, row[index] ?? null])),
  );
  return `${JSON.stringify(records, null, 2)}\n`;
}

const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const packageNs = 'http://schemas.openxmlformats.org/package/2006';
const relationshipsNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const sheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

// Rows below the header that one Excel sheet can hold.
const sheetRowLimit = 1_048_575;

/** A one-sheet workbook with a bold, frozen header row. */
export function xlsxBytes(table: ExportTable, sheetName: string): Uint8Array {
  if (table.rows.length > sheetRowLimit) {
    throw new Error(
      `Excel holds at most ${sheetRowLimit.toLocaleString('en-US')} rows, and this file has ${table.rows.length.toLocaleString('en-US')}`,
    );
  }
  // Excel refuses sheet names over 31 characters or with any of []:*?/\
  const name =
    sheetName
      .replace(/[[\]:*?/\\]/g, ' ')
      .trim()
      .slice(0, 31) || 'Export';
  const parts: Record<string, string> = {
    '[Content_Types].xml': `${declaration}<Types xmlns="${packageNs}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    '_rels/.rels': `${declaration}<Relationships xmlns="${packageNs}/relationships"><Relationship Id="rId1" Type="${relationshipsNs}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${declaration}<workbook xmlns="${sheetNs}" xmlns:r="${relationshipsNs}"><sheets><sheet name="${xmlText(name).replaceAll('"', '&quot;')}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${declaration}<Relationships xmlns="${packageNs}/relationships"><Relationship Id="rId1" Type="${relationshipsNs}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relationshipsNs}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `${declaration}<styleSheet xmlns="${sheetNs}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    'xl/worksheets/sheet1.xml': sheetXml(table),
  };
  return zipSync(
    Object.fromEntries(Object.entries(parts).map(([path, text]) => [path, strToU8(text)])),
  );
}

const cellLimit = 32_767;

function sheetXml(table: ExportTable): string {
  const cell = (value: ExportCell, column: number, row: number, style = '') => {
    if (value === null) return '';
    const ref = `${columnLetters(column)}${row}`;
    if (typeof value === 'number') return `<c r="${ref}"${style}><v>${value}</v></c>`;
    // Excel reports a workbook with a longer cell as corrupt.
    const text = value.length > cellLimit ? `${value.slice(0, cellLimit - 1)}…` : value;
    return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
  };
  const row = (cells: readonly ExportCell[], number: number, style?: string) =>
    `<row r="${number}">${cells.map((value, column) => cell(value, column, number, style)).join('')}</row>`;
  const widths = table.headers
    .map((header, column) => {
      // The first rows are enough to size a column; reading every row costs time on large files.
      const longest = table.rows
        .slice(0, 200)
        .reduce((max, cells) => Math.max(max, String(cells[column] ?? '').length), header.length);
      const width = Math.min(60, Math.max(10, longest + 2));
      return `<col min="${column + 1}" max="${column + 1}" width="${width}" customWidth="1"/>`;
    })
    .join('');
  return [
    `${declaration}<worksheet xmlns="${sheetNs}">`,
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    widths ? `<cols>${widths}</cols>` : '',
    `<sheetData>${row(table.headers, 1, ' s="1"')}`,
    ...table.rows.map((cells, index) => row(cells, index + 2)),
    '</sheetData></worksheet>',
  ].join('');
}

// A, B, ... Z, AA, AB, ...
function columnLetters(index: number): string {
  let letters = '';
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }
  return letters;
}

function xmlText(value: string): string {
  return (
    value
      // XML 1.0 cannot carry these control characters at all.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
  );
}
