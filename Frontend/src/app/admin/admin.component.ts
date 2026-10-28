import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ViewChild, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DigitsOnlyDirective } from '../shared/digits-only.directive';
import { UppercaseDirective } from '../shared/uppercase.directive';
import { HighlightInvalidDirective, RequiredIdDirective } from '../shared/required-fields.directive';
import { EmployeeLookupComponent, EmployeeLookupResult, findEmployeeIndex } from '../shared/employee-lookup.component';
import { ReportColumn, ReportDateRange, addReportSheet, cellText, createReportWorkbook, dateRangeLabel, downloadReportWorkbook, emptyReportDateRange, excelDate, generatedAt, isInDateRange, isInvalidDateRange, reportFileName } from '../shared/excel-report';
import { PagePipe, TablePageSizeComponent, TablePaginatorComponent, clampPage } from '../shared/table-paginator';
import { Router } from '@angular/router';
import { SearchableSelectDirective } from '../shared/searchable-select.directive';
import { apiErrorMessage } from '../shared/api-response';
import { finalize, forkJoin, retry, timeout } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { AppModules } from '../auth/app-modules';
import { AdminService } from './admin.service';
import { Area, Building, CreateDesktopCombo, CreateDevice, CreateReassignment, Device, DeviceOption, DeviceType, EmployeeOption, Reassignment } from './admin.models';
import { TallerComponent } from '../taller/taller.component';
import { DeviceReportsComponent } from './device-reports.component';
import { DeviceImportComponent } from './device-import.component';
import { EmployeeSearchDialogComponent } from './employee-search-dialog.component';
import { CatalogManagementComponent } from './catalog-management.component';
import { UserManagementComponent } from './user-management.component';
import { EmployeeManagementComponent } from './employee-management.component';
import { TicketsComponent } from '../tickets/tickets.component';
import { AppHeaderComponent } from '../shared/app-header.component';

type AdminSection = 'devices' | 'reassignments' | 'users' | 'workshop' | 'catalogs' | 'employees' | 'tickets';

// Opción del filtro de tipo que muestra la vista agrupada de combos de escritorio.
const COMBO_FILTER = 'COMBOS';

const emptyDevice = (): CreateDevice => ({
  CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null,
  Estado: 'DISPONIBLE', NumeroPagoAsignado: null, NombreAsignado: null, IdArea: null,
});

const emptyReassignment = (): CreateReassignment =>
  ({ IdEquipo: 0, NoPagoNuevo: null, NombreNuevo: '', Motivo: '', IdEdificio: 0, IdArea: 0 });

// Módulo que habilita cada sección del panel.
const SECTION_MODULES: Record<AdminSection, string> = {
  devices: AppModules.Devices,
  reassignments: AppModules.Reassignments,
  workshop: AppModules.Workshop,
  users: AppModules.Users,
  catalogs: AppModules.Maintenance,
  employees: AppModules.Employees,
  tickets: AppModules.Tickets,
};

@Component({
  selector: 'app-admin',
  imports: [DatePipe, FormsModule, SearchableSelectDirective, TallerComponent, DeviceReportsComponent, EmployeeSearchDialogComponent, CatalogManagementComponent, UserManagementComponent, EmployeeManagementComponent, TicketsComponent, AppHeaderComponent, DeviceImportComponent, PagePipe, TablePageSizeComponent, TablePaginatorComponent, DigitsOnlyDirective, UppercaseDirective, HighlightInvalidDirective, RequiredIdDirective, EmployeeLookupComponent],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.css',
  // Angular 22 usa OnPush por defecto; varias respuestas HTTP de este panel actualizan la vista
  // sin markForCheck, por eso conserva la detección automática.
  changeDetection: ChangeDetectionStrategy.Eager,
})
// Componente principal de la sección administrativa: gestiona dispositivos, reasignaciones, usuarios y taller.
export class AdminComponent {
  // Orquesta las secciones administrativas: dispositivos, reasignaciones, usuarios,
  // taller y mantenimiento. Usuarios, taller y mantenimiento viven en componentes
  // propios; aquí se conservan formularios, modales, mensajes y paginación del resto.
  // Las propiedades siguientes representan el estado visible de toda la pantalla.
  private readonly adminService = inject(AdminService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);
  activeSection: AdminSection = 'devices';
  isDeviceReportsOpen = false;
  // Ventana del reporte de reasignaciones: rango de fecha del cambio.
  isReassignmentReportOpen = false;
  isExportingReassignments = false;
  reassignmentReportRange: ReportDateRange = emptyReportDateRange();
  isDeviceImportOpen = false;
  devices: Device[] = [];
  totalDeviceCount = 0;
  totalComboCount = 0;
  reassignments: Reassignment[] = [];
  areas: Area[] = [];
  employeesForDeviceArea: EmployeeOption[] = [];
  selectedEmployeeIndex: number | null = null;
  isLoadingEmployeesForDevice = false;
  isLoadingEmployeeCatalog = false;
  employeeCatalogError = '';
  private employeeOptionsRequestId = 0;
  isLoadingAreas = false;
  isLoadingFilterAreas = false;
  isLoadingReassignmentAreas = false;
  buildings: Building[] = [];
  selectedBuildingId: number | null = null;
  selectedRegionId: number | null = null;
  selectedRegionalFilterId: number | null = null;
  selectedBuildingFilterId: number | null = null;
  selectedAreaFilterId: number | null = null;
  filterAreas: Area[] = [];
  deviceTypes: DeviceType[] = [];
  readonly desktopComputerTypeName = 'COMPUTADORA ESCRITORIO';
  readonly comboFilter = COMBO_FILTER;
  newDesktopCombo: CreateDesktopCombo = this.createEmptyDesktopCombo();
  editingDeviceId: number | null = null;
  editingDeviceNCombo = '';
  // Al editar una pieza de combo: true reasigna todas las piezas; false saca solo esta pieza del combo.
  applyEditToCombo = false;
  // Botón "Asignar" de un equipo disponible: el diálogo de edición deja los datos del equipo
  // en solo lectura y solo pide la ubicación y el empleado.
  isAssignMode = false;
  isEditDialogOpen = false;
  isCreateDeviceDialogOpen = false;
  deviceBatchCount = 1;
  deviceBatchCurrent = 1;
  batchSuccessMessage = '';
  // Equipo que espera confirmación para eliminarse; mientras no es null se muestra el modal.
  pendingDeviceId: number | null = null;
  message = '';
  errorMessage = '';
  isLoadingDevices = false;
  private readonly devicePageSize = 25;
  currentPage = 1;
  reassignmentPageSize = 10;
  reassignmentCurrentPage = 1;
  reassignmentSearchTerm = '';
  searchTerm = '';
  selectedBrand = '';
  selectedModel = '';
  selectedDeviceStatus = '';
  showCombosOnly = false;
  selectedTypeId: number | null = null;
  private deviceFilterTimer: ReturnType<typeof setTimeout> | null = null;
  private deviceRequestId = 0;
  private filterAreaRequestId = 0;
  private reassignmentAreaRequestId = 0;
  showEmployeeSearch = false;
  deviceOptions: DeviceOption[] = [];
  deviceOptionSearch = '';
  @ViewChild(TallerComponent) workshopComponent?: TallerComponent;
  @ViewChild(UserManagementComponent) userManagement?: UserManagementComponent;
  @ViewChild(CatalogManagementComponent) catalogManagement?: CatalogManagementComponent;

  // Estado inicial para la creación de un nuevo dispositivo o reasignación.
  newDevice: CreateDevice = emptyDevice();
  newReassignment: CreateReassignment = emptyReassignment();
  reassignmentRegionalId: number | null = null;
  reassignmentBuildingId = 0;
  reassignmentAreas: Area[] = [];
  reassignmentEmployees: EmployeeOption[] = [];
  selectedReassignmentEmployeeIndex: number | null = null;
  isLoadingReassignmentEmployees = false;
  isSubmittingReassignment = false;
  private reassignmentEmployeeRequestId = 0;
  selectedInventoryCode = '';
  private deviceOptionSearchTimer: ReturnType<typeof setTimeout> | null = null;
  // Constructor y métodos de inicialización.
  constructor() {
    this.activeSection = this.firstPermittedAdminSection();
    this.loadData();
    // Evita que una búsqueda con retardo se dispare después de salir del panel.
    inject(DestroyRef).onDestroy(() => {
      if (this.deviceFilterTimer) clearTimeout(this.deviceFilterTimer);
      if (this.deviceOptionSearchTimer) clearTimeout(this.deviceOptionSearchTimer);
    });
  }

  canAccessAdminSection(section: AdminSection): boolean {
    return this.authService.hasModule(SECTION_MODULES[section]);
  }

  get panelTitle(): string {
    if (this.authService.hasRole(['Admin'])) return 'Panel de administrador';
    if (this.authService.hasRole(['UsuarioComun'])) return 'Panel de usuario';
    if (this.authService.hasRole(['Taller', 'AdminTaller', 'RecepcionTaller', 'TecnicoTaller'])) return 'Panel de taller';
    return 'Panel de gestión';
  }

  get hasAdminButtonTheme(): boolean {
    return this.authService.hasRole(['Admin']);
  }

  private firstPermittedAdminSection(): AdminSection {
    const sections: AdminSection[] = ['devices', 'reassignments', 'workshop', 'users', 'catalogs', 'employees', 'tickets'];
    return sections.find((section) => this.canAccessAdminSection(section)) ?? 'devices';
  }

  get hasDeviceQuery(): boolean {
    return this.searchTerm.trim().length > 0
      || this.selectedBrand.trim().length > 0
      || this.selectedModel.trim().length > 0
      || this.selectedDeviceStatus.trim().length > 0
      || this.selectedTypeId !== null
      || this.selectedRegionalFilterId !== null
      || this.selectedBuildingFilterId !== null
      || this.selectedAreaFilterId !== null
      || this.showCombosOnly;
  }

  // Métodos para la paginación de dispositivos.
  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalDeviceCount / this.effectiveDevicePageSize));
  }

  get effectiveDevicePageSize(): number {
    return this.showCombosOnly ? 30 : this.devicePageSize;
  }

  get comboGroups(): { NCombo: string; Devices: Device[] }[] {
    const groups = new Map<string, Device[]>();
    for (const device of this.devices) {
      if (!device.NCombo) continue;
      const group = groups.get(device.NCombo) ?? [];
      group.push(device);
      groups.set(device.NCombo, group);
    }
    const componentOrder: Record<string, number> = { CPU: 0, TECLADO: 1, MONITOR: 2 };
    return [...groups].map(([NCombo, Devices]) => ({
      NCombo,
      Devices: Devices.sort((first, second) =>
        (componentOrder[first.Componente?.toUpperCase() ?? ''] ?? 3)
        - (componentOrder[second.Componente?.toUpperCase() ?? ''] ?? 3)),
    }));
  }

  get filteredReassignments(): Reassignment[] {
    // Busca por inventario y/o nombre (o No. de pago) del responsable anterior o actual;
    // con varias palabras, cada una debe aparecer en alguno de esos datos ("4110935 juan").
    const terms = this.reassignmentSearchTerm.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return this.reassignments;
    return this.reassignments.filter((item) => {
      const text = [item.CodigoInventario, item.NombreAnterior, item.NombreNuevo, item.NoPagoAnterior, item.NoPagoNuevo]
        .map((value) => String(value ?? '').toLocaleLowerCase()).join(' ');
      return terms.every((term) => text.includes(term));
    });
  }

  get regionalOptions(): { IdRegional: number; NombreRegional: string }[] {
    const regions = new Map<number, string>();
    this.buildings.forEach((building) => {
      if (building.IdRegional !== null && building.NombreRegional) regions.set(building.IdRegional, building.NombreRegional);
    });
    return [...regions].map(([IdRegional, NombreRegional]) => ({ IdRegional, NombreRegional }));
  }

  get filterBuildings(): Building[] {
    return this.selectedRegionalFilterId === null
      ? this.buildings
      : this.buildings.filter((building) => building.IdRegional === this.selectedRegionalFilterId);
  }

  get deviceFormBuildings(): Building[] {
    return this.selectedRegionId === null
      ? this.buildings
      : this.buildings.filter((building) => building.IdRegional === this.selectedRegionId);
  }

  get desktopComputerTypeId(): number | null {
    return this.deviceTypes.find((type) => type.NombreTipo.trim().toLocaleUpperCase() === this.desktopComputerTypeName)?.IdTipo ?? null;
  }

  get deviceFilterTypes(): DeviceType[] {
    return this.deviceTypes.filter((type) => type.NombreTipo.trim().toLocaleUpperCase() !== this.desktopComputerTypeName);
  }

  get isDesktopComboSelected(): boolean {
    return this.newDevice.IdTipo !== null && this.newDevice.IdTipo === this.desktopComputerTypeId;
  }

  get reassignmentBuildings(): Building[] {
    return this.reassignmentRegionalId === null
      ? this.buildings
      : this.buildings.filter((building) => building.IdRegional === this.reassignmentRegionalId);
  }
  // Tras una carga masiva se recargan los filtros (pudo crearse un tipo nuevo) y la
  // tabla si hay una búsqueda activa.
  onDevicesImported(): void {
    this.loadData();
    this.message = 'Dispositivos importados como disponibles. Asigna el empleado y el área desde la edición de cada equipo.';
  }

  // Botón Refrescar del encabezado: vuelve a pedir al servidor los catálogos (tipos, edificios, áreas,
  // empleados) y los datos de la sección abierta, y avisa cuando termina de solicitarlos.
  refreshPanel(): void {
    this.adminService.clearCatalogCaches();
    this.clearMessages();
    if (this.activeSection === 'catalogs') this.catalogManagement?.loadCatalogs();
    else this.loadData();
  }

  refreshEmployeeOptions(): void {
    this.adminService.clearEmployeeOptionsCache();
  }

  loadData(): void {
    // Carga únicamente los datos de la sección activa para evitar peticiones innecesarias.
    this.errorMessage = '';
    if (this.activeSection === 'devices') {
      forkJoin({
        deviceTypes: this.adminService.getDeviceTypes(),
        buildings: this.adminService.getBuildings(),
      }).subscribe({
        next: (data) => {
          const typesById = new Map<number, DeviceType>();
          data.deviceTypes.forEach((type) => {
              const currentType = typesById.get(type.IdTipo);
              if (!currentType?.NombreTipo && type.NombreTipo) typesById.set(type.IdTipo, type);
            });
          this.deviceTypes = [...typesById.values()].sort((first, second) => first.NombreTipo.localeCompare(second.NombreTipo));
          this.buildings = data.buildings;
          this.changeDetector.markForCheck();
        },
        error: () => {
          this.errorMessage = 'No se pudieron cargar los filtros de dispositivos.';
          this.changeDetector.markForCheck();
        },
      });
      if (this.hasDeviceQuery) this.loadDevicePage();
      else this.clearDeviceResults();
      return;
    }

    if (this.activeSection === 'users') {
      this.userManagement?.reload();
      return;
    }

    if (this.activeSection === 'workshop') {
      this.workshopComponent?.loadData();
      return;
    }

    // Catálogos, empleados y tickets cargan sus propios datos.
    if (this.activeSection !== 'reassignments') return;

    this.adminService.getReassignments().pipe(retry({ count: 3, delay: 1000 })).subscribe({
      next: (items) => {
        this.reassignments = items;
        this.reassignmentCurrentPage = clampPage(this.reassignmentCurrentPage, this.filteredReassignments.length, this.reassignmentPageSize);
        // Angular 22 usa OnPush por defecto: hay que avisar que la vista cambió al llegar la respuesta.
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudieron cargar las reasignaciones.');
        this.changeDetector.markForCheck();
      },
    });
  }

  selectSection(section: AdminSection): void {
    // Cambia de sección, limpia mensajes y dispara su recarga.
    if (!this.canAccessAdminSection(section)) return;
    this.activeSection = section;
    if (section === 'reassignments') this.reassignmentCurrentPage = 1;
    this.clearMessages();
    // La sección Usuarios conserva su lista y se recarga sola si la primera carga falló.
    if (section === 'users') return;
    this.loadData();
  }

  logout(): void {
    // Cierra la sesión local y devuelve al usuario a la pantalla de login.
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }

  goToPage(page: number): void {
    // Limita la página solicitada al rango válido antes de actualizar la tabla.
    if (this.isLoadingDevices) return;
    if (this.deviceFilterTimer) {
      clearTimeout(this.deviceFilterTimer);
      this.deviceFilterTimer = null;
    }
    const requestedPage = Math.min(Math.max(page, 1), this.totalPages);
    if (requestedPage === this.currentPage) return;
    this.currentPage = requestedPage;
    this.loadDevicePage();
  }

  updateReassignmentSearch(value: string): void {
    this.reassignmentSearchTerm = value;
    this.reassignmentCurrentPage = 1;
  }

  // Los selectores buscan de inmediato; el texto libre espera a que el usuario deje de
  // escribir (debounce) para no lanzar una consulta por cada tecla.
  applyFilters(debounce = false): void {
    this.currentPage = 1;
    if (this.deviceFilterTimer) clearTimeout(this.deviceFilterTimer);
    this.deviceFilterTimer = null;
    if (!this.hasDeviceQuery) {
      this.clearDeviceResults();
      return;
    }
    if (!debounce) {
      this.loadDevicePage();
      return;
    }
    this.deviceFilterTimer = setTimeout(() => {
      this.deviceFilterTimer = null;
      this.loadDevicePage();
    }, 300);
  }

  // Valor del selector único de tipo: null (todos), un ID de tipo o la vista de combos.
  get typeFilterValue(): number | typeof COMBO_FILTER | null {
    return this.showCombosOnly ? COMBO_FILTER : this.selectedTypeId;
  }

  selectTypeFilter(value: number | typeof COMBO_FILTER | null): void {
    this.showCombosOnly = value === COMBO_FILTER;
    this.selectedTypeId = value === COMBO_FILTER ? null : value;
    this.currentPage = 1;
    this.applyFilters();
  }

  // Limpia los filtros aplicados a la lista de dispositivos.
  clearFilters(): void {
    this.searchTerm = '';
    this.selectedBrand = '';
    this.selectedModel = '';
    this.selectedDeviceStatus = '';
    this.selectedTypeId = null;
    this.showCombosOnly = false;
    this.selectedRegionalFilterId = null;
    this.selectedBuildingFilterId = null;
    this.selectedAreaFilterId = null;
    this.filterAreas = [];
    this.filterAreaRequestId++;
    this.isLoadingFilterAreas = false;
    this.currentPage = 1;
    if (this.deviceFilterTimer) {
      clearTimeout(this.deviceFilterTimer);
      this.deviceFilterTimer = null;
    }
    this.errorMessage = '';
    this.clearDeviceResults();
  }

  loadDevicePage(): void {
    if (this.activeSection !== 'devices') return;
    if (!this.hasDeviceQuery) {
      this.clearDeviceResults();
      return;
    }
    this.isLoadingDevices = true;
    const requestId = ++this.deviceRequestId;
    this.adminService.getDevices({
      Page: this.currentPage,
      PageSize: this.effectiveDevicePageSize,
      SearchTerm: this.searchTerm,
      Brand: this.selectedBrand,
      Model: this.selectedModel,
      TypeId: this.selectedTypeId,
      RegionalId: this.selectedRegionalFilterId,
      BuildingId: this.selectedBuildingFilterId,
      AreaId: this.selectedAreaFilterId,
      State: this.selectedDeviceStatus,
      ComboOnly: this.showCombosOnly,
    }).pipe(
      timeout({ first: 10000 }),
      finalize(() => {
        if (requestId === this.deviceRequestId) {
          this.isLoadingDevices = false;
          this.changeDetector.markForCheck();
        }
      }),
    ).subscribe({
      next: (result) => {
        if (requestId !== this.deviceRequestId) return;
        this.devices = result.Items;
        this.totalDeviceCount = result.TotalCount;
        this.totalComboCount = result.ComboCount;
        this.currentPage = result.Page;
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        if (requestId === this.deviceRequestId) {
          this.errorMessage = apiErrorMessage(error, 'No se pudieron cargar los dispositivos.');
          this.changeDetector.markForCheck();
        }
      },
    });
  }

  private clearDeviceResults(): void {
    this.deviceRequestId++;
    this.devices = [];
    this.totalDeviceCount = 0;
    this.totalComboCount = 0;
    this.currentPage = 1;
    this.isLoadingDevices = false;
    this.changeDetector.markForCheck();
  }

  selectRegionalFilter(idRegional: number | null): void {
    this.selectedRegionalFilterId = idRegional;
    this.selectedBuildingFilterId = null;
    this.selectedAreaFilterId = null;
    this.filterAreas = [];
    this.filterAreaRequestId++;
    this.isLoadingFilterAreas = false;
    this.applyFilters();
  }

  selectBuildingFilter(idEdificio: number | null): void {
    this.selectedBuildingFilterId = idEdificio;
    this.selectedAreaFilterId = null;
    this.filterAreas = [];
    const requestId = ++this.filterAreaRequestId;
    const shouldLoadAreas = idEdificio !== null && !this.adminService.hasAreasCache(idEdificio);
    this.isLoadingFilterAreas = shouldLoadAreas;
    if (idEdificio !== null) {
      this.adminService.getAreas(idEdificio).pipe(finalize(() => {
        if (requestId !== this.filterAreaRequestId) return;
        this.isLoadingFilterAreas = false;
        this.changeDetector.markForCheck();
      })).subscribe({
        next: (areas) => {
          if (requestId !== this.filterAreaRequestId) return;
          this.filterAreas = areas;
          this.changeDetector.markForCheck();
        },
        error: () => {
          if (requestId !== this.filterAreaRequestId) return;
          this.errorMessage = 'No se pudieron cargar las áreas del edificio.';
          this.changeDetector.markForCheck();
        },
      });
    }
    this.applyFilters();
  }

  // Elegir ubicación o empleado en los formularios de dispositivo implica que el equipo
  // queda asignado (un equipo disponible no conserva área ni responsable).
  markDeviceAssigned(value: unknown): void {
    if (value !== null && value !== undefined && this.newDevice.Estado !== 'ASIGNADO') {
      this.newDevice.Estado = 'ASIGNADO';
    }
  }

  selectDeviceRegion(idRegional: number | null): void {
    this.markDeviceAssigned(idRegional);
    this.selectedRegionId = idRegional;
    this.selectedBuildingId = null;
    this.newDevice.IdArea = null;
    this.areas = [];
    this.clearDeviceEmployeeSelection();
  }

  searchDeviceOptions(): void {
    if (this.deviceOptionSearchTimer) clearTimeout(this.deviceOptionSearchTimer);
    this.selectedInventoryCode = '';
    this.newReassignment.IdEquipo = 0;
    this.deviceOptions = [];
    const searchTerm = this.deviceOptionSearch.trim();
    if (searchTerm.length < 2) return;
    this.deviceOptionSearchTimer = setTimeout(() => {
      this.deviceOptionSearchTimer = null;
      this.adminService.searchDeviceOptions(searchTerm).subscribe({
        next: (options) => this.deviceOptions = options,
        error: () => this.errorMessage = 'No se pudieron buscar dispositivos.',
      });
    }, 250);
  }

  // Selección de edificio y carga de áreas correspondientes. 
  selectBuilding(idEdificio: number | null): void {
    this.markDeviceAssigned(idEdificio);
    const buildingId = Number(idEdificio);
    this.selectedBuildingId = buildingId || null;
    this.selectedRegionId = this.buildings.find((building) => building.IdEdificio === this.selectedBuildingId)?.IdRegional ?? null;
    this.newDevice.IdArea = null;
    this.areas = [];
    this.clearDeviceEmployeeSelection();
    const shouldLoadAreas = buildingId > 0 && !this.adminService.hasAreasCache(buildingId);
    this.isLoadingAreas = shouldLoadAreas;
    if (buildingId > 0) {
      this.adminService.getAreas(buildingId).pipe(finalize(() => this.isLoadingAreas = false)).subscribe({
        next: (areas) => this.areas = areas,
        error: () => this.errorMessage = 'No se pudieron cargar las áreas del edificio.',
      });
    }
  }

  // Empleado elegido con el buscador: completa Regional, Edificio, Departamento y el empleado
  // (sirve igual para Agregar y Editar dispositivo).
  applyDeviceEmployee(employee: EmployeeLookupResult): void {
    this.selectBuilding(employee.IdEdificio);
    if (employee.IdRegional !== null) this.selectedRegionId = employee.IdRegional;
    if (employee.IdArea !== null) this.selectDeviceArea(employee.IdArea, employee);
    this.markDeviceAssigned(employee.NombreCompleto);
    this.newDevice.NombreAsignado = employee.NombreCompleto;
    this.newDevice.NumeroPagoAsignado = employee.NoPago || null;
  }

  // preselect: empleado del buscador que queda elegido en el combo cuando termina de cargar la lista.
  selectDeviceArea(idArea: number | null, preselect?: EmployeeLookupResult): void {
    this.markDeviceAssigned(idArea);
    this.newDevice.IdArea = idArea;
    this.clearDeviceEmployeeSelection();
    this.employeeCatalogError = '';
    if (idArea === null) return;

    const requestId = ++this.employeeOptionsRequestId;
    this.isLoadingEmployeeCatalog = true;
    this.isLoadingEmployeesForDevice = true;
    this.adminService.getEmployeeOptions(idArea).pipe(finalize(() => {
      if (requestId !== this.employeeOptionsRequestId) return;
      this.isLoadingEmployeeCatalog = false;
      this.isLoadingEmployeesForDevice = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: (employees) => {
        if (requestId !== this.employeeOptionsRequestId) return;
        this.employeesForDeviceArea = employees;
        const index = preselect ? findEmployeeIndex(employees, preselect) : -1;
        if (index >= 0) this.selectDeviceEmployee(index);
        this.changeDetector.markForCheck();
      },
      error: () => {
        if (requestId !== this.employeeOptionsRequestId) return;
        this.employeeCatalogError = 'No se pudo cargar el catálogo de empleados. Verifica la conexión con la API.';
        this.changeDetector.markForCheck();
      },
    });
  }

  selectDeviceEmployee(employeeIndex: number | null): void {
    this.markDeviceAssigned(employeeIndex);
    this.selectedEmployeeIndex = employeeIndex;
    const employee = employeeIndex === null ? undefined : this.employeesForDeviceArea[employeeIndex];
    this.newDevice.NumeroPagoAsignado = employee?.NoPago || null;
    this.newDevice.NombreAsignado = employee?.NombreCompleto ?? null;
  }

  handleDeviceTypeChange(idTipo: number | null): void {
    this.newDevice.IdTipo = idTipo;
    if (this.isDesktopComboSelected) {
      this.deviceBatchCount = 1;
    }
  }

  onPaymentNumberInput(target: { NumeroPagoAsignado: string | null }): void {
    if (target.NumeroPagoAsignado) {
      target.NumeroPagoAsignado = target.NumeroPagoAsignado.replace(/\D/g, '').slice(0, 5);
      const match = this.employeesForDeviceArea.find(e => e.NoPago?.trim() === target.NumeroPagoAsignado?.trim());
      if (match && this.newDevice) {
        this.newDevice.NombreAsignado = match.NombreCompleto;
      }
    }
  }

  onReassignmentPaymentChange(): void {
    if (this.newReassignment.NoPagoNuevo) {
      this.newReassignment.NoPagoNuevo = this.newReassignment.NoPagoNuevo.replace(/\D/g, '').slice(0, 5);
      const match = this.reassignmentEmployees.find(e => e.NoPago?.trim() === this.newReassignment.NoPagoNuevo?.trim());
      if (match) {
        this.newReassignment.NombreNuevo = match.NombreCompleto;
      }
    }
  }

  onReassignmentEmployeeNameChange(): void {
    const name = this.newReassignment.NombreNuevo?.trim().toUpperCase();
    if (name) {
      const match = this.reassignmentEmployees.find(e => e.NombreCompleto.trim().toUpperCase() === name);
      if (match && match.NoPago) {
        this.newReassignment.NoPagoNuevo = match.NoPago;
      }
    }
  }

  private clearDeviceEmployeeSelection(): void {
    this.employeeOptionsRequestId++;
    this.employeesForDeviceArea = [];
    this.selectedEmployeeIndex = null;
    this.newDevice.NumeroPagoAsignado = null;
    this.newDevice.NombreAsignado = null;
    this.isLoadingEmployeeCatalog = false;
    this.isLoadingEmployeesForDevice = false;
  }

  handleDeviceStateChange(state: string): void {
    // Un equipo disponible no puede conservar responsable, pago ni área asignada.
    if (state === 'DISPONIBLE') {
      this.newDevice.NumeroPagoAsignado = null;
      this.newDevice.NombreAsignado = null;
      this.newDevice.IdArea = null;
      this.selectedBuildingId = null;
      this.selectedRegionId = null;
      this.areas = [];
      this.clearDeviceEmployeeSelection();
    }
  }

  openDeviceCreateDialog(): void {
    this.resetDeviceCreateForm();
    this.isCreateDeviceDialogOpen = true;
  }

  closeDeviceCreateDialog(): void {
    this.isCreateDeviceDialogOpen = false;
    this.resetDeviceCreateForm();
  }

  private resetDeviceCreateForm(): void {
    this.newDevice = emptyDevice();
    this.newDesktopCombo = this.createEmptyDesktopCombo();
    this.selectedBuildingId = null;
    this.selectedRegionId = null;
    this.areas = [];
    this.deviceBatchCount = 1;
    this.deviceBatchCurrent = 1;
    this.batchSuccessMessage = '';
    this.clearDeviceEmployeeSelection();
    this.errorMessage = '';
  }

  addDevice(): void {
    // Decide entre crear o actualizar según exista un ID en edición.
    this.clearMessages();
    this.batchSuccessMessage = '';
    if (this.isDesktopComboSelected) {
      this.addDesktopCombo();
      return;
    }
    if (!this.isDeviceComplete(this.newDevice)) {
      this.errorMessage = 'Completa código, número de serie, marca, modelo y tipo de dispositivo.';
      return;
    }
    if (this.newDevice.Estado === 'ASIGNADO' && !this.newDevice.NombreAsignado?.trim() && !this.newDevice.NumeroPagoAsignado?.trim() && this.selectedEmployeeIndex === null) {
      this.errorMessage = 'Indica el empleado asignado o selecciónalo de la lista.';
      return;
    }
    const device = this.normalizeDevice(this.newDevice);
    const isNew = this.editingDeviceId === null;
    const request = isNew
      ? this.adminService.createDevice(device)
      : this.adminService.updateDevice(this.editingDeviceId!, device);

    request.subscribe({
      next: () => {
        this.loadData();
        if (isNew && this.deviceBatchCount > 1 && this.deviceBatchCurrent < this.deviceBatchCount) {
          // Conserva tipo, marca, modelo y ubicación; inventario y serie se limpian para el siguiente equipo
          const prevTipo = this.newDevice.IdTipo;
          const prevMarca = this.newDevice.Marca;
          const prevModelo = this.newDevice.Modelo;
          const prevEstado = this.newDevice.Estado;
          const prevArea = this.newDevice.IdArea;
          const prevRegional = this.selectedRegionId;
          const prevEdificio = this.selectedBuildingId;
          const prevPago = this.newDevice.NumeroPagoAsignado;
          const prevNombre = this.newDevice.NombreAsignado;
          this.deviceBatchCurrent++;
          this.batchSuccessMessage = `Dispositivo ${this.deviceBatchCurrent - 1} guardado. Ingrese el dispositivo ${this.deviceBatchCurrent} de ${this.deviceBatchCount}.`;

          this.newDevice = {
            CodigoInventario: '',
            NoSerie: '',
            Marca: prevMarca,
            Modelo: prevModelo,
            IdTipo: prevTipo,
            Estado: prevEstado,
            NumeroPagoAsignado: prevPago,
            NombreAsignado: prevNombre,
            IdArea: prevArea,
          };
          this.selectedRegionId = prevRegional;
          this.selectedBuildingId = prevEdificio;
        } else {
          const totalAdded = isNew ? this.deviceBatchCount : 1;
          this.editingDeviceId = null;
          this.closeDeviceCreateDialog();
          this.message = totalAdded > 1
            ? `Se agregaron los ${totalAdded} dispositivos correctamente.`
            : isNew
            ? 'Dispositivo agregado correctamente.'
            : 'Dispositivo actualizado correctamente.';
        }
      },
      error: (error) => this.errorMessage = apiErrorMessage(error, 'No se pudo agregar el dispositivo.'),
    });
  }

  private addDesktopCombo(): void {
    const components = this.newDesktopCombo.Componentes;
    if (!this.newDesktopCombo.NCombo.trim()
      || components.some((component) => !this.isDeviceComplete({
        ...component,
        IdTipo: this.newDevice.IdTipo,
        Estado: this.newDevice.Estado,
        NumeroPagoAsignado: this.newDevice.NumeroPagoAsignado,
        NombreAsignado: this.newDevice.NombreAsignado,
        IdArea: this.newDevice.IdArea,
      }))) {
      this.errorMessage = 'Completa el número de combo y los datos de inventario, serie, marca y modelo de CPU, monitor y teclado.';
      return;
    }
    if (this.newDevice.Estado === 'ASIGNADO'
      && !this.newDevice.NombreAsignado?.trim()
      && !this.newDevice.NumeroPagoAsignado?.trim()
      && this.selectedEmployeeIndex === null) {
      this.errorMessage = 'Indica el empleado asignado o selecciónalo de la lista.';
      return;
    }

    const combo: CreateDesktopCombo = {
      ...this.newDesktopCombo,
      NCombo: this.newDesktopCombo.NCombo.trim(),
      IdTipo: this.newDevice.IdTipo!,
      Estado: this.newDevice.Estado,
      NumeroPagoAsignado: this.newDevice.NumeroPagoAsignado?.trim() || null,
      NombreAsignado: this.newDevice.NombreAsignado?.trim() || null,
      IdArea: this.newDevice.Estado === 'DISPONIBLE' ? null : this.newDevice.IdArea,
    };
    this.adminService.createDesktopCombo(combo).subscribe({
      next: () => {
        this.loadData();
        this.closeDeviceCreateDialog();
        this.message = 'Combo de computadora de escritorio agregado correctamente.';
      },
      error: (error) => this.errorMessage = apiErrorMessage(error, 'No se pudo agregar el combo de computadora.'),
    });
  }

  editDevice(device: Device): void {
    // Copia el equipo seleccionado al formulario para convertirlo en modo edición.
    this.isAssignMode = false;
    this.editingDeviceId = device.IdEquipo;
    this.editingDeviceNCombo = device.NCombo ?? '';
    this.applyEditToCombo = false;
    this.selectedBuildingId = device.Estado === 'DISPONIBLE' ? null : device.IdEdificio;
    this.selectedRegionId = device.Estado === 'DISPONIBLE' ? null : device.IdRegional;
    this.areas = [];
    this.clearDeviceEmployeeSelection();
    this.employeeCatalogError = '';
    if (this.selectedBuildingId !== null) {
      this.adminService.getAreas(this.selectedBuildingId).subscribe((areas) => this.areas = areas);
    }
    if (device.IdArea !== null && device.Estado === 'ASIGNADO') {
      this.loadEmployeesForEdit(device.IdArea, device.NumeroPagoAsignado, device.AsignadoA ?? device.NombreAsignado);
    }
    this.newDevice = {
      CodigoInventario: device.CodigoInventario,
      NoSerie: device.NoSerie,
      Marca: device.Marca,
      Modelo: device.Modelo,
      IdTipo: device.IdTipo,
      Estado: device.Estado,
      NumeroPagoAsignado: device.NumeroPagoAsignado,
      NombreAsignado: device.NombreAsignado,
      IdArea: device.IdArea,
    };
    this.activeSection = 'devices';
    this.isEditDialogOpen = true;
    this.clearMessages();
  }

  // Asigna un equipo disponible: mismos datos que Editar, pero solo se elige a quién y dónde.
  // En un combo nuevo se asignan las tres piezas juntas (se puede desmarcar).
  assignDevice(device: Device): void {
    this.editDevice(device);
    this.isAssignMode = true;
    this.newDevice.Estado = 'ASIGNADO';
    this.applyEditToCombo = !!device.NCombo;
  }

  // Carga los empleados del departamento del equipo y deja seleccionado al responsable
  // actual (por No. de pago o, si no tiene, por nombre).
  private loadEmployeesForEdit(idArea: number, currentPayment: string | null, currentName: string | null): void {
    const requestId = ++this.employeeOptionsRequestId;
    this.isLoadingEmployeesForDevice = true;
    this.adminService.getEmployeeOptions(idArea).pipe(finalize(() => {
      if (requestId !== this.employeeOptionsRequestId) return;
      this.isLoadingEmployeesForDevice = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: (employees) => {
        if (requestId !== this.employeeOptionsRequestId) return;
        this.employeesForDeviceArea = employees;
        const payment = currentPayment?.trim();
        const name = currentName?.trim().toUpperCase();
        const index = employees.findIndex((employee) => payment
          ? employee.NoPago?.trim() === payment
          : !!name && employee.NombreCompleto.trim().toUpperCase() === name);
        this.selectedEmployeeIndex = index >= 0 ? index : null;
        this.changeDetector.markForCheck();
      },
      error: () => {
        if (requestId !== this.employeeOptionsRequestId) return;
        this.employeeCatalogError = 'No se pudo cargar el catálogo de empleados. Verifica la conexión con la API.';
        this.changeDetector.markForCheck();
      },
    });
  }

  cancelEdit(): void {
    // Cancela la edición y restaura el formulario a su estado inicial.
    this.isAssignMode = false;
    this.clearDeviceEmployeeSelection();
    this.employeeCatalogError = '';
    this.editingDeviceId = null;
    this.editingDeviceNCombo = '';
    this.selectedBuildingId = null;
    this.selectedRegionId = null;
    this.areas = [];
    this.isEditDialogOpen = false;
    this.newDevice = emptyDevice();
  }

  saveEditedDevice(): void {
    if (this.editingDeviceId === null) return;
    this.errorMessage = '';
    if (this.newDevice.Estado === 'ASIGNADO') {
      if (this.newDevice.IdArea === null) {
        this.errorMessage = 'Selecciona la regional, el edificio y el departamento del equipo asignado.';
        return;
      }
      if (!this.newDevice.NombreAsignado?.trim() && !this.newDevice.NumeroPagoAsignado?.trim()) {
        this.errorMessage = 'Selecciona el empleado al que se asigna el equipo.';
        return;
      }
    }
    const applyToCombo = this.editingDeviceNCombo !== '' && this.applyEditToCombo;
    this.adminService.updateDevice(this.editingDeviceId, this.normalizeDevice(this.newDevice), applyToCombo).subscribe({
      next: () => {
        this.message = this.isAssignMode ? 'Dispositivo asignado correctamente.' : 'Dispositivo actualizado correctamente.';
        this.cancelEdit();
        this.loadData();
      },
      error: (error) => this.errorMessage = apiErrorMessage(error, 'No se pudo actualizar el dispositivo.'),
    });
  }

  private normalizeDevice(device: CreateDevice): CreateDevice {
    const numeroPago = device.NumeroPagoAsignado?.trim() || null;
    const nombreAsignado = device.NombreAsignado?.trim() || null;
    return {
      ...device,
      NumeroPagoAsignado: numeroPago,
      NombreAsignado: nombreAsignado,
      IdArea: device.Estado === 'DISPONIBLE' ? null : device.IdArea,
    };
  }

  private createEmptyDesktopCombo(): CreateDesktopCombo {
    return {
      NCombo: '',
      IdTipo: 0,
      Estado: 'DISPONIBLE',
      NumeroPagoAsignado: null,
      NombreAsignado: null,
      IdArea: null,
      Componentes: [
        { Componente: 'CPU', CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '' },
        { Componente: 'MONITOR', CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '' },
        { Componente: 'TECLADO', CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '' },
      ],
    };
  }

  // Inventario, serie, marca, modelo y tipo son obligatorios.
  private isDeviceComplete(device: CreateDevice): boolean {
    return Boolean(
      device.CodigoInventario.trim()
      && device.NoSerie.trim()
      && device.Marca.trim()
      && device.Modelo.trim()
      && device.IdTipo !== null,
    );
  }

  askRemoveDevice(idEquipo: number): void {
    // Guarda el equipo pendiente para que el HTML abra el modal de confirmación.
    this.pendingDeviceId = idEquipo;
  }

  confirmRemoveDevice(): void {
    // Borra el dispositivo solo después de que el usuario confirmó la acción.
    if (this.pendingDeviceId === null) return;
    const idEquipo = this.pendingDeviceId;
    this.pendingDeviceId = null;
    this.adminService.deleteDevice(idEquipo).subscribe({
      next: () => { this.message = 'Dispositivo eliminado.'; this.loadData(); },
      error: (error) => this.errorMessage = apiErrorMessage(error, 'No se pudo quitar el dispositivo.'),
    });
  }

  cancelRemoveDevice(): void {
    this.pendingDeviceId = null;
  }

  openReassignmentReport(): void {
    this.clearMessages();
    this.isReassignmentReportOpen = true;
  }

  // Exporta las reasignaciones cuya fecha de cambio cae en el rango elegido.
  exportReassignmentReport(): void {
    this.clearMessages();
    if (isInvalidDateRange(this.reassignmentReportRange)) {
      this.errorMessage = 'La fecha "desde" no puede ser posterior a la fecha "hasta".';
      return;
    }
    this.isExportingReassignments = true;
    this.adminService.getReassignments().pipe(finalize(() => {
      this.isExportingReassignments = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: async (all) => {
        const reassignments = all.filter((item) => isInDateRange(item.FechaCambio, this.reassignmentReportRange));
        try {
          await this.createReassignmentWorkbook(reassignments);
          this.isReassignmentReportOpen = false;
          this.message = `Reporte de reasignaciones exportado: ${reassignments.length} registros.`;
        } catch {
          this.errorMessage = 'No se pudo exportar el reporte de reasignaciones.';
        }
        this.changeDetector.markForCheck();
      },
      error: () => this.errorMessage = 'No se pudo cargar el historial de reasignaciones para exportar.',
    });
  }

  // Mismas columnas y celdas que la tabla de reasignaciones de la vista web.
  private async createReassignmentWorkbook(reassignments: Reassignment[]): Promise<void> {
    const workbook = await createReportWorkbook('Reporte de reasignaciones');
    const columns: ReportColumn<Reassignment>[] = [
      { header: 'Equipo', width: 24, value: (item) => cellText(item.NombreTipo) },
      { header: 'Marca', width: 16, value: (item) => cellText(item.Marca).toLocaleUpperCase('es') },
      { header: 'Modelo', width: 20, value: (item) => cellText(item.Modelo).toLocaleUpperCase('es') },
      { header: 'Serie', width: 22, value: (item) => cellText(item.NoSerie).toLocaleUpperCase('es') },
      { header: 'Inventario', width: 14, value: (item) => item.CodigoInventario || this.getInventoryCode(item.IdEquipo) },
      { header: 'Resp. anterior', width: 34, value: (item) => item.NombreAnterior || item.NoPagoAnterior || 'Sin asignar' },
      { header: 'Resp. actual', width: 34, value: (item) => item.NombreNuevo || item.NoPagoNuevo || '-' },
      {
        header: 'Área de trabajo', width: 44,
        value: (item) => (item.NombreArea ? item.NombreArea + (item.NombreEdificio ? ` · ${item.NombreEdificio}` : '') : '-'),
      },
      { header: 'Fecha de asignación', width: 18, format: 'date', value: (item) => excelDate(item.FechaCambio, '') },
      { header: 'Motivo de reasignación', width: 44, wrap: true, value: (item) => item.Motivo ?? '' },
    ];
    addReportSheet(workbook, {
      sheetName: 'Reasignaciones',
      title: 'REPORTE DE REASIGNACIONES',
      subtitle: `${reassignments.length} reasignaciones · ${dateRangeLabel(this.reassignmentReportRange)} · ${generatedAt()}`,
      tableName: 'ReporteReasignaciones',
      columns,
      rows: reassignments,
    });
    await downloadReportWorkbook(workbook, reportFileName('reasignaciones'));
  }

  // Agrega una nueva reasignación.
  addReassignment(): void {
    this.clearMessages();
    if (!this.newReassignment.IdEquipo || this.reassignmentBuildingId <= 0 || this.newReassignment.IdArea <= 0) {
      this.errorMessage = 'Selecciona el equipo, edificio y departamento de la reasignación.';
      return;
    }
    if (!this.newReassignment.NombreNuevo?.trim() && !this.newReassignment.NoPagoNuevo?.trim() && this.selectedReassignmentEmployeeIndex === null) {
      this.errorMessage = 'Indica el empleado asignado o selecciónalo de la lista.';
      return;
    }
    if (!this.newReassignment.Motivo.trim()) {
      this.errorMessage = 'Escribe el motivo de la reasignación.';
      return;
    }
    this.newReassignment.IdEdificio = this.reassignmentBuildingId;
    this.isSubmittingReassignment = true;
    this.adminService.createReassignment(this.newReassignment).pipe(
      finalize(() => {
        this.isSubmittingReassignment = false;
        this.changeDetector.markForCheck();
      }),
    ).subscribe({
      next: () => {
        this.message = 'Reasignación registrada correctamente.';
        this.newReassignment = emptyReassignment();
        this.reassignmentBuildingId = 0;
        this.reassignmentRegionalId = null;
        this.reassignmentAreas = [];
        this.reassignmentEmployees = [];
        this.selectedReassignmentEmployeeIndex = null;
        this.selectedInventoryCode = '';
        this.deviceOptionSearch = '';
        this.deviceOptions = [];
        this.loadData();
      },
      error: (error) => this.errorMessage = apiErrorMessage(error, 'No se pudo registrar la reasignación.'),
    });
  }

  selectDeviceForReassignmentFromItem(item: Reassignment): void {
    const code = item.CodigoInventario || this.getInventoryCode(item.IdEquipo);
    this.selectedInventoryCode = code;
    this.newReassignment.IdEquipo = item.IdEquipo;
    this.deviceOptionSearch = code;
    // La cajita "Selecciona un resultado" muestra el equipo con Equipo - Marca - Modelo - Inventario.
    this.deviceOptions = [{
      IdEquipo: item.IdEquipo,
      CodigoInventario: code,
      NoSerie: item.NoSerie ?? '',
      Marca: item.Marca ?? '',
      Modelo: item.Modelo ?? '',
      NombreTipo: item.NombreTipo,
    }];
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Selecciona un dispositivo para reasignación y actualiza el modelo correspondiente.
  deviceOptionLabel(device: DeviceOption): string {
    return [device.NombreTipo, device.Marca, device.Modelo, device.CodigoInventario]
      .map((value) => value?.trim()).filter(Boolean).join(' - ');
  }

  selectDeviceForReassignment(codigoInventario: string): void {
    this.selectedInventoryCode = codigoInventario;
    const device = this.deviceOptions.find((item) => item.CodigoInventario === codigoInventario);
    this.newReassignment.IdEquipo = device?.IdEquipo ?? 0;
  }

  selectReassignmentRegion(idRegional: number | null): void {
    this.reassignmentAreaRequestId++;
    this.isLoadingReassignmentAreas = false;
    this.reassignmentRegionalId = idRegional;
    this.reassignmentBuildingId = 0;
    this.newReassignment.IdEdificio = 0;
    this.newReassignment.IdArea = 0;
    this.reassignmentAreas = [];
    this.clearReassignmentEmployee();
  }

  // Selecciona un edificio para la reasignación y carga los departamentos correspondientes.
  selectReassignmentBuilding(idEdificio: number): void {
    const buildingId = Number(idEdificio);
    const requestId = ++this.reassignmentAreaRequestId;
    this.reassignmentBuildingId = buildingId;
    this.newReassignment.IdEdificio = buildingId;
    this.newReassignment.IdArea = 0;
    this.reassignmentAreas = [];
    this.clearReassignmentEmployee();
    this.isLoadingReassignmentAreas = buildingId > 0;
    if (buildingId > 0) {
      this.adminService.getAreas(buildingId).pipe(
        finalize(() => {
          if (requestId !== this.reassignmentAreaRequestId) return;
          this.isLoadingReassignmentAreas = false;
          this.changeDetector.markForCheck();
        }),
      ).subscribe({
        next: (areas) => {
          if (requestId !== this.reassignmentAreaRequestId) return;
          this.reassignmentAreas = areas;
          this.changeDetector.markForCheck();
        },
        error: () => {
          if (requestId !== this.reassignmentAreaRequestId) return;
          this.errorMessage = 'No se pudieron cargar los departamentos del edificio.';
          this.reassignmentAreas = [];
          this.changeDetector.markForCheck();
        },
      });
    }
  }

  // Empleado elegido con el buscador: completa Regional, Edificio, Departamento y el empleado nuevo.
  applyReassignmentEmployee(employee: EmployeeLookupResult): void {
    this.selectReassignmentRegion(employee.IdRegional);
    if (employee.IdEdificio !== null) this.selectReassignmentBuilding(employee.IdEdificio);
    if (employee.IdArea !== null) this.selectReassignmentArea(employee.IdArea, employee);
    this.newReassignment.NombreNuevo = employee.NombreCompleto;
    this.newReassignment.NoPagoNuevo = employee.NoPago || null;
  }

  // preselect: empleado del buscador que queda elegido en el combo cuando termina de cargar la lista.
  selectReassignmentArea(idArea: number, preselect?: EmployeeLookupResult): void {
    this.newReassignment.IdArea = Number(idArea);
    this.clearReassignmentEmployee();
    if (this.newReassignment.IdArea <= 0) return;

    this.employeeCatalogError = '';
    const requestId = ++this.reassignmentEmployeeRequestId;
    this.isLoadingReassignmentEmployees = true;
    this.adminService.getEmployeeOptions(this.newReassignment.IdArea).pipe(finalize(() => {
      if (requestId !== this.reassignmentEmployeeRequestId) return;
      this.isLoadingReassignmentEmployees = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: (employees) => {
        if (requestId !== this.reassignmentEmployeeRequestId) return;
        this.reassignmentEmployees = employees;
        const index = preselect ? findEmployeeIndex(employees, preselect) : -1;
        if (index >= 0) this.selectReassignmentEmployee(index);
        this.changeDetector.markForCheck();
      },
      error: () => {
        if (requestId !== this.reassignmentEmployeeRequestId) return;
        this.employeeCatalogError = 'No se pudo cargar el catálogo de empleados. Verifica la conexión con la API.';
        this.changeDetector.markForCheck();
      },
    });
  }

  selectReassignmentEmployee(employeeIndex: number | null): void {
    this.selectedReassignmentEmployeeIndex = employeeIndex;
    const employee = employeeIndex === null ? undefined : this.reassignmentEmployees[employeeIndex];
    this.newReassignment.NoPagoNuevo = employee?.NoPago || null;
    this.newReassignment.NombreNuevo = employee?.NombreCompleto ?? '';
  }

  private clearReassignmentEmployee(): void {
    this.reassignmentEmployeeRequestId++;
    this.reassignmentEmployees = [];
    this.selectedReassignmentEmployeeIndex = null;
    this.isLoadingReassignmentEmployees = false;
    this.newReassignment.NoPagoNuevo = null;
    this.newReassignment.NombreNuevo = '';
  }
  // Obtiene el código de inventario de un dispositivo dado su ID.
  getInventoryCode(idEquipo: number): string {
    return this.devices.find((device) => device.IdEquipo === idEquipo)?.CodigoInventario ?? String(idEquipo);
  }

  // Limpia los mensajes de éxito y error.
  private clearMessages(): void {
    this.message = '';
    this.errorMessage = '';
  }
}