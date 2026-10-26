import { ReportColumn, addReportHeader, addReportSheet, cellText, createReportWorkbook, downloadReportWorkbook, excelDate, generatedAt, reportFileName } from '../shared/excel-report';
import { TICKET_SUPPORT_TYPES, Ticket } from './tickets.models';

// Filtros elegidos en la ventana "Exportar reporte". Las fechas son yyyy-mm-dd (input date)
// y se comparan con la fecha de creación del ticket; vacío = sin límite.
export interface TicketReportFilters {
  desde: string;
  hasta: string;
  estado: '' | 'PENDIENTE' | 'FINALIZADO';
  tipoSoporte: string;
  idTecnico: number;
}

export const emptyTicketReportFilters = (): TicketReportFilters => ({
  desde: '', hasta: '', estado: '', tipoSoporte: '', idTecnico: 0,
});

// Mismos textos que la tabla web: "Soporte aplicativo" o "-" si el ticket no tiene tipo.
const supportTypeLabel = (value: string | null, empty = '-'): string =>
  TICKET_SUPPORT_TYPES.find((type) => type.value === value?.toUpperCase())?.label ?? empty;

const isOpen = (ticket: Ticket): boolean => ticket.Estado?.toUpperCase() === 'PENDIENTE';

// Columna "Tiempo" de la tabla web: "46 min", "13 h 28 min" o "-" si sigue abierto.
const elapsed = (ticket: Ticket): string => {
  if (ticket.MinutosTranscurridos === null || ticket.MinutosTranscurridos === undefined) return '-';
  const minutes = Math.max(0, ticket.MinutosTranscurridos);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

// Columna "Tiempo activo" de la tabla web ("2 d 03:15:42"), calculada al momento de exportar.
const activeElapsed = (ticket: Ticket, now: number): string => {
  if (!isOpen(ticket)) return '-';
  const start = new Date(ticket.FechaCreacion).getTime();
  const total = Number.isNaN(start) ? 0 : Math.max(0, Math.floor((now - start) / 1000));
  const days = Math.floor(total / 86400);
  const pad = (value: number) => String(value).padStart(2, '0');
  const clock = `${pad(Math.floor((total % 86400) / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
  return days > 0 ? `${days} d ${clock}` : clock;
};

// Tickets que cumplen los filtros, en el mismo orden que la tabla (más reciente primero).
export function filterTicketsForReport(tickets: readonly Ticket[], filters: TicketReportFilters): Ticket[] {
  const from = filters.desde ? new Date(`${filters.desde}T00:00:00`) : null;
  const to = filters.hasta ? new Date(`${filters.hasta}T23:59:59`) : null;
  return tickets.filter((ticket) => {
    const created = new Date(ticket.FechaCreacion);
    const valid = !Number.isNaN(created.getTime());
    if (from && (!valid || created < from)) return false;
    if (to && (!valid || created > to)) return false;
    if (filters.estado && ticket.Estado?.toUpperCase() !== filters.estado) return false;
    if (filters.tipoSoporte && ticket.TipoSoporte?.toUpperCase() !== filters.tipoSoporte) return false;
    if (filters.idTecnico > 0 && ticket.IdTecnico !== filters.idTecnico) return false;
    return true;
  });
}

// Texto de los filtros para el encabezado del reporte.
function filtersLabel(filters: TicketReportFilters, technicianName: string): string {
  // "2026-10-26" (valor del campo de fecha) → "26/10/26".
  const format = (value: string) => {
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year.slice(-2)}`;
  };
  const period = filters.desde && filters.hasta ? `Del ${format(filters.desde)} al ${format(filters.hasta)}`
    : filters.desde ? `Desde el ${format(filters.desde)}`
      : filters.hasta ? `Hasta el ${format(filters.hasta)}` : 'Todos los tickets';
  return [
    period,
    filters.estado ? `Estado: ${filters.estado === 'PENDIENTE' ? 'Pendiente' : 'Finalizado'}` : '',
    filters.tipoSoporte ? supportTypeLabel(filters.tipoSoporte) : '',
    filters.idTecnico > 0 ? `Técnico: ${technicianName}` : '',
  ].filter(Boolean).join(' · ');
}

/**
 * Genera y descarga el Excel del módulo Tickets con el formato común de los reportes:
 * hoja "Tickets" con las mismas columnas y celdas que la tabla web, y hoja "Resumen" con
 * los totales por tipo de soporte, por técnico y en general.
 */
export async function exportTicketsReport(tickets: readonly Ticket[], filters: TicketReportFilters, technicianName: string): Promise<void> {
  const workbook = await createReportWorkbook('Reporte de tickets de soporte');
  const now = Date.now();
  const finished = tickets.filter((ticket) => !isOpen(ticket));
  const pending = tickets.length - finished.length;
  const filterText = filtersLabel(filters, technicianName);

  const columns: ReportColumn<Ticket>[] = [
    { header: '#', width: 8, value: (t) => t.IdTicket },
    { header: 'Fecha y hora', width: 18, format: 'datetime', value: (t) => excelDate(t.FechaCreacion) },
    { header: 'Región', width: 20, value: (t) => cellText(t.Region) },
    { header: 'Edificio', width: 26, value: (t) => cellText(t.Edificio) },
    { header: 'Departamento', width: 30, value: (t) => cellText(t.Departamento) },
    { header: 'Empleado', width: 32, value: (t) => t.Empleado },
    { header: 'Tipo de soporte', width: 22, value: (t) => supportTypeLabel(t.TipoSoporte) },
    { header: 'Detalle', width: 44, wrap: true, value: (t) => t.Detalle },
    { header: 'Técnico', width: 26, value: (t) => cellText(t.Tecnico) },
    { header: 'Estado', width: 14, value: (t) => t.Estado },
    { header: 'Tiempo activo', width: 16, value: (t) => activeElapsed(t, now) },
    { header: 'Finalización', width: 18, format: 'datetime', value: (t) => excelDate(t.FechaFinalizacion) },
    { header: 'Tiempo', width: 16, value: (t) => elapsed(t) },
    { header: 'Valoración', width: 13, value: (t) => cellText(t.Valoracion) },
    { header: 'Observaciones', width: 44, wrap: true, value: (t) => cellText(t.Observaciones) },
  ];
  addReportSheet(workbook, {
    sheetName: 'Tickets',
    title: 'REPORTE DE TICKETS DE SOPORTE',
    subtitle: `${tickets.length} tickets · ${finished.length} finalizados · ${pending} pendientes · ${filterText} · ${generatedAt()}`,
    tableName: 'ReporteTickets',
    columns,
    rows: tickets,
  });

  // Hoja 2: totales del período, con el mismo encabezado que las hojas de detalle.
  const summary = workbook.addWorksheet('Resumen', { properties: { tabColor: { argb: 'FF276968' } } });
  addReportHeader(summary, 7, 'RESUMEN DE TICKETS', `${filterText} · ${generatedAt()}`);
  const average = (items: readonly Ticket[]): number | string => {
    const minutes = items.map((t) => t.MinutosTranscurridos).filter((m): m is number => m !== null && m !== undefined);
    return minutes.length ? Math.round(minutes.reduce((sum, m) => sum + m, 0) / minutes.length) : '-';
  };
  const totals = (name: string, items: readonly Ticket[]): (string | number)[] => {
    const done = items.filter((t) => !isOpen(t));
    return [name, items.length, done.length, items.length - done.length, average(done),
      items.filter((t) => t.Valoracion === 'BUENO').length, items.filter((t) => t.Valoracion === 'MALO').length];
  };
  const groupRows = (key: (t: Ticket) => string): (string | number)[][] => {
    const groups = new Map<string, Ticket[]>();
    tickets.forEach((ticket) => groups.set(key(ticket), [...(groups.get(key(ticket)) ?? []), ticket]));
    return [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([name, items]) => totals(name, items));
  };
  const summaryColumns = ['Total', 'Finalizados', 'Pendientes', 'Promedio de atención (min)', 'Valoración buena', 'Valoración mala'];
  const addSummaryTable = (name: string, title: string, ref: string, rows: (string | number)[][]) => {
    summary.addTable({
      name,
      ref,
      headerRow: true,
      totalsRow: false,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: [title, ...summaryColumns].map((column) => ({ name: column })),
      rows: rows.length > 0 ? rows : [[`Sin ${title.toLowerCase()}`, 0, 0, 0, '-', 0, 0]],
    });
  };
  const typeRows = groupRows((t) => supportTypeLabel(t.TipoSoporte, 'Sin tipo'));
  const technicianRows = groupRows((t) => t.Tecnico?.trim() || 'Sin técnico');
  addSummaryTable('ResumenTipoSoporte', 'Tipo de soporte', 'A4', typeRows);
  const technicianStart = 4 + Math.max(typeRows.length, 1) + 3;
  addSummaryTable('ResumenTecnico', 'Técnico', `A${technicianStart}`, technicianRows);
  const totalStart = technicianStart + Math.max(technicianRows.length, 1) + 3;
  addSummaryTable('ResumenTotal', 'General', `A${totalStart}`, [totals('Todos los tickets', tickets)]);
  [30, 10, 13, 12, 26, 18, 17].forEach((width, index) => { summary.getColumn(index + 1).width = width; });

  await downloadReportWorkbook(workbook, reportFileName('tickets'));
}
