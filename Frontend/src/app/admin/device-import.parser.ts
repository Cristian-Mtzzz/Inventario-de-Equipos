// Interpreta la hoja de carga masiva de dispositivos.
//
// Formato esperado (las columnas pueden estar en cualquier orden):
//   No. | EQUIPO | MARCA | MODELO | SERIE | INVENTARIO
// EQUIPO es el tipo de dispositivo (Impresora, Laptop, CPU, ...); el componente lo
// compara después con el catálogo de tipos. Cuando un mismo "No." reúne exactamente un
// CPU, un teclado y un monitor se registran como combo de computadora de escritorio; el
// resto de filas son dispositivos individuales. Las filas sin marca, modelo, serie ni
// inventario (por ejemplo una UPS vacía dentro de un combo) se ignoran.
// Número de ingreso NNNNN-MM-AAAA: cada tipo lleva su propia numeración. Los combos usan
// su No. del Excel (sus tres componentes comparten el número) y los dispositivos
// individuales se numeran 1, 2, 3... por tipo en el orden del archivo.
// Empleado, fecha de asignación y área no vienen en el archivo: se asignan después.

export type ComboComponentName = 'CPU' | 'TECLADO' | 'MONITOR';

export interface ImportRow {
  rowNumber: number;
  comboNo: string;
  // Tipo tal como está escrito en el archivo y su forma normalizada para compararlo.
  equipo: string;
  equipoKey: string;
  marca: string;
  modelo: string;
  serie: string;
  inventario: string;
}

export interface ImportItem {
  kind: 'combo' | 'device';
  comboNo: string;
  rows: ImportRow[];
  errors: string[];
  // Número dentro de su tipo (combo: No. del Excel); null si no se pudo determinar.
  number: number | null;
}

export interface ImportParseResult {
  items: ImportItem[];
  // Problemas que impiden leer el archivo (encabezados, archivo vacío).
  fileErrors: string[];
}

const REQUIRED_HEADERS = ['EQUIPO', 'MARCA', 'MODELO', 'SERIE', 'INVENTARIO'] as const;
type HeaderName = (typeof REQUIRED_HEADERS)[number] | 'NO';
const COMBO_COMPONENTS: ComboComponentName[] = ['CPU', 'TECLADO', 'MONITOR'];
export const DESKTOP_TYPE_KEY = 'COMPUTADORAESCRITORIO';
const HEADER_SEARCH_ROWS = 20;

// Número de ingreso NNNNN-MM-AAAA: número del equipo con 5 dígitos, mes y año de ingreso.
// Ejemplo: formatIngresoNumber(1, 1, 2026) -> '00001-01-2026'.
export function formatIngresoNumber(number: number, month: number, year: number): string {
  return `${String(number).padStart(5, '0')}-${String(month).padStart(2, '0')}-${year}`;
}

// Mayúsculas, sin tildes, espacios ni signos: "Cámara Web" -> "CAMARAWEB", "No." -> "NO".
export function normalizeKey(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function findHeader(rows: string[][]): { index: number; columns: Partial<Record<HeaderName, number>> } | null {
  for (let index = 0; index < Math.min(rows.length, HEADER_SEARCH_ROWS); index++) {
    const normalized = (rows[index] ?? []).map(normalizeKey);
    const columnOf = (...names: string[]) => normalized.findIndex((cell) => names.includes(cell));
    if (REQUIRED_HEADERS.some((header) => columnOf(header) < 0)) continue;

    const columns: Partial<Record<HeaderName, number>> = {};
    REQUIRED_HEADERS.forEach((header) => columns[header] = columnOf(header));
    const comboColumn = columnOf('NO', 'NUMERO', 'NCOMBO', 'COMBO');
    if (comboColumn >= 0) columns.NO = comboColumn;
    return { index, columns };
  }
  return null;
}

const hasData = (row: ImportRow) => [row.marca, row.modelo, row.serie, row.inventario].some(Boolean);

function rowErrors(row: ImportRow): string[] {
  const label = `${row.equipo || 'Fila'} (fila ${row.rowNumber})`;
  const missing = [
    !row.equipo && 'tipo de equipo',
    !row.marca && 'marca',
    !row.modelo && 'modelo',
    !row.serie && 'serie',
    !row.inventario && 'inventario',
  ].filter(Boolean);
  const errors = missing.length > 0 ? [`${label}: falta ${missing.join(', ')}.`] : [];
  if (row.inventario && !/^\d{1,7}$/.test(row.inventario)) {
    errors.push(`${label}: el inventario debe ser numérico y de máximo 7 dígitos.`);
  }
  return errors;
}

function deviceItem(row: ImportRow): ImportItem {
  const errors = rowErrors(row);
  if (row.equipoKey === DESKTOP_TYPE_KEY) {
    errors.push(`${row.equipo} (fila ${row.rowNumber}): una computadora de escritorio se registra como combo con CPU, teclado y monitor bajo el mismo No.`);
  }
  return { kind: 'device', comboNo: row.comboNo, rows: [row], errors, number: null };
}

// Separa un grupo con el mismo No. en un combo (si tiene CPU, teclado y monitor) y
// dispositivos individuales.
function splitGroup(comboNo: string, rows: ImportRow[]): ImportItem[] {
  const isComponent = (row: ImportRow) => COMBO_COMPONENTS.includes(row.equipoKey as ComboComponentName);
  const counts = COMBO_COMPONENTS.map((component) => rows.filter((row) => row.equipoKey === component).length);
  if (counts.some((count) => count === 0)) return rows.map(deviceItem);

  const comboRows = rows.filter(isComponent);
  const errors = COMBO_COMPONENTS
    .flatMap((component, index) => counts[index] > 1
      ? [`El ${component.toLowerCase()} aparece ${counts[index]} veces en el combo.`]
      : [])
    .concat(comboRows.flatMap(rowErrors));
  return [
    { kind: 'combo', comboNo, rows: comboRows, errors, number: null },
    ...rows.filter((row) => !isComponent(row)).map(deviceItem),
  ];
}

// rows: valores de texto de cada fila de la hoja, empezando por la fila 1. Las celdas
// combinadas de "No." deben llegar con el número repetido en cada fila del bloque.
export function parseDeviceImport(rows: string[][]): ImportParseResult {
  const header = findHeader(rows);
  if (!header) {
    return {
      items: [],
      fileErrors: ['No se encontraron los encabezados EQUIPO, MARCA, MODELO, SERIE e INVENTARIO.'],
    };
  }

  const { columns } = header;
  const cell = (row: string[], name: HeaderName) => {
    const column = columns[name];
    return column === undefined ? '' : (row[column] ?? '').trim();
  };

  // Las filas con No. se agrupan conservando el orden del archivo; las demás van solas.
  const groups: { comboNo: string; rows: ImportRow[] }[] = [];
  const groupsByComboNo = new Map<string, { comboNo: string; rows: ImportRow[] }>();
  rows.slice(header.index + 1).forEach((values, offset) => {
    const equipo = cell(values ?? [], 'EQUIPO');
    const row: ImportRow = {
      rowNumber: header.index + offset + 2,
      comboNo: cell(values ?? [], 'NO'),
      equipo,
      equipoKey: normalizeKey(equipo),
      // Marca, modelo y serie se guardan en mayúsculas, igual que al escribirlos en los formularios.
      marca: cell(values ?? [], 'MARCA').toLocaleUpperCase('es'),
      modelo: cell(values ?? [], 'MODELO').toLocaleUpperCase('es'),
      serie: cell(values ?? [], 'SERIE').toLocaleUpperCase('es'),
      inventario: cell(values ?? [], 'INVENTARIO'),
    };
    if (!hasData(row)) return;

    const existing = row.comboNo ? groupsByComboNo.get(row.comboNo) : undefined;
    if (existing) {
      existing.rows.push(row);
      return;
    }
    const group = { comboNo: row.comboNo, rows: [row] };
    groups.push(group);
    if (row.comboNo) groupsByComboNo.set(row.comboNo, group);
  });

  const items = groups.flatMap((group) => group.comboNo
    ? splitGroup(group.comboNo, group.rows)
    : group.rows.map(deviceItem));

  // Numeración por tipo: el combo toma su No. (de 1 a 99999) y cada tipo de dispositivo
  // individual cuenta desde 1 en el orden del archivo.
  const nextNumberByType = new Map<string, number>();
  for (const item of items) {
    if (item.kind === 'combo') {
      const isValidNo = /^\d{1,5}$/.test(item.comboNo) && Number(item.comboNo) > 0;
      if (isValidNo) item.number = Number(item.comboNo);
      else item.errors.unshift(`El No. "${item.comboNo}" (fila ${item.rows[0].rowNumber}) debe ser un número de 1 a 99999.`);
      continue;
    }
    const typeKey = item.rows[0].equipoKey;
    if (!typeKey) continue;
    item.number = (nextNumberByType.get(typeKey) ?? 0) + 1;
    nextNumberByType.set(typeKey, item.number);
  }

  // Un mismo inventario no puede repetirse dentro del archivo.
  const seen = new Map<string, number>();
  for (const item of items) {
    for (const row of item.rows) {
      if (!row.inventario) continue;
      const firstRow = seen.get(row.inventario);
      if (firstRow === undefined) seen.set(row.inventario, row.rowNumber);
      else item.errors.push(`El inventario ${row.inventario} (fila ${row.rowNumber}) ya aparece en la fila ${firstRow}.`);
    }
  }

  return { items, fileErrors: items.length === 0 ? ['El archivo no contiene equipos para importar.'] : [] };
}
