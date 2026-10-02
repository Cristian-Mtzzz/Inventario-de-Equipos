import { ChangeDetectorRef, Component, inject, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type ExcelJS from 'exceljs';
import { catchError, finalize, forkJoin, from, map, mergeMap, of, switchMap, toArray } from 'rxjs';
import { AdminService } from './admin.service';
import { Area, Building, Device, DevicePageQuery, DeviceType, RegionalOption } from './admin.models';

// El endpoint admite hasta 500 filas por página; se usa para reducir las consultas de exportación.
const REPORT_PAGE_SIZE = 500;
const REPORT_COLUMNS = [
  'ID', 'Código de inventario', 'Número de serie', 'Marca', 'Modelo', 'Tipo', 'Estado',
  'Número de pago asignado', 'Nombre asignado', 'Regional', 'Edificio', 'Área',
];
type ReportType = 'all' | 'type' | 'brand' | 'state' | 'regional' | 'building' | 'area';

/**
 * Genera reportes XLSX de dispositivos para usuarios con permiso DISPOSITIVOS.
 * Necesita catálogos de tipo, regional, edificio y área, además del endpoint paginado
 * GET /api/admin/devices con los filtros de búsqueda. ExcelJS se carga solo al exportar.
 */
@Component({
  selector: 'app-device-reports',
  imports: [FormsModule],
  templateUrl: './device-reports.component.html',
  styleUrl: './device-reports.component.css',
})
export class DeviceReportsComponent {
  readonly closed = output<void>();
  private readonly adminService = inject(AdminService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  deviceTypes: DeviceType[] = [];
  regionals: RegionalOption[] = [];
  buildings: Building[] = [];
  areas: Area[] = [];
  reportType: ReportType = 'all';
  searchTerm = '';
  brand = '';
  typeId: number | null = null;
  state = '';
  regionalId: number | null = null;
  buildingId: number | null = null;
  areaId: number | null = null;
  isLoadingFilters = true;
  isExporting = false;
  totalMatchingDevices: number | null = null;
  message = '';
  errorMessage = '';
  private areaRequestId = 0;

  constructor() {
    // Prepara los catálogos requeridos por los filtros antes de habilitar la exportación.
    forkJoin({
      deviceTypes: this.adminService.getDeviceTypes(),
      regionals: this.adminService.getRegionals(),
      buildings: this.adminService.getBuildings(),
    }).pipe(finalize(() => {
      this.isLoadingFilters = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: (catalogs) => {
        this.deviceTypes = catalogs.deviceTypes;
        this.regionals = catalogs.regionals;
        this.buildings = catalogs.buildings;
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.errorMessage = 'No se pudieron cargar los filtros del reporte.';
        this.changeDetector.markForCheck();
      },
    });
  }

  get buildingsForRegional(): Building[] {
    return this.regionalId === null
      ? []
      : this.buildings.filter((building) => building.IdRegional === this.regionalId);
  }

  get selectedRegionalName(): string {
    return this.regionals.find((regional) => regional.IdRegional === this.regionalId)?.NombreRegional ?? 'Todas';
  }

  get selectedBuildingName(): string {
    return this.buildings.find((building) => building.IdEdificio === this.buildingId)?.NombreEdificio ?? 'Todos';
  }

  get selectedAreaName(): string {
    return this.areas.find((area) => area.IdArea === this.areaId)?.NombreArea ?? 'Todas';
  }

  get canExport(): boolean {
    if (this.isLoadingFilters || this.isExporting) return false;
    switch (this.reportType) {
      case 'type': return this.typeId !== null;
      case 'brand': return this.brand.trim().length > 0;
      case 'state': return this.state.length > 0;
      case 'regional': return this.regionalId !== null;
      case 'building': return this.regionalId !== null && this.buildingId !== null;
      case 'area': return this.regionalId !== null && this.buildingId !== null && this.areaId !== null;
      default: return true;
    }
  }

  selectReportType(reportType: ReportType): void {
    // Cambiar el tipo descarta criterios anteriores para evitar exportar con filtros ocultos.
    this.reportType = reportType;
    this.searchTerm = '';
    this.typeId = null;
    this.brand = '';
    this.state = '';
    this.regionalId = null;
    this.buildingId = null;
    this.areaId = null;
    this.areas = [];
    this.areaRequestId++;
    this.totalMatchingDevices = null;
    this.errorMessage = '';
    this.message = '';
  }

  closeDialog(): void {
    if (!this.isExporting) this.closed.emit();
  }

  selectRegional(idRegional: number | null): void {
    // La selección geográfica es encadenada: regional, edificio y luego área.
    this.regionalId = idRegional;
    this.buildingId = null;
    this.areaId = null;
    this.areas = [];
    this.areaRequestId++;
    this.totalMatchingDevices = null;
  }

  selectBuilding(idEdificio: number | null): void {
    // Carga únicamente las áreas del edificio seleccionado y descarta respuestas obsoletas.
    this.buildingId = idEdificio;
    this.areaId = null;
    this.areas = [];
    const requestId = ++this.areaRequestId;
    if (idEdificio === null) return;

    this.adminService.getAreas(idEdificio).subscribe({
      next: (areas) => {
        if (requestId === this.areaRequestId) {
          this.areas = areas;
          this.changeDetector.markForCheck();
        }
      },
      error: () => {
        if (requestId === this.areaRequestId) {
          this.errorMessage = 'No se pudieron cargar las áreas del edificio.';
          this.changeDetector.markForCheck();
        }
      },
    });
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.brand = '';
    this.typeId = null;
    this.state = '';
    this.regionalId = null;
    this.buildingId = null;
    this.areaId = null;
    this.areas = [];
    this.areaRequestId++;
    this.totalMatchingDevices = null;
    this.errorMessage = '';
    this.message = '';
  }

  exportReport(): void {
    // Aplica el criterio elegido, descarga todas las páginas en lotes de cuatro y genera un solo XLSX.
    this.errorMessage = '';
    this.message = '';
    this.isExporting = true;
    this.changeDetector.markForCheck();

    this.fetchAndExport();
  }

  private fetchAndExport(): void {
    const query = this.buildQuery(1);

    this.adminService.getDevices(query).pipe(
      switchMap((firstPage) => {
        this.totalMatchingDevices = firstPage.TotalCount;
        const pageCount = Math.ceil(firstPage.TotalCount / firstPage.PageSize);
        if (pageCount <= 1) return of(firstPage.Items);

        const remainingPages = Array.from({ length: pageCount - 1 }, (_, index) => index + 2);
        return from(remainingPages).pipe(
          mergeMap((page) => this.adminService.getDevices({ ...query, Page: page }), 4),
          toArray(),
          map((pages) => [firstPage, ...pages].flatMap((result) => result.Items)),
        );
      }),
      switchMap((devices) => from(this.createWorkbook(devices))),
      finalize(() => {
        this.isExporting = false;
        this.changeDetector.markForCheck();
      }),
    ).subscribe({
      next: () => {
        this.message = `Reporte exportado: ${this.totalMatchingDevices ?? 0} dispositivos.`;
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.errorMessage = 'No se pudo generar el reporte de dispositivos.';
        this.changeDetector.markForCheck();
      },
    });
  }

  private reportFilename(): string {
    return `reporte-dispositivos-${new Date().toISOString().slice(0, 10)}.xlsx`;
  }

  private buildQuery(page: number): DevicePageQuery {
    // Solo envía al backend el filtro del reporte seleccionado y su ubicación necesaria.
    const usesType = this.reportType === 'type';
    const usesBrand = this.reportType === 'brand';
    const usesState = this.reportType === 'state';
    const usesRegion = ['regional', 'building', 'area'].includes(this.reportType);
    const usesBuilding = ['building', 'area'].includes(this.reportType);
    return {
      Page: page,
      PageSize: REPORT_PAGE_SIZE,
      SearchTerm: this.searchTerm.trim(),
      Brand: usesBrand ? this.brand.trim() : '',
      Model: '',
      TypeId: usesType ? this.typeId : null,
      RegionalId: usesRegion ? this.regionalId : null,
      BuildingId: usesBuilding ? this.buildingId : null,
      AreaId: this.reportType === 'area' ? this.areaId : null,
      State: usesState ? this.state : '',
    };
  }

  private async createWorkbook(devices: Device[]): Promise<void> {
    // Crea el archivo en el navegador; ExcelJS se importa aquí para no cargarlo con el panel.
    const { default: ExcelJSModule } = await import('exceljs');
    const workbook = new ExcelJSModule.Workbook();
    workbook.creator = 'Sistema de Inventario';
    workbook.created = new Date();
    workbook.subject = 'Reporte de dispositivos';
    workbook.title = 'Reporte de dispositivos';

    this.addDevicesSheet(workbook, devices);

    const buffer = await workbook.xlsx.writeBuffer();
    const workbookBytes = new Uint8Array(buffer as ArrayBuffer);
    const file = new Blob([workbookBytes.buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = this.reportFilename();
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // Deja una sola hoja de detalle para que el archivo abra directamente en los dispositivos.
  private addDevicesSheet(workbook: ExcelJS.Workbook, devices: Device[]): void {
    const sheet = workbook.addWorksheet('Dispositivos', { properties: { tabColor: { argb: 'FF4F8A83' } } });
    const namesByPayment = new Map<string, string>();
    devices.forEach((device) => {
      const payment = device.NumeroPagoAsignado?.trim() ?? '';
      const name = device.AsignadoA?.trim() || device.NombreAsignado?.trim() || '';
      if (payment && name && !namesByPayment.has(payment)) namesByPayment.set(payment, name);
    });

    sheet.mergeCells('A1:L1');
    sheet.getCell('A1').value = 'DETALLE DE DISPOSITIVOS';
    sheet.getCell('A1').font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173F43' } };
    sheet.getCell('A1').alignment = { vertical: 'middle' };
    sheet.getRow(1).height = 31;
    sheet.mergeCells('A2:L2');
    sheet.getCell('A2').value = `${devices.length} dispositivos · Generado ${new Date().toLocaleString('es-HN')}`;
    sheet.getCell('A2').font = { name: 'Aptos', size: 10, color: { argb: 'FF617573' }, italic: true };

    sheet.addTable({
      name: 'ReporteDispositivos',
      ref: 'A4',
      headerRow: true,
      totalsRow: false,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: REPORT_COLUMNS.map((name) => ({ name })),
      rows: devices.map((device) => {
        const payment = device.NumeroPagoAsignado?.trim() ?? '';
        const assignedName = device.AsignadoA?.trim()
          || device.NombreAsignado?.trim()
          || namesByPayment.get(payment)
          || (device.Estado.trim().toUpperCase() === 'ASIGNADO' ? 'Sin nombre registrado' : '');
        return [
          device.IdEquipo,
          device.CodigoInventario,
          device.NoSerie,
          device.Marca,
          device.Modelo,
          device.NombreTipo || device.IdTipo || '',
          device.Estado,
          device.NumeroPagoAsignado?.trim() ?? '',
          assignedName,
          device.NombreRegional?.trim() ?? '',
          device.NombreEdificio?.trim() ?? '',
          device.NombreArea?.trim() ?? '',
        ];
      }),
    });

    [12, 22, 24, 18, 20, 22, 16, 22, 34, 25, 30, 34].forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });
    sheet.views = [{ state: 'frozen', ySplit: 4 }];
  }

  private appliedFilters(): Array<[string, string]> {
    // Registra solo los criterios que definieron este reporte para auditar su alcance.
    const selectedType = this.deviceTypes.find((type) => type.IdTipo === this.typeId)?.NombreTipo;
    const selectedState = this.state === 'ASIGNADO' ? 'Asignado'
      : this.state === 'DISPONIBLE' ? 'Disponible' : 'Todos';
    const filters: Array<[string, string]> = [['Tipo de reporte', this.reportTypeLabel()]];
    if (this.searchTerm.trim()) filters.push(['Búsqueda', this.searchTerm.trim()]);
    switch (this.reportType) {
      case 'type': filters.push(['Tipo de dispositivo', selectedType ?? 'Todos']); break;
      case 'brand': filters.push(['Marca', this.brand.trim()]); break;
      case 'state': filters.push(['Estado', selectedState]); break;
      case 'regional': filters.push(['Regional', this.selectedRegionalName]); break;
      case 'building':
        filters.push(['Regional', this.selectedRegionalName], ['Edificio', this.selectedBuildingName]);
        break;
      case 'area':
        filters.push(['Regional', this.selectedRegionalName], ['Edificio', this.selectedBuildingName], ['Área', this.selectedAreaName]);
        break;
    }
    return filters;
  }

  private reportTypeLabel(): string {
    return {
      all: 'Todos los dispositivos',
      type: 'Por tipo de dispositivo',
      brand: 'Por marca',
      state: 'Por estado',
      regional: 'Por regional',
      building: 'Por edificio',
      area: 'Por área',
    }[this.reportType];
  }

  private styleSectionHeading(row: ExcelJS.Row): void {
    row.height = 24;
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF276968' } };
    });
  }

  private styleTableHeader(row: ExcelJS.Row): void {
    row.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F8A83' } };
      cell.alignment = { vertical: 'middle' };
    });
  }
}
