import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { AdminService } from '../admin/admin.service';
import { Area, Building, CreateDevice, CreateReassignment, Device, DeviceOption, DeviceType, EmployeeOption, Reassignment } from '../admin/admin.models';
import { EmployeeSearchDialogComponent } from '../admin/employee-search-dialog.component';

// Componente de inventario que permite consultar, filtrar, paginar y gestionar dispositivos y reasignaciones.
@Component({
  selector: 'app-inventory',
  imports: [DatePipe, FormsModule, EmployeeSearchDialogComponent],
  templateUrl: './inventory.component.html',
  styleUrl: './inventory.component.css',
})
export class InventoryComponent {
  // Vista para usuarios comunes. Permite consultar inventario, paginar resultados,
  // registrar reasignaciones y editar equipos según los permisos del backend.
  private readonly adminService = inject(AdminService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  devices: Device[] = [];
  totalDeviceCount = 0;
  isLoadingDevices = false;
  reassignments: Reassignment[] = [];
  areas: Area[] = [];
  employeesForDeviceArea: EmployeeOption[] = [];
  selectedEmployeeIndex: number | null = null;
  isLoadingEmployeesForDevice = false;
  isLoadingEmployeeCatalog = false;
  private employeeOptionsRequestId = 0;
  employeeCatalogError = '';
  isLoadingAreas = false;
  buildings: Building[] = [];
  selectedBuildingId: number | null = null;
  selectedRegionId: number | null = null;
  selectedRegionalFilterId: number | null = null;
  selectedBuildingFilterId: number | null = null;
  selectedAreaFilterId: number | null = null;
  filterAreas: Area[] = [];
  deviceTypes: DeviceType[] = [];
  activeSection: 'devices' | 'reassignments' = 'devices';
  pageSize = 25;
  currentPage = 1;
  message = '';
  errorMessage = '';
  searchTerm = '';
  selectedBrand = '';
  selectedModel = '';
  selectedTypeId: number | null = null;
  private deviceFilterTimer: ReturnType<typeof setTimeout> | null = null;
  private deviceRequestId = 0;
  showEmployeeSearch = false;
  deviceOptions: DeviceOption[] = [];
  deviceOptionSearch = '';

  // Modelo para el nuevo dispositivo que se va a agregar al inventario.
  newDevice: CreateDevice = {
    CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null,
    Estado: 'DISPONIBLE', NumeroPagoAsignado: null, NombreAsignado: null, IdArea: null,
  };

  // Modelo para la nueva reasignación que se va a registrar.
  newReassignment: CreateReassignment = { IdEquipo: 0, NoPagoNuevo: null, NombreNuevo: '', Motivo: '', IdEdificio: 0, IdArea: 0 };
  reassignmentBuildingId = 0;
  reassignmentAreas: Area[] = [];
  reassignmentRegionalId: number | null = null;
  reassignmentEmployees: EmployeeOption[] = [];
  selectedReassignmentEmployeeIndex: number | null = null;
  isLoadingReassignmentEmployees = false;
  private reassignmentEmployeeRequestId = 0;
  selectedInventoryCode = '';
  private deviceOptionSearchTimer: ReturnType<typeof setTimeout> | null = null;
  editingDeviceId: number | null = null;
  editingCodigoInventario = '';
  editingNoSerie = '';
  isEditDialogOpen = false;
  pendingDeleteDeviceId: number | null = null;
  isDeleteDialogOpen = false;

    // metodo constructor que inicializa el componente y carga los catálogos de tipos de dispositivos y edificios.
  constructor() {
    forkJoin({
      deviceTypes: this.adminService.getDeviceTypes(),
      buildings: this.adminService.getBuildings(),
    }).subscribe((data) => {
      this.deviceTypes = data.deviceTypes;
      this.buildings = data.buildings;
    });
    this.loadDevices();
  }

  // Propiedad que indica si el usuario tiene permisos para eliminar dispositivos.
  get canRemoveDevices(): boolean {
    return this.authService.hasRole(['Admin']);
  }

  // Propiedad que devuelve los dispositivos filtrados según los criterios de búsqueda y filtros aplicados.
  get filteredDevices(): Device[] { return this.devices; }

  // Propiedad que devuelve los dispositivos de la página actual según la paginación.
  get pagedDevices(): Device[] {
    return this.devices;
  }

  // Propiedad que devuelve el número total de páginas según los dispositivos filtrados y el tamaño de página.
  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalDeviceCount / this.pageSize));
  }
  // Propiedad que devuelve las opciones de región disponibles según los edificios cargados.
  get regionalOptions(): { IdRegional: number; NombreRegional: string }[] {
    const regions = new Map<number, string>();
    this.buildings.forEach((building) => {
      if (building.IdRegional !== null && building.NombreRegional) regions.set(building.IdRegional, building.NombreRegional);
    });
    return [...regions].map(([IdRegional, NombreRegional]) => ({ IdRegional, NombreRegional }));
  }
  // Propiedad que devuelve los edificios filtrados según la región seleccionada en los filtros.
  get filterBuildings(): Building[] {
    return this.selectedRegionalFilterId === null
      ? this.buildings
      : this.buildings.filter((building) => building.IdRegional === this.selectedRegionalFilterId);
  }
  // Propiedad que devuelve los edificios filtrados según la región seleccionada en el formulario de nuevo dispositivo.
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

  // Método que carga los dispositivos y los catálogos necesarios para los formularios de inventario
  loadDevices(): void {
    this.isLoadingDevices = true;
    const requestId = ++this.deviceRequestId;
    this.adminService.getDevices({
      Page: this.currentPage,
      PageSize: 25,
      SearchTerm: this.searchTerm,
      Brand: this.selectedBrand,
      Model: this.selectedModel,
      TypeId: this.selectedTypeId,
      RegionalId: this.selectedRegionalFilterId,
      BuildingId: this.selectedBuildingFilterId,
      AreaId: this.selectedAreaFilterId,
    }).subscribe({
      // Maneja la respuesta de la solicitud de dispositivos, actualizando la lista y el estado de carga.
      next: (result) => {
        if (requestId !== this.deviceRequestId) return;
        this.devices = result.Items;
        this.totalDeviceCount = result.TotalCount;
        this.currentPage = result.Page;
        this.isLoadingDevices = false;
      },
      // Maneja los errores de la solicitud de dispositivos, mostrando un mensaje de error y deteniendo el estado de carga.
      error: () => {
        if (requestId !== this.deviceRequestId) return;
        this.errorMessage = 'No se pudo cargar el inventario. Verifica que la API esté activa.';
        this.isLoadingDevices = false;
      },
    });
  }

  // Método que aplica los filtros de búsqueda y selección de marca, modelo y tipo
  applyFilters(): void {
    this.currentPage = 1;
    if (this.deviceFilterTimer) clearTimeout(this.deviceFilterTimer);
    this.deviceFilterTimer = setTimeout(() => {
      this.deviceFilterTimer = null;
      this.loadDevices();
    }, 250);
  }

  // Método que limpia los filtros de búsqueda y selección de marca, modelo y tipo
  clearFilters(): void {
    this.searchTerm = '';
    this.selectedBrand = '';
    this.selectedModel = '';
    this.selectedTypeId = null;
    this.selectedRegionalFilterId = null;
    this.selectedBuildingFilterId = null;
    this.selectedAreaFilterId = null;
    this.filterAreas = [];
    this.currentPage = 1;
    if (this.deviceFilterTimer) clearTimeout(this.deviceFilterTimer);
    this.loadDevices();
  }
//filtro de región
  selectRegionalFilter(idRegional: number | null): void {
    this.selectedRegionalFilterId = idRegional;
    this.selectedBuildingFilterId = null;
    this.selectedAreaFilterId = null;
    this.filterAreas = [];
    this.applyFilters();
  }

  //filtro de edificio
  selectBuildingFilter(idEdificio: number | null): void {
    this.selectedBuildingFilterId = idEdificio;
    this.selectedAreaFilterId = null;
    this.filterAreas = [];
    if (idEdificio !== null) {
      this.adminService.getAreas(idEdificio).subscribe({
        next: (areas) => this.filterAreas = areas,
        error: () => this.errorMessage = 'No se pudieron cargar las áreas del edificio.',
      });
    }
    this.applyFilters();
  }

  //filtro de región
  selectDeviceRegion(idRegional: number | null): void {
    this.selectedRegionId = idRegional;
    this.selectedBuildingId = null;
    this.newDevice.IdArea = null;
    this.areas = [];
    this.clearDeviceEmployeeSelection();
  }

    // Método que busca opciones de dispositivos según el término ingresado en el campo de búsqueda.
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
    // Solicita al servicio de administración las opciones de dispositivos que coincidan con el término de búsqueda.
    this.deviceOptionSearchTimer = setTimeout(() => {
      this.deviceOptionSearchTimer = null;
      this.adminService.searchDeviceOptions(searchTerm).subscribe({
        next: (options) => this.deviceOptions = options,
        error: () => this.errorMessage = 'No se pudieron buscar dispositivos.',
      });
    }, 250);
  }

  // Método que se ejecuta al seleccionar un edificvio y carga las areas ancladas a ese edificio
  selectBuilding(idEdificio: number | null): void {
    const buildingId = Number(idEdificio);
    this.selectedBuildingId = buildingId || null;
    this.selectedRegionId = this.buildings.find((building) => building.IdEdificio === this.selectedBuildingId)?.IdRegional ?? null;
    this.newDevice.IdArea = null;
    this.areas = [];
    if (this.editingDeviceId === null) this.clearDeviceEmployeeSelection();
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
    this.employeeCatalogError = '';
    if (idArea === null) return;

    const requestId = ++this.employeeOptionsRequestId;
    this.isLoadingEmployeeCatalog = true;
    this.isLoadingEmployeesForDevice = true;
    this.adminService.getEmployeeOptions(idArea).pipe(finalize(() => {
      if (requestId !== this.employeeOptionsRequestId) return;
      this.isLoadingEmployeeCatalog = false;
      this.isLoadingEmployeesForDevice = false;
    })).subscribe({
      next: (employees) => {
        if (requestId === this.employeeOptionsRequestId) this.employeesForDeviceArea = employees;
      },
      error: () => {
        if (requestId === this.employeeOptionsRequestId) {
          this.employeeCatalogError = 'No se pudo cargar el catálogo de empleados. Verifica la conexión con la API.';
        }
      },
    });
  }

  selectDeviceEmployee(employeeIndex: number | null): void {
    this.selectedEmployeeIndex = employeeIndex;
    const employee = employeeIndex === null ? undefined : this.employeesForDeviceArea[employeeIndex];
    this.newDevice.NumeroPagoAsignado = employee?.NoPago || null;
    this.newDevice.NombreAsignado = employee?.NombreCompleto ?? null;
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

  // Método que maneja los cambios en el estado del dispositivo, ajustando los campos relacionados 
  handleDeviceStateChange(state: string): void {
    // si un equipo esta disponible, no puede tener nombre, numero de pago ni area en la que esta asignada
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

  loadReassignments(): void {
    // Carga el historial de reasignaciones que se cargan en la pestaña de reasignaciones
    this.adminService.getReassignments().subscribe({
      next: (items) => this.reassignments = items,
      error: (error) => this.errorMessage = error.error?.Message ?? error.error?.message ?? error.error?.detail
        ?? error.message ?? 'No se pudieron cargar las reasignaciones.',
    });
  }

  selectSection(section: 'devices' | 'reassignments'): void {
    // Cambia de pestaña y solicita únicamente los datos necesarios
    this.activeSection = section;
    this.message = '';
    this.errorMessage = '';
    if (section === 'devices') this.loadDevices();
    else this.loadReassignments();
  }

  refreshPanel(): void {
    // Repite la carga de la pestaña activa y limpia mensajes anteriores
    this.message = '';
    this.errorMessage = '';
    this.selectSection(this.activeSection);
  }

  // metodo que agrega un nuevo dispositivo al inventario 
  addDevice(): void {
    this.clearMessages();
    if (this.newDevice.Estado === 'ASIGNADO' && this.selectedEmployeeIndex === null) {
      this.errorMessage = 'Selecciona un empleado del departamento indicado.';
      return;
    }
    this.adminService.createDevice(this.newDevice).subscribe({
      next: () => {
        this.message = 'Dispositivo agregado correctamente.';
        this.newDevice = { CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null, Estado: 'DISPONIBLE', NumeroPagoAsignado: null, NombreAsignado: null, IdArea: null };
        this.loadDevices();
      },
      error: (error) => this.errorMessage = error.error?.Message ?? 'No se pudo agregar el dispositivo.',
    });
  }

  editDevice(device: Device): void {
    // Coloca los datos seleccionados en el formulario modal de editar
    this.editingDeviceId = device.IdEquipo;
    this.editingCodigoInventario = device.CodigoInventario;
    this.editingNoSerie = device.NoSerie;
    this.selectedBuildingId = device.Estado === 'DISPONIBLE' ? null : device.IdEdificio;
    this.selectedRegionId = device.IdRegional;
    this.areas = [];
    if (this.selectedBuildingId !== null) {
      this.adminService.getAreas(this.selectedBuildingId).subscribe((areas) => this.areas = areas);
    }
    // Copia los datos del dispositivo seleccionado al formulario de editar
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
    this.isEditDialogOpen = true;
  }

  // Método que guarda los cambios realizados en un dispositivo que ya existe
  saveEditedDevice(): void {
    if (this.editingDeviceId === null) return;
    this.adminService.updateDevice(this.editingDeviceId, this.newDevice).subscribe({
      next: () => {
        this.message = 'Dispositivo actualizado correctamente.';
        this.cancelEdit();
        this.loadDevices();
      },
      error: (error) => this.errorMessage = error.error?.Message ?? 'No se pudo actualizar el dispositivo.',
    });
  }

  // Método que cancela la edición de un dispositivo y restablece el formulario
  cancelEdit(): void {
    this.editingDeviceId = null;
    this.editingCodigoInventario = '';
    this.editingNoSerie = '';
    this.selectedBuildingId = null;
    this.selectedRegionId = null;
    this.areas = [];
    this.isEditDialogOpen = false;
  }

  // Método que solicita la eliminación de un dispositivo, mostrando un diálogo de confirmación.
  askRemoveDevice(idEquipo: number): void {
    this.pendingDeleteDeviceId = idEquipo;
    this.isDeleteDialogOpen = true;
  }

  // Método que confirma la eliminación de un dispositivo y actualiza la tabla.
  confirmRemoveDevice(): void {
    if (this.pendingDeleteDeviceId === null) return;
    const idEquipo = this.pendingDeleteDeviceId;
    this.pendingDeleteDeviceId = null;
    this.isDeleteDialogOpen = false;
    this.adminService.deleteDevice(idEquipo).subscribe({
      next: () => { this.message = 'Dispositivo eliminado.'; this.loadDevices(); },
      error: (error) => this.errorMessage = error.error?.Message ?? error.error?.message ?? 'No se pudo quitar el dispositivo.',
    });
  }

  // Método que cancela la eliminación de un dispositivo y cierra el diálogo de confirmación.
  cancelRemoveDevice(): void {
    this.pendingDeleteDeviceId = null;
    this.isDeleteDialogOpen = false;
  }

  // Método que se ejecuta al seleccionar un dispositivo, actualizando la reasignación con su ID.
  selectDevice(codigoInventario: string): void {
    this.selectedInventoryCode = codigoInventario;
    this.newReassignment.IdEquipo = this.deviceOptions.find((device) => device.CodigoInventario === codigoInventario)?.IdEquipo ?? 0;
  }

  //ejecuta la carga de las areas disponibles para el edificio seleccionado en la pestaña de reasignaciones 
  selectReassignmentRegion(idRegional: number | null): void {
    this.reassignmentRegionalId = idRegional;
    this.reassignmentBuildingId = 0;
    this.newReassignment.IdEdificio = 0;
    this.newReassignment.IdArea = 0;
    this.reassignmentAreas = [];
    this.clearReassignmentEmployee();
  }

  // Ejecuta la carga de los departamentos disponibles para el edificio seleccionado.
  selectReassignmentBuilding(idEdificio: number): void {
    const buildingId = Number(idEdificio);
    this.reassignmentBuildingId = buildingId;
    this.newReassignment.IdEdificio = buildingId;
    this.newReassignment.IdArea = 0;
    this.reassignmentAreas = [];
    this.clearReassignmentEmployee();
    this.isLoadingAreas = buildingId > 0;
    if (buildingId > 0) {
      this.adminService.getAreas(buildingId).pipe(finalize(() => this.isLoadingAreas = false)).subscribe({
        next: (areas) => this.reassignmentAreas = areas,
        error: () => this.errorMessage = 'No se pudieron cargar los departamentos del edificio.',
      });
    }
  }

  selectReassignmentArea(idArea: number): void {
    this.newReassignment.IdArea = Number(idArea);
    this.clearReassignmentEmployee();
    if (this.newReassignment.IdArea <= 0) return;

    const requestId = ++this.reassignmentEmployeeRequestId;
    this.isLoadingReassignmentEmployees = true;
    this.employeeCatalogError = '';
    this.adminService.getEmployeeOptions(this.newReassignment.IdArea).pipe(finalize(() => {
      if (requestId !== this.reassignmentEmployeeRequestId) return;
      this.isLoadingReassignmentEmployees = false;
    })).subscribe({
      next: (employees) => {
        if (requestId === this.reassignmentEmployeeRequestId) this.reassignmentEmployees = employees;
      },
      error: () => {
        if (requestId === this.reassignmentEmployeeRequestId) {
          this.employeeCatalogError = 'No se pudo cargar el catálogo de empleados. Verifica la conexión con la API.';
        }
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

  // agrega una nueva reasignación al historial y actualiza la lista de dispositivos y reasignaciones
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

    // Asigna el edificio seleccionado a la nueva reasignación antes de enviarla al backend.
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
        this.loadDevices();
        this.loadReassignments();
      },
      error: (error) => this.errorMessage = error.error?.Message ?? error.error?.message ?? error.error?.detail ?? error.error?.title ?? error.message
        ?? 'No se pudo registrar la reasignación.',
    });
  }

  // aqui se obtiene el código de inventario de un dispositivo dado su ID, o devuelve el ID como cadena si no se encuentra.
  getInventoryCode(idEquipo: number): string {
    return this.devices.find((device) => device.IdEquipo === idEquipo)?.CodigoInventario ?? String(idEquipo);
  }

  // navega a la página especificada, asegurándose de que esté dentro del rango válido y actualiza la lista de dispositivos.
  goToPage(page: number): void {
    if (this.deviceFilterTimer) clearTimeout(this.deviceFilterTimer);
    this.currentPage = Math.min(Math.max(page, 1), this.totalPages);
    this.loadDevices();
  }

  logout(): void {
    //hace el logout del usuario y lo redirige a la página de login
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }

  private clearMessages(): void {
    this.message = '';
    this.errorMessage = '';
  }
}
