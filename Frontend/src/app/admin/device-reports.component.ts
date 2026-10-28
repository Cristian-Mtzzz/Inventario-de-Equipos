import { ChangeDetectorRef, Component, inject, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, forkJoin, from, map, mergeMap, of, switchMap, toArray } from 'rxjs';
import { ReportColumn, ReportDateRange, addReportSheet, cellText, createReportWorkbook, dateRangeLabel, downloadReportWorkbook, emptyReportDateRange, excelDate, generatedAt, isInDateRange, isInvalidDateRange, reportFileName } from '../shared/excel-report';
import { UppercaseDirective } from '../shared/uppercase.directive';
import { AdminService } from './admin.service';
import { Area, Building, Device, DevicePageQuery, DeviceType, RegionalOption } from './admin.models';

// El endpoint admite hasta 500 filas por página; se usa para reducir las consultas de exportación.
const REPORT_PAGE_SIZE = 500;
// Valor del filtro de tipo que exporta solo las piezas de combos de escritorio.
const COMBO_TYPE = 'COMBOS';
type ReportType = 'all' | 'type' | 'brand' | 'state' | 'regional' | 'building' | 'area';

/**
 * Genera reportes XLSX de dispositivos para usuarios con permiso DISPOSITIVOS.
 * Necesita catálogos de tipo, regional, edificio y área, además del endpoint paginado
 * GET /api/admin/devices con los filtros de búsqueda. ExcelJS se carga solo al exportar.
 */
@Component({
  selector: 'app-device-reports',
  imports: [FormsModule, UppercaseDirective],
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
  dateRange: ReportDateRange = emptyReportDateRange();
  brand = '';
  typeId: number | typeof COMBO_TYPE | null = null;
  readonly comboType = COMBO_TYPE;
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
    this.dateRange = emptyReportDateRange();
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
    if (isInvalidDateRange(this.dateRange)) {
      this.errorMessage = 'La fecha "desde" no puede ser posterior a la fecha "hasta".';
      return;
    }
    this.isExporting = true;
    this.changeDetector.markForCheck();

    this.fetchAndExport();
  }

  private fetchAndExport(): void {
    const query = this.buildQuery(1);

    this.adminService.getDevices(query).pipe(
      switchMap((firstPage) => {
        const pageCount = Math.ceil(firstPage.TotalCount / firstPage.PageSize);
        if (pageCount <= 1) return of(firstPage.Items);

        const remainingPages = Array.from({ length: pageCount - 1 }, (_, index) => index + 2);
        return from(remainingPages).pipe(
          mergeMap((page) => this.adminService.getDevices({ ...query, Page: page }), 4),
          toArray(),
          map((pages) => [firstPage, ...pages].flatMap((result) => result.Items)),
        );
      }),
      // El rango de fechas se aplica aquí: la API no filtra por fecha de asignación.
      map((devices) => devices.filter((device) => isInDateRange(device.FechaAsignacion, this.dateRange))),
      switchMap((devices) => {
        this.totalMatchingDevices = devices.length;
        return from(this.createWorkbook(devices));
      }),
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
    return reportFileName('dispositivos');
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
      SearchTerm: '',
      Brand: usesBrand ? this.brand.trim() : '',
      Model: '',
      TypeId: usesType && this.typeId !== COMBO_TYPE ? this.typeId : null,
      RegionalId: usesRegion ? this.regionalId : null,
      BuildingId: usesBuilding ? this.buildingId : null,
      AreaId: this.reportType === 'area' ? this.areaId : null,
      State: usesState ? this.state : '',
      ComboOnly: usesType && this.typeId === COMBO_TYPE,
    };
  }

  // Mismas columnas y celdas que la tabla de dispositivos de la vista web; ExcelJS se carga solo al exportar.
  private async createWorkbook(devices: Device[]): Promise<void> {
    const workbook = await createReportWorkbook('Reporte de dispositivos');
    const columns: ReportColumn<Device>[] = [
      { header: 'No. ingreso / combo', width: 20, value: (device) => device.NumeroIngreso || device.NCombo || '-' },
      { header: 'Equipo', width: 26, value: (device) => (device.NombreTipo || '-') + (device.Componente ? ` · ${device.Componente}` : '') },
      { header: 'Marca', width: 16, value: (device) => cellText(device.Marca).toLocaleUpperCase('es') },
      { header: 'Modelo', width: 20, value: (device) => cellText(device.Modelo).toLocaleUpperCase('es') },
      { header: 'Serie', width: 22, value: (device) => cellText(device.NoSerie).toLocaleUpperCase('es') },
      { header: 'Inventario', width: 14, value: (device) => device.CodigoInventario },
      { header: 'Asignado a', width: 34, value: (device) => device.AsignadoA || 'Sin asignar' },
      { header: 'No. pago', width: 12, value: (device) => cellText(device.NumeroPagoAsignado) },
      {
        header: 'Área', width: 44,
        value: (device) => (device.NombreArea ? device.NombreArea + (device.NombreEdificio ? ` · ${device.NombreEdificio}` : '') : '-'),
      },
      { header: 'Fecha asignación', width: 18, format: 'date', value: (device) => excelDate(device.FechaAsignacion) },
    ];
    // La segunda fila deja constancia de los criterios con los que se generó el archivo.
    const filters = this.appliedFilters().map(([label, value]) => `${label}: ${value}`).join(' · ');
    addReportSheet(workbook, {
      sheetName: 'Dispositivos',
      title: 'REPORTE DE DISPOSITIVOS',
      subtitle: `${devices.length} dispositivos · ${filters} · ${generatedAt()}`,
      tableName: 'ReporteDispositivos',
      columns,
      rows: devices,
    });
    await downloadReportWorkbook(workbook, this.reportFilename());
  }

  private appliedFilters(): Array<[string, string]> {
    // Registra solo los criterios que definieron este reporte para auditar su alcance.
    const selectedType = this.deviceTypes.find((type) => type.IdTipo === this.typeId)?.NombreTipo;
    const selectedState = this.state === 'ASIGNADO' ? 'Asignado'
      : this.state === 'DISPONIBLE' ? 'Disponible' : 'Todos';
    const filters: Array<[string, string]> = [['Tipo de reporte', this.reportTypeLabel()]];
    if (this.dateRange.desde || this.dateRange.hasta) filters.push(['Fecha de asignación', dateRangeLabel(this.dateRange)]);
    switch (this.reportType) {
      case 'type':
        filters.push(['Tipo de dispositivo', this.typeId === COMBO_TYPE ? 'Computadoras escritorio (combos)' : selectedType ?? 'Todos']);
        break;
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
}
