import { formatIngresoNumber, parseDeviceImport } from './device-import.parser';

describe('formatIngresoNumber', () => {
  it('arma el número NNNNN-MM-AAAA con el número, el mes y el año', () => {
    expect(formatIngresoNumber(1, 1, 2026)).toBe('00001-01-2026');
    expect(formatIngresoNumber(45, 11, 2025)).toBe('00045-11-2025');
    expect(formatIngresoNumber(99999, 12, 2026)).toBe('99999-12-2026');
  });
});

const HEADER = ['No.', 'EQUIPO', 'MARCA', 'MODELO', 'SERIE', 'INVENTARIO'];

// Reproduce el formato real: la celda combinada "No." llega repetida en cada fila del bloque.
const SAMPLE: string[][] = [
  HEADER,
  ['1', 'CPU', 'DELL', 'Pro Slim', '53RRMC4', '4126458'],
  ['1', 'Teclado', 'DELL', 'KB216-t1', 'VN-0RH4CV-LO00-55A-0CES-A00', '4126460'],
  ['1', 'Monitor', 'DELL', 'E2425HM', 'VN-0WRR7P-WS700-58S-AL6W', '4126459'],
  ['1', 'UPS', '', '', '', ''],
  ['3', 'CPU', 'DELL', 'Pro Slim', '8FCSMC4', '4126464'],
  ['3', 'Teclado', 'DELL', 'KB216-BK-LTN', '', '4126466'],
  ['3', 'Monitor', 'DELL', 'E2425HM', '', '4126465'],
  ['3', 'UPS', '', '', '', ''],
  ['', 'Escaner', 'Epson', 'DS-530', 'X5NZ001', '4127001'],
  ['40', 'Impresora', 'HP', 'M404', 'PHBQ1', '4127002'],
];

describe('parseDeviceImport', () => {
  it('forma combos con CPU, teclado y monitor, e importa el resto como dispositivos individuales', () => {
    const { items, fileErrors } = parseDeviceImport(SAMPLE);

    expect(fileErrors).toEqual([]);
    expect(items.map((item) => [item.kind, item.comboNo, item.rows.map((row) => row.equipo).join('+')])).toEqual([
      ['combo', '1', 'CPU+Teclado+Monitor'],
      ['combo', '3', 'CPU+Teclado+Monitor'],
      ['device', '', 'Escaner'],
      ['device', '40', 'Impresora'],
    ]);
    // El combo 3 tiene series vacías (se prueba aparte); los demás no tienen errores.
    expect([items[0], items[2], items[3]].map((item) => item.errors)).toEqual([[], [], []]);
  });

  it('numera cada tipo por separado: combos con su No. y el resto 1, 2, 3… por tipo', () => {
    const { items } = parseDeviceImport([
      HEADER,
      ['7', 'CPU', 'DELL', 'Pro Slim', 'C1', '1000001'],
      ['7', 'Teclado', 'DELL', 'KB', 'C2', '1000002'],
      ['7', 'Monitor', 'DELL', 'E24', 'C3', '1000003'],
      ['51', 'Escaner', 'Epson', 'DS-530', 'E1', '1000004'],
      ['52', 'Laptop', 'DELL', 'Latitude', 'L1', '1000005'],
      ['53', 'Escáner', 'Epson', 'DS-530', 'E2', '1000006'],
      ['', 'ESCANER', 'Epson', 'DS-530', 'E3', '1000007'],
      ['', 'Laptop', 'DELL', 'Latitude', 'L2', '1000008'],
    ]);

    expect(items.map((item) => [item.rows[0].equipo, item.number])).toEqual([
      ['CPU', 7],
      ['Escaner', 1], ['Laptop', 1], ['Escáner', 2], ['ESCANER', 3], ['Laptop', 2],
    ]);
  });

  it('rechaza un combo cuyo No. no sea un número de 1 a 99999', () => {
    const { items } = parseDeviceImport([
      HEADER,
      ['A1', 'CPU', 'DELL', 'Pro Slim', 'S1', '1000001'],
      ['A1', 'Teclado', 'DELL', 'KB', 'S2', '1000002'],
      ['A1', 'Monitor', 'DELL', 'E24', 'S3', '1000003'],
    ]);

    expect(items[0].number).toBeNull();
    expect(items[0].errors).toEqual(['El No. "A1" (fila 2) debe ser un número de 1 a 99999.']);
  });

  it('marca como error el combo con series faltantes', () => {
    const [, combo3] = parseDeviceImport(SAMPLE).items;

    expect(combo3.errors).toEqual([
      'Teclado (fila 7): falta serie.',
      'Monitor (fila 8): falta serie.',
    ]);
  });

  it('registra CPU, teclado o monitor sueltos como dispositivos de su tipo', () => {
    const { items } = parseDeviceImport([
      HEADER,
      ['7', 'CPU', 'DELL', 'Pro Slim', 'S1', '1000001'],
      ['7', 'Monitor', 'DELL', 'E24', 'S2', '1000002'],
      ['8', 'Teclado', 'DELL', 'KB', 'S3', '1000003'],
    ]);

    expect(items.map((item) => [item.kind, item.rows[0].equipo])).toEqual([
      ['device', 'CPU'], ['device', 'Monitor'], ['device', 'Teclado'],
    ]);
  });

  it('encuentra los encabezados aunque haya filas de título, columnas en otro orden o sin No.', () => {
    const { items, fileErrors } = parseDeviceImport([
      ['Inventario de equipos 2026'],
      [],
      ['INVENTARIO', 'Equipo', 'Serie', 'Modelo', 'Marca'],
      ['4126461', 'Cámara Web', 'HGCSMC4', 'C920', 'Logitech'],
    ]);

    expect(fileErrors).toEqual([]);
    expect(items[0].rows[0]).toEqual({
      rowNumber: 4, comboNo: '', equipo: 'Cámara Web', equipoKey: 'CAMARAWEB',
      marca: 'Logitech', modelo: 'C920', serie: 'HGCSMC4', inventario: '4126461',
    });
  });

  it('detecta datos faltantes, inventarios inválidos, repetidos y componentes duplicados', () => {
    const { items } = parseDeviceImport([
      HEADER,
      ['1', 'CPU', 'DELL', 'Pro Slim', 'S1', '1000001'],
      ['1', 'CPU', 'DELL', 'Pro Slim', 'S2', '1000002'],
      ['1', 'Teclado', 'DELL', 'KB', 'S3', '1000003'],
      ['1', 'Monitor', 'DELL', 'E24', 'S4', 'ABC'],
      ['2', '', 'HP', 'X1', 'S5', '1000001'],
    ]);

    expect(items[0].errors).toEqual([
      'El cpu aparece 2 veces en el combo.',
      'Monitor (fila 5): el inventario debe ser numérico y de máximo 7 dígitos.',
    ]);
    expect(items[1].errors).toEqual([
      'Fila (fila 6): falta tipo de equipo.',
      'El inventario 1000001 (fila 6) ya aparece en la fila 2.',
    ]);
  });

  it('no permite una computadora de escritorio suelta', () => {
    const [item] = parseDeviceImport([HEADER, ['5', 'Computadora escritorio', 'DELL', 'X', 'S', '1']]).items;

    expect(item.errors[0]).toContain('se registra como combo');
  });

  it('informa cuando el archivo no tiene el formato esperado', () => {
    expect(parseDeviceImport([['Nombre', 'Correo']]).fileErrors)
      .toEqual(['No se encontraron los encabezados EQUIPO, MARCA, MODELO, SERIE e INVENTARIO.']);
    expect(parseDeviceImport([HEADER, ['', 'UPS', '', '', '', '']]).fileErrors)
      .toEqual(['El archivo no contiene equipos para importar.']);
  });
});
