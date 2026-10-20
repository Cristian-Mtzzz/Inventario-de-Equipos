import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, inject, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DigitsOnlyDirective } from '../shared/digits-only.directive';
import { PagePipe, TablePageSizeComponent, TablePaginatorComponent } from '../shared/table-paginator';
import type ExcelJS from 'exceljs';
import { finalize, firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { AdminService } from '../admin/admin.service';
import { SearchableSelectDirective } from '../shared/searchable-select.directive';
import { apiErrorMessage } from '../shared/api-response';
import { AppHeaderComponent } from '../shared/app-header.component';
import { Area, Building, DeviceType, RegionalOption } from '../admin/admin.models';
import { Maintenance, MaintenanceAssessmentRequest, MaintenanceEntryRequest, MaintenanceExitRequest, ReceptionDefaults, ReceptionEntryRequest, WorkshopDevice, WorkshopTechnician } from './taller.models';
import { TallerService } from './taller.service';

@Component({
  selector: 'app-taller',
  imports: [DatePipe, FormsModule, SearchableSelectDirective, AppHeaderComponent, PagePipe, TablePageSizeComponent, TablePaginatorComponent, DigitsOnlyDirective],
  templateUrl: './taller.component.html',
  styleUrl: './taller.component.css',
})
export class TallerComponent {
  // Controla la vista independiente de Taller y su versión embebida en Admin.
  // Mantiene el estado de ventanas, cargas, mensajes y confirmaciones de borrado.
  @Input() embedded = false;
  private readonly tallerService = inject(TallerService);
  private readonly adminService = inject(AdminService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);
  devices: WorkshopDevice[] = [];
  maintenances: Maintenance[] = [];
  // Página actual y tamaño de página de la tabla (paginación en el navegador).
  maintenancePage = 1;
  maintenancePageSize = 10;
  deviceTypes: DeviceType[] = [];
  regionals: RegionalOption[] = [];
  buildings: Building[] = [];
  receptionAreas: Area[] = [];
  selectedReceptionRegionalId: number | null = null;
  selectedReceptionOriginId: number | null = null;
  selectedMaintenance: Maintenance | null = null;
  pendingDeleteMaintenance: Maintenance | null = null;
  activeWindow: 'reception' | 'entry' | 'exit' | 'assessment' | 'assign' | null = null;
  // Ventana "Asignar": técnicos disponibles y el elegido.
  technicians: WorkshopTechnician[] = [];
  selectedTechnicianId: number | null = null;
  isLoadingTechnicians = false;
  isLoading = false;
  isSaving = false;
  isLoadingReceptionAreas = false;
  private receptionAreasRequestId = 0;
  message = '';
  errorMessage = '';
  reception: ReceptionEntryRequest = {
    CodigoInventario: '',
    NoSerie: '',
    Marca: '',
    Modelo: '',
    TipoDispositivo: '',
    DescripcionEquipo: '',
    EquipoEnGarantia: '',
    MemoNumero: '',
    Recibe: '',
    Tecnico: '',
    Departamento: '',
    IdEdificio: 0,
    IdArea: 0,
    FechaIngreso: this.getCurrentDateTime(),
  };
  entry: MaintenanceEntryRequest = { IdEquipo: 0, Dictamen: '', TipoReparacion: '', FechaIngreso: this.getCurrentDateTime() };
  exit: MaintenanceExitRequest = { EquipoFuncional: '', TecnicoEntrega: '', ClienteRecibe: '', FechaEntrega: this.getCurrentDateTime() };
  assessment: MaintenanceAssessmentRequest = { Dictamen: '', PiezasSustituidas: '', Observaciones: '' };
  // "Recibe" (usuario en sesión) y técnico asignado por defecto: se muestran bloqueados en la recepción.
  receptionDefaults: ReceptionDefaults | null = null;
  // En la salida, el técnico que entrega es el asignado a la reparación y no se edita.
  isExitTechnicianLocked = false;

  constructor() {
    if (this.isReceptionOnly) this.activeWindow = 'reception';
    if (this.canReceive) this.loadReceptionDefaults();
    this.loadData();
  }

  loadData(): void {
    // Refresca en paralelo las tablas y datos de equipos, reparaciones y tipos disponibles.
    this.errorMessage = '';
    if (this.canWorkOnRepairs) this.loadMaintenances();
    if (this.isWorkshopAdmin) this.loadDevices();
    if (this.canReceive) {
      this.loadDeviceTypes();
      this.loadRegionals();
      this.loadBuildings();
    }
  }

  get isWorkshopAdmin(): boolean { return this.authService.hasRole(['Admin', 'AdminTaller', 'Taller']); }
  get isReceptionOnly(): boolean { return this.authService.hasRole(['RecepcionTaller']) && !this.isWorkshopAdmin; }
  get isTechnicianOnly(): boolean { return this.authService.hasRole(['TecnicoTaller']) && !this.isWorkshopAdmin; }
  get canReceive(): boolean { return this.isWorkshopAdmin || this.isReceptionOnly; }
  get canWorkOnRepairs(): boolean { return this.isWorkshopAdmin || this.authService.hasRole(['TecnicoTaller']); }

  get combinedOrigins(): { IdEdificio: number; Label: string }[] {
    return this.buildings.map((b) => {
      const reg = this.regionals.find((r) => r.IdRegional === b.IdRegional);
      return {
        IdEdificio: b.IdEdificio,
        Label: reg ? `${b.NombreEdificio} (${reg.NombreRegional})` : b.NombreEdificio,
      };
    }).sort((a, b) => a.Label.localeCompare(b.Label));
  }

  get receptionBuildings(): Building[] {
    return this.selectedReceptionRegionalId === null
      ? []
      : this.buildings.filter((building) => building.IdRegional === this.selectedReceptionRegionalId);
  }

  loadDeviceTypes(): void {
    // Carga los tipos de dispositivo que aparecen en la recepción, asegurando Teléfono y Fotocopiadora.
    this.adminService.getDeviceTypes().subscribe({
      next: (types) => {
        const list = [...types];
        if (!list.some((t) => t.NombreTipo.trim().toUpperCase() === 'TELÉFONO' || t.NombreTipo.trim().toUpperCase() === 'TELEFONO')) {
          list.push({ IdTipo: -1, NombreTipo: 'Teléfono' });
        }
        if (!list.some((t) => t.NombreTipo.trim().toUpperCase() === 'FOTOCOPIADORA')) {
          list.push({ IdTipo: -2, NombreTipo: 'Fotocopiadora' });
        }
        this.deviceTypes = list.sort((a, b) => a.NombreTipo.localeCompare(b.NombreTipo));
      },
      error: () => this.errorMessage = 'No se pudieron cargar los tipos de dispositivo.',
    });
  }

  loadBuildings(): void {
    // Carga los edificios para filtrar después los departamentos de recepción.
    this.adminService.getBuildings().subscribe({
      next: (buildings) => this.buildings = buildings,
      error: () => this.errorMessage = 'No se pudieron cargar los edificios de origen.',
    });
  }

  loadRegionals(): void {
    this.adminService.getRegionals().subscribe({
      next: (regionals) => this.regionals = regionals,
      error: () => this.errorMessage = 'No se pudieron cargar las regionales.',
    });
  }

  selectReceptionOrigin(idEdificio: number | null): void {
    const requestId = ++this.receptionAreasRequestId;
    const building = this.receptionBuildings.find((item) => item.IdEdificio === idEdificio);
    this.selectedReceptionOriginId = building?.IdEdificio ?? null;
    this.reception.IdEdificio = building?.IdEdificio ?? 0;
    this.reception.IdArea = 0;
    this.reception.Departamento = '';
    this.receptionAreas = [];
    this.isLoadingReceptionAreas = false;
    this.errorMessage = '';

    if (!building) {
      return;
    }

    const shouldLoadAreas = !this.adminService.hasAreasCache(building.IdEdificio);
    this.isLoadingReceptionAreas = shouldLoadAreas;
    this.adminService.getAreas(building.IdEdificio).pipe(finalize(() => {
      if (requestId === this.receptionAreasRequestId) {
        this.isLoadingReceptionAreas = false;
        this.changeDetector.markForCheck();
      }
    })).subscribe({
      next: (areas) => {
        if (requestId !== this.receptionAreasRequestId) return;
        this.receptionAreas = areas;
        if (areas.length === 0) {
          this.errorMessage = 'El centro seleccionado no tiene departamentos configurados.';
        }
      },
      error: () => {
        if (requestId === this.receptionAreasRequestId) {
          this.errorMessage = 'No se pudieron cargar los departamentos del centro o regional.';
        }
      },
    });
  }

  selectReceptionBuilding(idEdificio: number | null): void {
    this.selectReceptionOrigin(idEdificio);
  }

  selectReceptionRegional(idRegional: number | null): void {
    this.selectedReceptionRegionalId = this.regionals.some((regional) => regional.IdRegional === idRegional)
      ? idRegional
      : null;
    this.selectedReceptionOriginId = null;
    this.reception.IdEdificio = 0;
    this.reception.IdArea = 0;
    this.reception.Departamento = '';
    this.receptionAreas = [];
    this.receptionAreasRequestId++;
    this.isLoadingReceptionAreas = false;
    this.errorMessage = '';
  }

  selectReceptionArea(idArea: number | null): void {
    const area = this.receptionAreas.find((item) => item.IdArea === idArea
      && item.IdEdificio === this.reception.IdEdificio);
    this.reception.IdArea = area?.IdArea ?? 0;
    this.reception.Departamento = area?.NombreArea ?? '';
    this.errorMessage = '';
  }

  loadDevices(): void {
    // Obtiene equipos disponibles para asociarlos a reparaciones.
    this.tallerService.getDevices().subscribe({
      next: (devices) => this.devices = devices,
      error: () => this.errorMessage = 'No se pudieron cargar los dispositivos desde la base de datos.',
    });
  }

  loadMaintenances(): void {
    // Consulta reparaciones y actualiza el estado de carga de la tabla.
    this.isLoading = true;
    this.tallerService.getMaintenances().subscribe({
      next: (maintenances) => {
        this.maintenances = maintenances;
        this.isLoading = false;
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.isLoading = false;
        this.errorMessage = 'No se pudieron cargar las reparaciones.';
        this.changeDetector.markForCheck();
      },
    });
  }

  openReceptionWindow(): void {
    // Inicializa una recepción nueva con la fecha/hora actual del navegador.
    if (!this.canReceive) return;
    this.message = '';
    this.errorMessage = '';
    this.resetReceptionForm();
    this.activeWindow = 'reception';
  }


  private loadReceptionDefaults(): void {
    this.tallerService.getReceptionDefaults().subscribe({
      next: (defaults) => {
        this.receptionDefaults = defaults;
        this.reception.Recibe = defaults.Recibe;
        this.reception.Tecnico = defaults.Tecnico;
        this.changeDetector.markForCheck();
      },
      // Si no se pueden cargar, el servidor igual completa ambos datos al guardar.
      error: () => this.changeDetector.markForCheck(),
    });
  }

  private resetReceptionForm(): void {
    this.receptionAreasRequestId++;
    this.isLoadingReceptionAreas = false;
    this.reception = {
      CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', TipoDispositivo: '',
      DescripcionEquipo: '', EquipoEnGarantia: '', MemoNumero: '',
      Recibe: this.receptionDefaults?.Recibe ?? '', Tecnico: this.receptionDefaults?.Tecnico ?? '', Departamento: '',
      IdEdificio: 0, IdArea: 0, FechaIngreso: this.getCurrentDateTime(),
    };
    this.selectedReceptionRegionalId = null;
    this.selectedReceptionOriginId = null;
    this.receptionAreas = [];
  }

  async exportWorkshopReport(): Promise<void> {
    if (!this.isWorkshopAdmin) return;
    this.message = '';
    this.errorMessage = '';
    this.isSaving = true;
    try {
      const maintenances = await firstValueFrom(this.tallerService.getMaintenances());
      await this.createWorkshopWorkbook(maintenances);
      this.message = `Reporte del taller exportado: ${maintenances.length} reparaciones.`;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        this.errorMessage = error instanceof HttpErrorResponse
          ? 'No se pudo cargar la información del taller para exportar.'
          : 'No se pudo exportar el reporte del taller.';
      }
    } finally {
      this.isSaving = false;
      this.changeDetector.markForCheck();
    }
  }

  private async createWorkshopWorkbook(maintenances: Maintenance[]): Promise<void> {
    const { default: ExcelJSModule } = await import('exceljs');
    const workbook = new ExcelJSModule.Workbook();
    workbook.creator = 'Sistema inventario';
    workbook.created = new Date();
    workbook.subject = 'Reporte del taller';
    workbook.title = 'Taller';

    // Misma presentación que el reporte de dispositivos: título, resumen y tabla con filtros.
    const repairSheet = workbook.addWorksheet('Reparaciones', { properties: { tabColor: { argb: 'FF4F8A83' } } });
    const columns: Array<[string, number, (item: Maintenance) => string | number | Date]> = [
      ['ID', 10, (item) => item.IdReparacion],
      ['Inventario', 16, (item) => item.CodigoInventario],
      ['No. serie', 22, (item) => item.NoSerie],
      ['Marca', 16, (item) => item.Marca],
      ['Modelo', 20, (item) => item.Modelo],
      ['Tipo Dispositivo', 22, (item) => item.TipoDispositivo ?? ''],
      ['Memo', 16, (item) => item.MemoNumero ?? ''],
      ['Recibe', 24, (item) => item.Recibe ?? ''],
      ['Técnico', 24, (item) => item.Tecnico ?? ''],
      ['Área', 28, (item) => item.Departamento ?? ''],
      ['Descripción del equipo', 36, (item) => item.DescripcionEquipo ?? ''],
      ['Garantía', 12, (item) => item.EquipoEnGarantia ?? ''],
      ['Dictamen', 28, (item) => item.Dictamen ?? ''],
      ['Piezas sustituidas', 32, (item) => item.PiezasSustituidas ?? ''],
      ['Observaciones', 32, (item) => item.Observaciones ?? ''],
      ['Ingreso', 18, (item) => this.toExcelDate(item.FechaIngreso)],
      ['Equipo funcional', 16, (item) => item.EquipoFuncional ?? ''],
      ['Técnico que entrega', 24, (item) => item.TecnicoEntrega ?? ''],
      ['Cliente que recibe', 24, (item) => item.ClienteRecibe ?? ''],
      ['Fecha de entrega', 18, (item) => this.toExcelDate(item.FechaEntrega)],
    ];

    const lastColumn = repairSheet.getColumn(columns.length).letter;
    repairSheet.mergeCells(`A1:${lastColumn}1`);
    repairSheet.getCell('A1').value = 'REPORTE DEL TALLER';
    repairSheet.getCell('A1').font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    repairSheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173F43' } };
    repairSheet.getCell('A1').alignment = { vertical: 'middle' };
    repairSheet.getRow(1).height = 31;
    repairSheet.mergeCells(`A2:${lastColumn}2`);
    const delivered = maintenances.filter((item) => item.FechaEntrega).length;
    repairSheet.getCell('A2').value = `${maintenances.length} reparaciones · ${delivered} entregadas · `
      + `${maintenances.length - delivered} en taller · Generado ${new Date().toLocaleString('es-HN')}`;
    repairSheet.getCell('A2').font = { name: 'Aptos', size: 10, color: { argb: 'FF617573' }, italic: true };

    repairSheet.addTable({
      name: 'ReporteTaller',
      ref: 'A4',
      headerRow: true,
      totalsRow: false,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: columns.map(([name]) => ({ name })),
      // Una tabla de Excel necesita al menos una fila de datos.
      rows: maintenances.length > 0
        ? maintenances.map((item) => columns.map(([, , value]) => value(item)))
        : [columns.map(() => '')],
    });
    columns.forEach(([header, width], index) => {
      const column = repairSheet.getColumn(index + 1);
      column.width = width;
      if (header === 'Ingreso' || header === 'Fecha de entrega') column.numFmt = 'dd/mm/yyyy hh:mm';
    });
    repairSheet.views = [{ state: 'frozen', ySplit: 4 }];

    const buffer = await workbook.xlsx.writeBuffer();
    const workbookBytes = new Uint8Array(buffer).slice();
    if (workbookBytes.byteLength < 4 || workbookBytes[0] !== 0x50 || workbookBytes[1] !== 0x4b) {
      throw new Error('ExcelJS generó un archivo XLSX vacío o inválido.');
    }
    const file = new Blob([workbookBytes.buffer as ArrayBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `reporte-taller-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // Convierte la fecha de la API en fecha de Excel para que se pueda ordenar y filtrar.
  private toExcelDate(value: string | null | undefined): Date | string {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date;
  }

  // En la tabla, los valores vacíos o "PENDIENTE" se muestran como "-".
  display(value: string | null | undefined): string {
    const text = value?.trim() ?? '';
    return text === '' || text.toUpperCase() === 'PENDIENTE' ? '-' : text;
  }

  // El técnico ya respondió el dictamen: en lugar del botón se muestra "Trabajo finalizado".
  hasAssessment(item: Maintenance): boolean {
    return this.display(item.Dictamen) !== '-';
  }

  saveReception(): void {
    // Valida y registra la recepción con la fecha/hora generada por el sistema.
    this.message = '';
    this.errorMessage = '';
    if (!this.reception.CodigoInventario.trim()
      || !this.reception.NoSerie.trim()
      || !this.reception.Marca.trim()
      || !this.reception.Modelo.trim()
      || !this.reception.TipoDispositivo.trim()
      || !this.reception.DescripcionEquipo.trim()
      || !this.reception.EquipoEnGarantia
      || this.reception.IdEdificio <= 0
      || !this.reception.FechaIngreso) {
      this.errorMessage = 'Completa los campos obligatorios del formato físico de recepción.';
      return;
    }

    if (!this.reception.Departamento?.trim()) {
      this.reception.Departamento = '-';
    }
    if (!this.reception.IdArea) {
      this.reception.IdArea = 0;
    }

    this.isSaving = true;
    this.tallerService.createReceptionEntry(this.reception).pipe(
      finalize(() => { this.isSaving = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => {
        this.message = 'Recepción registrada correctamente.';
        this.resetReceptionForm();
        if (this.isReceptionOnly) {
          this.activeWindow = 'reception';
        } else {
          this.closeWindow();
        }
        if (this.canWorkOnRepairs) this.loadMaintenances();
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudo registrar la recepción.');
        this.changeDetector.markForCheck();
      },
    });
  }

  openEntryWindow(): void {
    // Abre el flujo tradicional de ingreso para un equipo ya registrado.
    if (!this.isWorkshopAdmin) return;
    this.message = '';
    this.errorMessage = '';
    this.entry = { IdEquipo: 0, Dictamen: '', TipoReparacion: '', FechaIngreso: this.getCurrentDateTime() };
    this.activeWindow = 'entry';
  }

  // Guarda la información de ingreso 
  saveEntry(): void {
    this.message = '';
    this.errorMessage = '';
    if (this.entry.IdEquipo <= 0 || !this.entry.FechaIngreso) {
      this.errorMessage = 'Selecciona un equipo e indica la fecha de ingreso.';
      this.changeDetector.markForCheck();
      return;
    }
    this.isSaving = true;
    this.tallerService.createMaintenance(this.entry).pipe(
      finalize(() => { this.isSaving = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => {
        this.message = 'Registro guardado correctamente.';
        this.closeWindow();
        this.openEntryWindow();
        this.loadMaintenances();
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudo registrar el ingreso.');
        this.changeDetector.markForCheck();
      },
    });
  }

  openExitWindow(item: Maintenance): void {
    // Prepara la salida usando la reparación elegida como contexto.
    if (!this.canWorkOnRepairs || !this.isOpenMaintenance(item)) return;
    this.message = '';
    this.errorMessage = '';
    this.selectedMaintenance = item;
    this.exit = {
      EquipoFuncional: item.EquipoFuncional ?? '',
      TecnicoEntrega: item.Tecnico?.trim() || item.TecnicoEntrega || '',
      ClienteRecibe: item.ClienteRecibe ?? '',
      FechaEntrega: this.getCurrentDateTime(),
    };
    this.isExitTechnicianLocked = !!item.Tecnico?.trim();
    this.activeWindow = 'exit';
  }

  saveExit(): void {
    // Registra la condición funcional y la constancia de entrega.
    this.message = '';
    this.errorMessage = '';
    if (!this.selectedMaintenance || !this.exit.FechaEntrega
      || !this.exit.EquipoFuncional || !this.exit.TecnicoEntrega.trim() || !this.exit.ClienteRecibe.trim()) {
      this.errorMessage = 'Completa el estado funcional, quién entrega, quién recibe y la fecha de entrega.';
      this.changeDetector.markForCheck();
      return;
    }
    this.isSaving = true;
    this.tallerService.updateMaintenance(this.selectedMaintenance.IdReparacion, this.exit).pipe(
      finalize(() => { this.isSaving = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => {
        this.message = 'Entrega del equipo registrada.';
        this.closeWindow();
        this.loadMaintenances();
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudo registrar la salida.');
        this.changeDetector.markForCheck();
      },
    });
  }

  get isAdmin(): boolean { return this.isWorkshopAdmin; }

  openAssessmentWindow(item: Maintenance): void {
    if (!this.canWorkOnRepairs) return;
    this.message = '';
    this.errorMessage = '';
    this.selectedMaintenance = item;
    this.assessment = {
      Dictamen: item.Dictamen ?? '',
      PiezasSustituidas: item.PiezasSustituidas ?? '',
      Observaciones: item.Observaciones ?? '',
    };
    this.activeWindow = 'assessment';
  }

  saveAssessment(): void {
    if (!this.selectedMaintenance || !this.assessment.Dictamen.trim()) {
      this.errorMessage = 'Ingresa el diagnóstico del equipo.';
      this.changeDetector.markForCheck();
      return;
    }
    this.isSaving = true;
    this.tallerService.updateAssessment(this.selectedMaintenance.IdReparacion, this.assessment).pipe(
      finalize(() => { this.isSaving = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => {
        this.message = 'Dictamen registrado correctamente.';
        this.closeWindow();
        this.loadMaintenances();
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudo guardar el dictamen.');
        this.changeDetector.markForCheck();
      },
    });
  }

  // Abre la ventana para asignar técnico; carga la lista cada vez para incluir usuarios recién creados.
  openAssignWindow(item: Maintenance): void {
    if (!this.isWorkshopAdmin) return;
    this.message = '';
    this.errorMessage = '';
    this.selectedMaintenance = item;
    this.selectedTechnicianId = null;
    this.technicians = [];
    this.isLoadingTechnicians = true;
    this.activeWindow = 'assign';
    this.tallerService.getTechnicians().pipe(
      finalize(() => { this.isLoadingTechnicians = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: (technicians) => {
        this.technicians = technicians;
        // Preselecciona al técnico actual si coincide con uno de la lista.
        const current = (item.Tecnico ?? '').trim().toLocaleLowerCase();
        this.selectedTechnicianId = technicians.find((technician) =>
          technician.Nombre.trim().toLocaleLowerCase() === current)?.IdUsuario ?? null;
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudo cargar la lista de técnicos.');
        this.changeDetector.markForCheck();
      },
    });
  }

  saveAssignment(): void {
    if (!this.selectedMaintenance || this.selectedTechnicianId === null) {
      this.errorMessage = 'Selecciona el técnico que atenderá la reparación.';
      this.changeDetector.markForCheck();
      return;
    }
    const technician = this.technicians.find((item) => item.IdUsuario === this.selectedTechnicianId);
    this.isSaving = true;
    this.tallerService.assignTechnician(this.selectedMaintenance.IdReparacion, this.selectedTechnicianId).pipe(
      finalize(() => { this.isSaving = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => {
        this.message = `Reparación asignada a ${technician?.Nombre ?? 'el técnico seleccionado'}.`;
        this.closeWindow();
        this.loadMaintenances();
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudo asignar el técnico.');
        this.changeDetector.markForCheck();
      },
    });
  }

  // Marca una reparación para su eliminación.
  deleteMaintenance(item: Maintenance): void {
    if (!this.isWorkshopAdmin) return;
    this.pendingDeleteMaintenance = item;
  }

  // Confirma y ejecuta la eliminación de una reparación.
  confirmDeleteMaintenance(): void {
    // Verifica que haya una reparación pendiente de eliminación.
    if (!this.pendingDeleteMaintenance) return;
    const maintenanceId = this.pendingDeleteMaintenance.IdReparacion;
    this.pendingDeleteMaintenance = null;
    this.isSaving = true;
    this.tallerService.deleteMaintenance(maintenanceId).pipe(
      finalize(() => { this.isSaving = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => {
        this.message = 'Reparación eliminada.';
        this.loadMaintenances();
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudo eliminar la reparación.');
        this.changeDetector.markForCheck();
      },
    });
  }

  // Cancela la eliminación de una reparación.
  cancelDeleteMaintenance(): void {
    this.pendingDeleteMaintenance = null;
  }
  // Refresca el panel de información del taller.
  refreshPanel(): void {
    this.message = '';
    this.errorMessage = '';
    this.loadData();
  }

  closeWindow(): void {
    // Cierra cualquier ventana modal y libera la selección actual.
    if (this.isReceptionOnly) {
      this.activeWindow = 'reception';
      this.selectedMaintenance = null;
      return;
    }
    this.activeWindow = null;
    this.selectedMaintenance = null;
  }
  // Obtiene la etiqueta descriptiva de un dispositivo del taller.
  getDeviceLabel(device: WorkshopDevice): string {
    return `${device.CodigoInventario} · ${device.Marca} ${device.Modelo}`;
  }

  // Determina si una reparación aún está abierta (sin fecha de salida).
  isOpenMaintenance(item: Maintenance): boolean { return item.FechaSalida === null; }

  logout(): void {
    // Finaliza la sesión con el logout
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }

  // Obtiene la fecha y hora actual en formato compatible con input[type="datetime-local"].
  private getCurrentDateTime(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

}
