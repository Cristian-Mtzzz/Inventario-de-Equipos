import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type ExcelJS from 'exceljs';
import { catchError, finalize, forkJoin, from, map, mergeMap, of, switchMap, toArray } from 'rxjs';
import { AdminService } from './admin.service';
import { Area, Building, Device, DevicePageQuery, DeviceType, RegionalOption } from './admin.models';

const REPORT_PAGE_SIZE = 500;
const REPORT_COLUMNS = [
  'ID', 'Código de inventario', 'Número de serie', 'Marca', 'Modelo', 'Tipo', 'Estado',
  'Número de pago asignado', 'Nombre asignado', 'Regional', 'Edificio', 'Área',
];

@Component({
  selector: 'app-device-reports',
  imports: [FormsModule],
  templateUrl: './device-reports.component.html',
  styleUrl: './device-reports.component.css',
})
export class DeviceReportsComponent {
  private readonly adminService = inject(AdminService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  deviceTypes: DeviceType[] = [];
  regionals: RegionalOption[] = [];
  buildings: Building[] = [];
  areas: Area[] = [];
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

  selectRegional(idRegional: number | null): void {
    this.regionalId = idRegional;
    this.buildingId = null;
    this.areaId = null;
    this.areas = [];
    this.areaRequestId++;
    this.totalMatchingDevices = null;
  }

  selectBuilding(idEdificio: number | null): void {
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
    this.errorMessage = '';
    this.message = '';
    this.isExporting = true;
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

  private buildQuery(page: number): DevicePageQuery {
    return {
      Page: page,
      PageSize: REPORT_PAGE_SIZE,
      SearchTerm: this.searchTerm.trim(),
      Brand: this.brand.trim(),
      Model: '',
      TypeId: this.typeId,
      RegionalId: this.regionalId,
      BuildingId: this.buildingId,
      AreaId: this.areaId,
      State: this.state,
    };
  }

  private async createWorkbook(devices: Device[]): Promise<void> {
    const { default: ExcelJSModule } = await import('exceljs');
    const workbook = new ExcelJSModule.Workbook();
    workbook.creator = 'Sistema de Inventario';
    workbook.created = new Date();
    workbook.subject = 'Reporte de dispositivos';
    workbook.title = 'Reporte de dispositivos';

    this.addSummarySheet(workbook, devices);
    this.addDevicesSheet(workbook, devices);

    const buffer = await workbook.xlsx.writeBuffer();
    const file = new Blob([buffer as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reporte-dispositivos-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  private addSummarySheet(workbook: ExcelJS.Workbook, devices: Device[]): void {
    const sheet = workbook.addWorksheet('Resumen', { properties: { tabColor: { argb: 'FF276968' } } });
    sheet.columns = [{ width: 30 }, { width: 48 }, { width: 18 }, { width: 18 }];
    sheet.mergeCells('A1:D1');
    sheet.getCell('A1').value = 'REPORTE DE DISPOSITIVOS';
    sheet.getCell('A1').font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173F43' } };
    sheet.getCell('A1').alignment = { vertical: 'middle' };
    sheet.getRow(1).height = 34;
    sheet.mergeCells('A2:D2');
    sheet.getCell('A2').value = 'Sistema de Inventario · Exportación de resultados filtrados';
    sheet.getCell('A2').font = { name: 'Aptos', size: 10, color: { argb: 'FF617573' }, italic: true };
    sheet.addRow([]);
    sheet.addRow(['Fecha de generación', new Date().toLocaleString('es-HN')]);
    sheet.addRow(['Dispositivos incluidos', devices.length]);
    sheet.addRow([]);

    const filterTitle = sheet.addRow(['Filtros aplicados']);
    sheet.mergeCells(`A${filterTitle.number}:D${filterTitle.number}`);
    this.styleSectionHeading(filterTitle);
    const filterHeader = sheet.addRow(['Criterio', 'Selección']);
    this.styleTableHeader(filterHeader);
    this.appliedFilters().forEach(([label, value]) => sheet.addRow([label, value]));

    sheet.addRow([]);
    const stateTitle = sheet.addRow(['Dispositivos por estado']);
    sheet.mergeCells(`A${stateTitle.number}:D${stateTitle.number}`);
    this.styleSectionHeading(stateTitle);
    const stateHeader = sheet.addRow(['Estado', 'Cantidad']);
    this.styleTableHeader(stateHeader);
    const stateCounts = devices.reduce<Record<string, number>>((counts, device) => {
      const label = device.Estado || 'Sin estado';
      counts[label] = (counts[label] ?? 0) + 1;
      return counts;
    }, {});
    Object.entries(stateCounts).sort(([first], [second]) => first.localeCompare(second)).forEach(([state, count]) => {
      sheet.addRow([state, count]);
    });

    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  private addDevicesSheet(workbook: ExcelJS.Workbook, devices: Device[]): void {
    const sheet = workbook.addWorksheet('Dispositivos', { properties: { tabColor: { argb: 'FF4F8A83' } } });
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
      rows: devices.map((device) => [
        device.IdEquipo,
        device.CodigoInventario,
        device.NoSerie,
        device.Marca,
        device.Modelo,
        device.NombreTipo || device.IdTipo || '',
        device.Estado,
        device.NumeroPagoAsignado ?? '',
        device.AsignadoA || device.NombreAsignado || '',
        device.NombreRegional ?? '',
        device.NombreEdificio ?? '',
        device.NombreArea ?? '',
      ]),
    });

    [12, 22, 24, 18, 20, 22, 16, 22, 34, 25, 30, 34].forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });
    sheet.views = [{ state: 'frozen', ySplit: 4 }];
  }

  private appliedFilters(): Array<[string, string]> {
    const selectedType = this.deviceTypes.find((type) => type.IdTipo === this.typeId)?.NombreTipo;
    const selectedState = this.state === 'ASIGNADO' ? 'Asignado'
      : this.state === 'DISPONIBLE' ? 'Disponible' : 'Todos';
    return [
      ['Búsqueda', this.searchTerm.trim() || 'Todas'],
      ['Tipo de dispositivo', selectedType ?? 'Todos'],
      ['Marca', this.brand.trim() || 'Todas'],
      ['Estado', selectedState],
      ['Regional', this.selectedRegionalName],
      ['Edificio', this.selectedBuildingName],
      ['Área', this.selectedAreaName],
    ];
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
