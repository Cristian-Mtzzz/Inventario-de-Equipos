import { ChangeDetectorRef, Component, ViewChild, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SearchableSelectDirective } from '../shared/searchable-select.directive';
import { finalize, forkJoin, Observable, retry, timeout } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { AdminService } from './admin.service';
import { AdminUser, Area, Building, CreateAdminUser, CreateDevice, CreateReassignment, Device, DeviceOption, DeviceType, EmployeeOption, Reassignment, UpdateAdminUser } from './admin.models';
import { TallerComponent } from '../taller/taller.component';
import { DeviceReportsComponent } from './device-reports.component';
import { EmployeeSearchDialogComponent } from './employee-search-dialog.component';
import { CatalogManagementComponent } from './catalog-management.component';

type AdminSection = 'devices' | 'reports' | 'reassignments' | 'users' | 'workshop' | 'catalogs';

@Component({
  selector: 'app-admin',
  imports: [DatePipe, FormsModule, SearchableSelectDirective, TallerComponent, DeviceReportsComponent, EmployeeSearchDialogComponent, CatalogManagementComponent],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.css',
})
export class AdminComponent {
  // Orquesta las cuatro secciones administrativas: dispositivos, reasignaciones,
  // usuarios y taller. También conserva formularios, modales, mensajes y paginación.
  // Las propiedades siguientes representan el estado visible de toda la pantalla.
  private readonly adminService = inject(AdminService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);
  activeSection: AdminSection = 'devices';
  devices: Device[] = [];
  totalDeviceCount = 0;
  reassignments: Reassignment[] = [];
  users: AdminUser[] = [];
  isLoadingUsers = false;
  private usersLoaded = false;
  private usersRequestInFlight = false;
  areas: Area[] = [];
  allEmployeeOptions: EmployeeOption[] = [];
  employeesForDeviceArea: EmployeeOption[] = [];
  selectedEmployeeIndex: number | null = null;
  isLoadingEmployeesForDevice = false;
  isLoadingEmployeeCatalog = true;
  employeeCatalogError = '';
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
  editingDeviceId: number | null = null;
  editingCodigoInventario = '';
  editingNoSerie = '';
  isEditDialogOpen = false;
  isCreateDeviceDialogOpen = false;
  isUserDialogOpen = false;
  editingUserId: number | null = null;
  pendingPasswordResetUserId: number | null = null;
  pendingPasswordResetUserName = '';
  isPasswordResetDialogOpen = false;
  pendingDeviceId: number | null = null;
  pendingUserId: number | null = null;
  pendingReassignmentId: number | null = null;
  isDeleteDialogOpen = false;
  message = '';
  errorMessage = '';
  isLoading = false;
  isLoadingDevices = false;
  readonly pageSizeOptions = [10, 25, 50, 100];
  devicePageSize = 25;
  currentPage = 1;
  reassignmentPageSize = 50;
  reassignmentCurrentPage = 1;
  reassignmentSearchTerm = '';
  reassignmentSortColumn = '';
  reassignmentSortDirection: 'asc' | 'desc' = 'asc';
  showAdminMenu = false;
  searchTerm = '';
  selectedBrand = '';
  selectedModel = '';
  selectedDeviceStatus = '';
  selectedTypeId: number | null = null;
  private deviceFilterTimer: ReturnType<typeof setTimeout> | null = null;
  private deviceRequestId = 0;
  private filterAreaRequestId = 0;
  private reassignmentAreaRequestId = 0;
  showEmployeeSearch = false;
  deviceOptions: DeviceOption[] = [];
  deviceOptionSearch = '';
  userSearchTerm = '';
  selectedUserRole = '';
  readonly moduleOptions: { code: string; label: string }[] = [
    { code: 'DISPOSITIVOS', label: 'Dispositivos' },
    { code: 'REASIGNACIONES', label: 'Reasignaciones' },
    { code: 'TALLER', label: 'Taller' },
    { code: 'USUARIOS', label: 'Usuarios' },
    { code: 'MANTENIMIENTO', label: 'Mantenimiento' },
  ];
  @ViewChild(TallerComponent) workshopComponent?: TallerComponent;
  
  // Estado inicial para la creación de un nuevo dispositivo, reasignación o usuario.
  newDevice: CreateDevice = {
    CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null,
    Estado: 'DISPONIBLE', NumeroPagoAsignado: null, NombreAsignado: null, IdArea: null,
  };
  newReassignment: CreateReassignment = { IdEquipo: 0, NoPagoNuevo: null, NombreNuevo: '', Motivo: '', IdEdificio: 0, IdArea: 0 };
  reassignmentRegionalId: number | null = null;
  reassignmentBuildingId = 0;
  reassignmentAreas: Area[] = [];
  reassignmentEmployees: EmployeeOption[] = [];
  selectedReassignmentEmployeeIndex: number | null = null;
  selectedInventoryCode = '';
  private deviceOptionSearchTimer: ReturnType<typeof setTimeout> | null = null;
  newUser: CreateAdminUser = {
    Usuario: '', NombrePersona: '', FechaExpiracion: null, Estado: 'ACTIVO',
    DominioP: 'BA', Dominio: 0, Rol: 'UsuarioComun', Modules: [], IsSuperAdmin: false,
  };
  // Constructor y métodos de inicialización.
  constructor() {
    this.activeSection = this.firstPermittedAdminSection();
    if (this.canAccessAdminSection('users')) this.loadUsers();
    this.adminService.getEmployeeOptions().subscribe({
      next: (employees) => {
        this.allEmployeeOptions = employees;
        this.isLoadingEmployeeCatalog = false;
        this.employeesForDeviceArea = this.newDevice.IdArea === null
          ? []
          : employees.filter((employee) => employee.IdArea === this.newDevice.IdArea);
        this.isLoadingEmployeesForDevice = false;
      },
      error: () => {
        this.isLoadingEmployeeCatalog = false;
        this.isLoadingEmployeesForDevice = false;
        this.employeeCatalogError = 'No se pudo cargar el catálogo de empleados. Verifica la conexión con la API.';
      },
    });
    this.loadData();
  }

  canAccessModule(module: string): boolean {
    return this.authService.hasModule(module);
  }

  canAccessAdminSection(section: AdminSection): boolean {
    const modules: Record<AdminSection, string> = {
      devices: 'DISPOSITIVOS',
      reports: 'DISPOSITIVOS',
      reassignments: 'REASIGNACIONES',
      workshop: 'TALLER',
      users: 'USUARIOS',
      catalogs: 'MANTENIMIENTO',
    };
    return this.authService.hasModule(modules[section]);
  }

  get canManageSuperAdmins(): boolean {
    return this.authService.moduleAccess().IsSuperAdmin;
  }

  get panelTitle(): string {
    if (this.authService.hasRole(['Admin'])) return 'Panel de administrador';
    if (this.authService.hasRole(['UsuarioComun'])) return 'Panel de usuario';
    if (this.authService.hasRole(['Taller'])) return 'Panel de taller';
    return 'Panel de gestión';
  }

  setUserModule(module: string, checked: boolean): void {
    if (this.newUser.IsSuperAdmin) return;
    this.newUser.Modules = checked
      ? [...new Set([...this.newUser.Modules, module])]
      : this.newUser.Modules.filter((item) => item !== module);
  }

  setUserSuperAdmin(enabled: boolean): void {
    if (!this.canManageSuperAdmins) return;
    this.newUser.IsSuperAdmin = enabled;
    if (enabled) this.newUser.Modules = [];
  }

  private firstPermittedAdminSection(): AdminSection {
    const sections: AdminSection[] = ['devices', 'reassignments', 'workshop', 'users', 'catalogs'];
    return sections.find((section) => this.canAccessAdminSection(section)) ?? 'devices';
  }

  // Métodos auxiliares para el filtrado y paginación de dispositivos y usuarios.
  get filteredDevices(): Device[] { return this.devices; }

  // Métodos para la paginación de dispositivos.
  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalDeviceCount / this.devicePageSize));
  }

  get deviceVisiblePages(): number[] {
    const firstPage = Math.max(1, this.currentPage - 2);
    const lastPage = Math.min(this.totalPages, firstPage + 4);
    return Array.from({ length: lastPage - firstPage + 1 }, (_, index) => firstPage + index);
  }

  get deviceFirstRow(): number {
    return this.totalDeviceCount === 0 ? 0 : (this.currentPage - 1) * this.devicePageSize + 1;
  }

  get deviceLastRow(): number {
    return Math.min(this.currentPage * this.devicePageSize, this.totalDeviceCount);
  }
  // Fin de los métodos para la paginación de dispositivos.
  get pagedDevices(): Device[] {
    return this.devices;
  }

  get filteredReassignments(): Reassignment[] {
    const search = this.reassignmentSearchTerm.trim().toLocaleLowerCase();
    const filtered = search
      ? this.reassignments.filter((item) => [item.CodigoInventario, item.NombreEdificio, item.NombreArea,
        item.FechaCambio, item.Motivo, item.NoPagoAnterior, item.NoPagoNuevo]
        .some((value) => String(value ?? '').toLocaleLowerCase().includes(search)))
      : [...this.reassignments];
    if (!this.reassignmentSortColumn) return filtered;
    return filtered.sort((first, second) => {
      const firstValue = String(first[this.reassignmentSortColumn as keyof Reassignment] ?? '').toLocaleLowerCase();
      const secondValue = String(second[this.reassignmentSortColumn as keyof Reassignment] ?? '').toLocaleLowerCase();
      const comparison = firstValue.localeCompare(secondValue, undefined, { numeric: true });
      return this.reassignmentSortDirection === 'asc' ? comparison : -comparison;
    });
  }

  get pagedReassignments(): Reassignment[] {
    const start = (this.reassignmentCurrentPage - 1) * this.reassignmentPageSize;
    return this.filteredReassignments.slice(start, start + this.reassignmentPageSize);
  }

  get reassignmentTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredReassignments.length / this.reassignmentPageSize));
  }

  get reassignmentVisiblePages(): number[] {
    const firstPage = Math.max(1, this.reassignmentCurrentPage - 2);
    const lastPage = Math.min(this.reassignmentTotalPages, firstPage + 4);
    return Array.from({ length: lastPage - firstPage + 1 }, (_, index) => firstPage + index);
  }

  get reassignmentFirstRow(): number {
    return this.filteredReassignments.length === 0 ? 0 : (this.reassignmentCurrentPage - 1) * this.reassignmentPageSize + 1;
  }

  get reassignmentLastRow(): number {
    return Math.min(this.reassignmentCurrentPage * this.reassignmentPageSize, this.filteredReassignments.length);
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

  get reassignmentBuildings(): Building[] {
    return this.reassignmentRegionalId === null
      ? this.buildings
      : this.buildings.filter((building) => building.IdRegional === this.reassignmentRegionalId);
  }
  // Métodos auxiliares para el filtrado de usuarios.
  get filteredUsers(): AdminUser[] {
    const normalizedSearch = this.userSearchTerm.trim().toLowerCase();
    return this.users.filter((user) => {
      const matchesSearch = !normalizedSearch || user.Usuario.toLowerCase().includes(normalizedSearch);
      const matchesRole = !this.selectedUserRole || user.Rol === this.selectedUserRole;
      return matchesSearch && matchesRole;
    });
  }

  get availableUserRoles(): string[] {
    return [...new Set(this.users.map((user) => user.Rol).filter(Boolean))].sort((first, second) => first.localeCompare(second));
  }

  refreshEmployeeOptions(): void {
    this.adminService.getEmployeeOptions().subscribe({
      next: (employees) => this.allEmployeeOptions = employees,
      error: () => this.employeeCatalogError = 'No se pudo actualizar el catálogo de empleados.',
    });
  }
  // Fin de los métodos auxiliares para el filtrado de usuarios.

  loadData(): void {
    // Carga únicamente los datos de la sección activa para evitar peticiones innecesarias.
    this.errorMessage = '';
    if (this.activeSection === 'devices') {
      this.isLoading = false;
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
      this.loadDevicePage();
      return;
    }

    if (this.activeSection === 'users') {
      this.loadUsers(true);
      return;
    }

    this.isLoading = true;

    if (this.activeSection === 'workshop') {
      this.workshopComponent?.loadData();
      this.isLoading = false;
      return;
    }

    if (this.activeSection === 'catalogs') {
      this.isLoading = false;
      return;
    }

    if (this.activeSection === 'reports') {
      this.isLoading = false;
      return;
    }

    // Carga de datos para secciones que no son dispositivos ni taller.
    const sectionRequest: Observable<Reassignment[] | AdminUser[]> = this.activeSection === 'reassignments'
      ? this.adminService.getReassignments().pipe(retry({ count: 3, delay: 1000 }))
      : this.adminService.getUsers().pipe(retry({ count: 3, delay: 1000 }));
    sectionRequest.subscribe({
      next: (items: Reassignment[] | AdminUser[]) => {
        if (this.activeSection === 'reassignments') {
          this.reassignments = items as Reassignment[];
          this.reassignmentCurrentPage = Math.min(this.reassignmentCurrentPage, this.reassignmentTotalPages);
        }
        else this.users = items as AdminUser[];
        this.isLoading = false;
      },
      error: (error) => {
        const fallback = this.activeSection === 'reassignments'
          ? 'No se pudieron cargar las reasignaciones.'
          : 'No se pudieron cargar los usuarios.';
        this.errorMessage = this.getErrorMessage(error, fallback);
        this.isLoading = false;
      },
    });
  }

  selectSection(section: AdminSection): void {
    // Cambia de sección, limpia mensajes y dispara su recarga.
    if (!this.canAccessAdminSection(section)) return;
    this.activeSection = section;
    if (section === 'reassignments') this.reassignmentCurrentPage = 1;
    this.message = '';
    this.errorMessage = '';
    if (section === 'users' && this.usersLoaded) return;
    this.loadData();
  }

  private loadUsers(force = false): void {
    if (this.usersRequestInFlight || (this.usersLoaded && !force)) return;

    this.usersRequestInFlight = true;
    this.isLoadingUsers = true;
    this.adminService.getUsers().pipe(
      retry({ count: 3, delay: 1000 }),
      finalize(() => {
        this.usersRequestInFlight = false;
        this.isLoadingUsers = false;
        this.changeDetector.markForCheck();
      }),
    ).subscribe({
      next: (users) => {
        this.users = users;
        this.usersLoaded = true;
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.usersLoaded = false;
        this.errorMessage = this.getErrorMessage(error, 'No se pudieron cargar los usuarios.');
        this.changeDetector.markForCheck();
      },
    });
  }

  toggleAdminMenu(): void {
    // Abre o cierra el menú auxiliar del encabezado administrativo.
    this.showAdminMenu = !this.showAdminMenu;
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

  updateDevicePageSize(value: number): void {
    this.devicePageSize = Number(value);
    this.currentPage = 1;
    this.loadDevicePage();
  }

  updateReassignmentSearch(value: string): void {
    this.reassignmentSearchTerm = value;
    this.reassignmentCurrentPage = 1;
  }

  updateReassignmentPageSize(value: number): void {
    this.reassignmentPageSize = Number(value);
    this.reassignmentCurrentPage = 1;
  }

  goToReassignmentPage(page: number): void {
    this.reassignmentCurrentPage = Math.min(Math.max(page, 1), this.reassignmentTotalPages);
  }

  sortReassignmentsBy(column: string): void {
    this.reassignmentSortDirection = this.reassignmentSortColumn === column && this.reassignmentSortDirection === 'asc'
      ? 'desc' : 'asc';
    this.reassignmentSortColumn = column;
    this.reassignmentCurrentPage = 1;
  }

  reassignmentSortIndicator(column: string): string {
    return this.reassignmentSortColumn !== column ? '↕'
      : this.reassignmentSortDirection === 'asc' ? '▲' : '▼';
  }

  applyFilters(): void {
    this.currentPage = 1;
    if (this.deviceFilterTimer) clearTimeout(this.deviceFilterTimer);
    this.deviceFilterTimer = setTimeout(() => {
      this.deviceFilterTimer = null;
      this.loadDevicePage();
    }, 250);
  }

  // Limpia los filtros aplicados a la lista de dispositivos.
  clearFilters(): void {
    this.searchTerm = '';
    this.selectedBrand = '';
    this.selectedModel = '';
    this.selectedDeviceStatus = '';
    this.selectedTypeId = null;
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
    this.loadDevicePage();
  }

  loadDevicePage(): void {
    if (this.activeSection !== 'devices') return;
    this.isLoadingDevices = true;
    const requestId = ++this.deviceRequestId;
    this.adminService.getDevices({
      Page: this.currentPage,
      PageSize: this.devicePageSize,
      SearchTerm: this.searchTerm,
      Brand: this.selectedBrand,
      Model: this.selectedModel,
      TypeId: this.selectedTypeId,
      RegionalId: this.selectedRegionalFilterId,
      BuildingId: this.selectedBuildingFilterId,
      AreaId: this.selectedAreaFilterId,
      State: this.selectedDeviceStatus,
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
        this.currentPage = result.Page;
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        if (requestId === this.deviceRequestId) {
          this.errorMessage = this.getErrorMessage(error, 'No se pudieron cargar los dispositivos.');
          this.changeDetector.markForCheck();
        }
      },
    });
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
    this.isLoadingFilterAreas = idEdificio !== null;
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

  selectDeviceRegion(idRegional: number | null): void {
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
    if (searchTerm.length < 2) {
      this.deviceOptions = [];
      return;
    }
    this.deviceOptionSearchTimer = setTimeout(() => {
      this.deviceOptionSearchTimer = null;
      this.adminService.searchDeviceOptions(searchTerm).subscribe({
        next: (options) => this.deviceOptions = options,
        error: () => this.errorMessage = 'No se pudieron buscar dispositivos.',
      });
    }, 250);
  }

  // Limpia los filtros aplicados a la lista de usuarios.
  clearUserFilters(): void {
    this.userSearchTerm = '';
    this.selectedUserRole = '';
    this.currentPage = 1; // Reinicia la paginación al limpiar los filtros de usuario.
  }

  // Selección de edificio y carga de áreas correspondientes. 
  selectBuilding(idEdificio: number | null): void {
    const buildingId = Number(idEdificio);
    this.selectedBuildingId = buildingId || null;
    this.selectedRegionId = this.buildings.find((building) => building.IdEdificio === this.selectedBuildingId)?.IdRegional ?? null;
    this.newDevice.IdArea = null;
    this.areas = [];
    if (this.isCreateDeviceDialogOpen) this.clearDeviceEmployeeSelection();
    this.isLoadingAreas = buildingId > 0;
    if (buildingId > 0) {
      this.adminService.getAreas(buildingId).pipe(finalize(() => this.isLoadingAreas = false)).subscribe({
        next: (areas) => this.areas = areas,
        error: () => this.errorMessage = 'No se pudieron cargar las áreas del edificio.',
      });
    }
  }

  selectDeviceArea(idArea: number | null): void {
    this.newDevice.IdArea = idArea;
    this.clearDeviceEmployeeSelection();
    this.isLoadingEmployeesForDevice = idArea !== null && this.isLoadingEmployeeCatalog;
    if (idArea !== null && !this.isLoadingEmployeeCatalog) {
      this.employeesForDeviceArea = this.allEmployeeOptions.filter((employee) => employee.IdArea === idArea);
    }
  }

  selectDeviceEmployee(employeeIndex: number | null): void {
    this.selectedEmployeeIndex = employeeIndex;
    const employee = employeeIndex === null ? undefined : this.employeesForDeviceArea[employeeIndex];
    this.newDevice.NumeroPagoAsignado = employee?.NoPago || null;
    this.newDevice.NombreAsignado = employee?.NombreCompleto ?? null;
  }

  private clearDeviceEmployeeSelection(): void {
    this.employeesForDeviceArea = [];
    this.selectedEmployeeIndex = null;
    this.newDevice.NumeroPagoAsignado = null;
    this.newDevice.NombreAsignado = null;
    this.isLoadingEmployeesForDevice = this.isLoadingEmployeeCatalog;
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
    this.newDevice = { CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null, Estado: 'DISPONIBLE', NumeroPagoAsignado: null, NombreAsignado: null, IdArea: null };
    this.selectedBuildingId = null;
    this.selectedRegionId = null;
    this.areas = [];
    this.clearDeviceEmployeeSelection();
    this.errorMessage = '';
    this.isCreateDeviceDialogOpen = true;
  }

  closeDeviceCreateDialog(): void {
    this.isCreateDeviceDialogOpen = false;
    this.newDevice = { CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null, Estado: 'DISPONIBLE', NumeroPagoAsignado: null, NombreAsignado: null, IdArea: null };
    this.selectedBuildingId = null;
    this.selectedRegionId = null;
    this.areas = [];
    this.clearDeviceEmployeeSelection();
    this.errorMessage = '';
  }

  addDevice(): void {
    // Decide entre crear o actualizar según exista un ID en edición.
    this.clearMessages();
    if (!this.isDeviceComplete(this.newDevice)) {
      this.errorMessage = 'Completa código, número de serie, marca, modelo y tipo de dispositivo.';
      return;
    }
    if (this.newDevice.Estado === 'ASIGNADO' && this.selectedEmployeeIndex === null) {
      this.errorMessage = 'Selecciona un empleado del departamento indicado.';
      return;
    }
    const device = this.normalizeDevice(this.newDevice);
    const request = this.editingDeviceId === null
      ? this.adminService.createDevice(device)
      : this.adminService.updateDevice(this.editingDeviceId, device);
    request.subscribe({
      next: () => {
        const successMessage = this.editingDeviceId === null
          ? 'Dispositivo agregado correctamente.'
          : 'Dispositivo actualizado correctamente.';
        this.editingDeviceId = null;
        this.newDevice = { CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null, Estado: 'DISPONIBLE', NumeroPagoAsignado: null, NombreAsignado: null, IdArea: null };
        this.closeDeviceCreateDialog();
        this.message = successMessage;
        this.loadData();
      },
      error: (error) => this.errorMessage = error.error?.Message
        ?? error.error?.message
        ?? 'No se pudo agregar el dispositivo.',
    });
  }

  editDevice(device: Device): void {
    // Copia el equipo seleccionado al formulario para convertirlo en modo edición.
    this.editingDeviceId = device.IdEquipo;
    this.editingCodigoInventario = device.CodigoInventario;
    this.editingNoSerie = device.NoSerie;
    this.selectedBuildingId = device.Estado === 'DISPONIBLE' ? null : device.IdEdificio;
    this.selectedRegionId = device.IdRegional;
    this.areas = [];
    if (this.selectedBuildingId !== null) {
      this.adminService.getAreas(this.selectedBuildingId).subscribe((areas) => this.areas = areas);
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

  cancelEdit(): void {
    // Cancela la edición y restaura el formulario a su estado inicial.
    this.editingDeviceId = null;
    this.editingCodigoInventario = '';
    this.editingNoSerie = '';
    this.selectedBuildingId = null;
    this.selectedRegionId = null;
    this.areas = [];
    this.isEditDialogOpen = false;
    this.newDevice = { CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null, Estado: 'DISPONIBLE', NumeroPagoAsignado: null, NombreAsignado: null, IdArea: null };
  }

  saveEditedDevice(): void {
    if (this.editingDeviceId === null) return;
    this.adminService.updateDevice(this.editingDeviceId, this.normalizeDevice(this.newDevice)).subscribe({
      next: () => {
        this.message = 'Dispositivo actualizado correctamente.';
        this.cancelEdit();
        this.loadData();
      },
      error: (error) => this.errorMessage = this.getErrorMessage(error, 'No se pudo actualizar el dispositivo.'),
    });
  }

  private normalizeDevice(device: CreateDevice): CreateDevice {
    const numeroPago = device.NumeroPagoAsignado?.trim() || null;
    const nombreAsignado = device.NombreAsignado?.trim() || null;
    return {
      ...device,
      NumeroPagoAsignado: numeroPago,
      NombreAsignado: nombreAsignado,
      Estado: device.Estado,
      IdArea: device.Estado === 'DISPONIBLE' ? null : device.IdArea,
    };
  }

  // Normaliza los datos del dispositivo antes de enviarlos al servidor.
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
    this.pendingUserId = null;
    this.pendingReassignmentId = null;
    this.isDeleteDialogOpen = true;
  }

  confirmRemoveDevice(): void {
    // Borra el dispositivo solo después de que el usuario confirmó la acción.
    if (this.pendingDeviceId === null) return;
    const idEquipo = this.pendingDeviceId;
    this.pendingDeviceId = null;
    this.isDeleteDialogOpen = false;
    this.adminService.deleteDevice(idEquipo).subscribe({
      next: () => { this.message = 'Dispositivo eliminado.'; this.loadData(); },
      error: (error) => this.errorMessage = this.getErrorMessage(error, 'No se pudo quitar el dispositivo.'),
    });
  }
  // Métodos para manejar la eliminación de dispositivos, reasignaciones y usuarios.
  // Incluye la apertura de confirmación y la ejecución de las acciones correspondientes.
  cancelRemoveDevice(): void {
    this.pendingDeviceId = null;
    this.isDeleteDialogOpen = false;
  }

  // Métodos para manejar la eliminación de reasignaciones.
  askRemoveReassignment(idReasignacion: number): void {
    this.pendingDeviceId = null;
    this.pendingUserId = null;
    this.pendingReassignmentId = idReasignacion;
    this.isDeleteDialogOpen = true;
  }

  // Confirma la eliminación de una reasignación.
  confirmRemoveReassignment(): void {
    if (this.pendingReassignmentId === null) return;
    const idReasignacion = this.pendingReassignmentId;
    this.pendingReassignmentId = null;
    this.isDeleteDialogOpen = false;
    this.adminService.deleteReassignment(idReasignacion).subscribe({
      next: () => { this.message = 'Reasignación eliminada.'; this.loadData(); },
      error: (error) => this.errorMessage = this.getErrorMessage(error, 'No se pudo eliminar la reasignación.'),
    });
  }

  // Cancela la eliminación de una reasignación.
  cancelRemoveReassignment(): void {
    this.pendingReassignmentId = null;
    this.isDeleteDialogOpen = false;
  }

  // Cancela la eliminación pendiente, ya sea de un dispositivo, usuario o reasignación.
  cancelPendingDelete(): void {
    if (this.pendingDeviceId !== null) this.cancelRemoveDevice();
    else if (this.pendingUserId !== null) this.cancelRemoveUser();
    else this.cancelRemoveReassignment();
  }

  // Confirma la eliminación pendiente, ya sea de un dispositivo, usuario o reasignación.
  confirmPendingDelete(): void {
    if (this.pendingDeviceId !== null) this.confirmRemoveDevice();
    else if (this.pendingUserId !== null) this.confirmRemoveUser();
    else this.confirmRemoveReassignment();
  }

  // Agrega una nueva reasignación.
  addReassignment(): void {
    this.clearMessages();
    if (!this.newReassignment.IdEquipo || this.reassignmentBuildingId <= 0 || this.newReassignment.IdArea <= 0) {
      this.errorMessage = 'Selecciona el equipo, edificio y departamento de la reasignación.';
      return;
    }
    if (this.selectedReassignmentEmployeeIndex === null) {
      this.errorMessage = 'Selecciona un empleado del departamento indicado.';
      return;
    }
    if (!this.newReassignment.Motivo.trim()) {
      this.errorMessage = 'Escribe el motivo de la reasignación.';
      return;
    }
    this.newReassignment.IdEdificio = this.reassignmentBuildingId;
    this.adminService.createReassignment(this.newReassignment).subscribe({
      next: () => {
        this.message = 'Reasignación registrada correctamente.';
        this.newReassignment = { IdEquipo: 0, NoPagoNuevo: null, NombreNuevo: '', Motivo: '', IdEdificio: 0, IdArea: 0 };
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
      error: (error) => this.errorMessage = this.getErrorMessage(error, 'No se pudo registrar la reasignación.'),
    });
  }

  // Selecciona un dispositivo para reasignación y actualiza el modelo correspondiente.
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
          this.syncReassignmentEmployees();
          this.changeDetector.markForCheck();
        },
        error: () => {
          if (requestId !== this.reassignmentAreaRequestId) return;
          this.errorMessage = 'No se pudieron cargar los departamentos del edificio.';
          this.reassignmentAreas = [];
          this.syncReassignmentEmployees();
          this.changeDetector.markForCheck();
        },
      });
    }
  }

  selectReassignmentArea(idArea: number): void {
    this.newReassignment.IdArea = Number(idArea);
    this.syncReassignmentEmployees();
  }

  private syncReassignmentEmployees(): void {
    if (this.newReassignment.IdArea > 0) {
      this.reassignmentEmployees = this.allEmployeeOptions.filter((employee) => employee.IdArea === this.newReassignment.IdArea);
      return;
    }

    const areaIds = new Set(this.reassignmentAreas.map((area) => area.IdArea));
    this.reassignmentEmployees = this.allEmployeeOptions.filter((employee) => areaIds.has(employee.IdArea));
  }

  selectReassignmentEmployee(employeeIndex: number | null): void {
    this.selectedReassignmentEmployeeIndex = employeeIndex;
    const employee = employeeIndex === null ? undefined : this.reassignmentEmployees[employeeIndex];
    this.newReassignment.NoPagoNuevo = employee?.NoPago || null;
    this.newReassignment.NombreNuevo = employee?.NombreCompleto ?? '';
  }

  private clearReassignmentEmployee(): void {
    this.reassignmentEmployees = [];
    this.selectedReassignmentEmployeeIndex = null;
    this.newReassignment.NoPagoNuevo = null;
    this.newReassignment.NombreNuevo = '';
  }
  // Obtiene el código de inventario de un dispositivo dado su ID.
  getInventoryCode(idEquipo: number): string {
    return this.devices.find((device) => device.IdEquipo === idEquipo)?.CodigoInventario ?? String(idEquipo);
  }

  // Agrega un nuevo usuario al sistema. La contraseña inicial se genera en el backend y no se muestra en pantalla.
  addUser(): void {
  
    this.clearMessages();
    if (!this.newUser.Usuario.trim() || !this.newUser.NombrePersona.trim()) {
      this.errorMessage = 'El usuario y el nombre de la persona son obligatorios.';
      return;
    }
    // El input de fecha envía '' cuando queda vacío; el backend solo acepta null.
    const userToCreate: CreateAdminUser = {
      ...this.newUser,
      FechaExpiracion: this.newUser.FechaExpiracion?.trim() || null,
    };
    // Llama al servicio para crear el usuario en el backend.
    this.adminService.createUser(userToCreate).subscribe({
      next: () => {
        this.message = 'Usuario agregado correctamente.';
        this.isUserDialogOpen = false;
        this.editingUserId = null;
        this.newUser = {
          Usuario: '', NombrePersona: '', FechaExpiracion: null, Estado: 'ACTIVO',
          DominioP: 'BA', Dominio: 0, Rol: 'UsuarioComun', Modules: [], IsSuperAdmin: false,
        };
        this.loadData();
      },
      error: (error) => this.errorMessage = this.getErrorMessage(error, 'No se pudo agregar el usuario.'),
    });
  }
  // Abre el diálogo para agregar un nuevo usuariio o editar uno existente.
  openUserDialog(): void {
    this.clearMessages();
    this.editingUserId = null;
    this.newUser = {
      Usuario: '', NombrePersona: '', FechaExpiracion: null, Estado: 'ACTIVO',
      DominioP: 'BA', Dominio: 0, Rol: 'UsuarioComun', Modules: [], IsSuperAdmin: false,
    };
    this.isUserDialogOpen = true;
  }

    //se abre una ventana para editar un usuario existente.
  editUser(user: AdminUser): void {
    this.clearMessages();
    this.editingUserId = user.IdUsuario;
    this.newUser = {
      Usuario: user.Usuario,
      NombrePersona: user.NombrePersona,
      FechaExpiracion: user.FechaExpiracion?.slice(0, 10) ?? null,
      Estado: user.Estado,
      DominioP: user.DominioP,
      Dominio: user.Dominio,
      Rol: user.Rol,
      Modules: [...user.Modules],
      IsSuperAdmin: user.IsSuperAdmin,
    };
    this.isUserDialogOpen = true;
  }

    // Guarda los cambios realizados en el diálogo de usuario. Si se está editando un usuario existente, se actualiza; de lo contrario, se agrega uno nuevo.
  saveUserDialog(): void {
    if (this.editingUserId === null) {
      this.addUser();
      return;
    }

      
    this.clearMessages();
    if (!this.newUser.NombrePersona.trim()) {
      this.errorMessage = 'El nombre de la persona es obligatorio.';
      return;
    }

    const userToUpdate: UpdateAdminUser = {
      NombrePersona: this.newUser.NombrePersona.trim(),
      FechaExpiracion: this.newUser.FechaExpiracion?.trim() || null,
      Estado: this.newUser.Estado,
      DominioP: this.newUser.DominioP,
      Dominio: this.newUser.Dominio,
      Rol: this.newUser.Rol,
      Modules: [...this.newUser.Modules],
      IsSuperAdmin: this.newUser.IsSuperAdmin,
    };
    this.adminService.updateUser(this.editingUserId, userToUpdate).subscribe({
      next: () => {
        this.message = 'Usuario actualizado correctamente.';
        this.closeUserDialog();
        this.loadData();
      },
      error: (error) => this.errorMessage = this.getErrorMessage(error, 'No se pudo actualizar el usuario.'),
    });
  }

  // Cierra el diálogo de agregar usuario.
  closeUserDialog(): void {
    this.isUserDialogOpen = false;
    this.editingUserId = null;
  }

  // Solicita la eliminación de un usuario.
  askRemoveUser(idUsuario: number): void {
    this.pendingUserId = idUsuario;
    this.pendingDeviceId = null;
    this.pendingReassignmentId = null;
    this.isDeleteDialogOpen = true;
  }

  // Confirma la eliminación de un usuario.
  confirmRemoveUser(): void {
    if (this.pendingUserId === null) return;
    const idUsuario = this.pendingUserId;
    this.pendingUserId = null;
    this.isDeleteDialogOpen = false;
    this.adminService.deleteUser(idUsuario).subscribe({
      next: () => { this.message = 'Usuario eliminado.'; this.loadData(); },
      error: (error) => this.errorMessage = this.getErrorMessage(error, 'No se pudo quitar el usuario.'),
    });
  }

  // Cancela la eliminación de un usuario.
  cancelRemoveUser(): void {
    this.pendingUserId = null;
    this.isDeleteDialogOpen = false;
  }

  askResetUserPassword(idUsuario: number, userName: string): void {
    this.pendingPasswordResetUserId = idUsuario;
    this.pendingPasswordResetUserName = userName;
    this.isPasswordResetDialogOpen = true;
  }

  resetUserPassword(): void {
    if (this.pendingPasswordResetUserId === null) return;
    const idUsuario = this.pendingPasswordResetUserId;
    this.adminService.resetUserPassword(idUsuario).subscribe({
      next: () => {
        this.message = `Contraseña de ${this.pendingPasswordResetUserName} restablecida.`;
        this.cancelPasswordReset();
        this.loadData();
      },
      error: (error) => this.errorMessage = this.getErrorMessage(error, 'No se pudo restablecer la contraseña.'),
    });
  }

  cancelPasswordReset(): void {
    this.pendingPasswordResetUserId = null;
    this.pendingPasswordResetUserName = '';
    this.isPasswordResetDialogOpen = false;
  }

  // Limpia los mensajes de éxito y error.
  private clearMessages(): void {
    this.message = '';
    this.errorMessage = '';
  }
  // Muestra un mensaje de error si la carga de datos falla.
  private showLoadError(): void {
    this.errorMessage = 'No se pudo cargar esta sección. Verifica que el backend esté iniciado.';
    this.isLoading = false;
    this.isLoadingDevices = false;
  }
  // Obtiene el mensaje de error a mostrar, usando un valor de respaldo si no se encuentra un mensaje específico.
  private getErrorMessage(error: { error?: { Message?: string; message?: string; detail?: string; title?: string }; message?: string }, fallback: string): string {
    return error.error?.Message ?? error.error?.message ?? error.error?.detail ?? error.error?.title ?? error.message ?? fallback;
  }
}