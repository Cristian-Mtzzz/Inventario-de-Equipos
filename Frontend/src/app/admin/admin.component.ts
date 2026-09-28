import { Component, ViewChild, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize, forkJoin, Observable, retry } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { AdminService } from './admin.service';
import { AdminUser, Area, Building, CreateAdminUser, CreateDevice, CreateReassignment, Device, DeviceOption, DeviceType, Reassignment, UpdateAdminUser } from './admin.models';
import { TallerComponent } from '../taller/taller.component';
import { EmployeeSearchDialogComponent } from './employee-search-dialog.component';

type AdminSection = 'devices' | 'reassignments' | 'users' | 'workshop';

@Component({
  selector: 'app-admin',
  imports: [DatePipe, FormsModule, TallerComponent, EmployeeSearchDialogComponent],
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
  activeSection: AdminSection = 'devices';
  devices: Device[] = [];
  totalDeviceCount = 0;
  reassignments: Reassignment[] = [];
  users: AdminUser[] = [];
  areas: Area[] = [];
  isLoadingAreas = false;
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
  readonly pageSize = 25;
  currentPage = 1;
  showAdminMenu = false;
  searchTerm = '';
  selectedBrand = '';
  selectedModel = '';
  selectedTypeId: number | null = null;
  private deviceFilterTimer: ReturnType<typeof setTimeout> | null = null;
  private deviceRequestId = 0;
  showEmployeeSearch = false;
  deviceOptions: DeviceOption[] = [];
  deviceOptionSearch = '';
  userSearchTerm = '';
  selectedUserRole = '';
  @ViewChild(TallerComponent) workshopComponent?: TallerComponent;
  
  // Estado inicial para la creación de un nuevo dispositivo, reasignación o usuario.
  newDevice: CreateDevice = {
    CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null,
    Estado: 'DISPONIBLE', NumeroPagoAsignado: null, NombreAsignado: null, IdArea: null,
  };
  newReassignment: CreateReassignment = { IdEquipo: 0, NoPagoNuevo: null, NombreNuevo: '', Motivo: '', IdEdificio: 0, IdArea: 0 };
  reassignmentBuildingId = 0;
  reassignmentAreas: Area[] = [];
  selectedInventoryCode = '';
  newUser: CreateAdminUser = {
    Usuario: '', NombrePersona: '', FechaExpiracion: null, Estado: 'ACTIVO',
    DominioP: 'BA', Dominio: 0, Rol: 'UsuarioComun',
  };
  // Constructor y métodos de inicialización.
  constructor() {
    this.loadData();
  }

  // Métodos auxiliares para el filtrado y paginación de dispositivos y usuarios.
  get filteredDevices(): Device[] { return this.devices; }

  // Métodos para la paginación de dispositivos.
  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalDeviceCount / this.pageSize));
  }
  // Fin de los métodos para la paginación de dispositivos.
  get pagedDevices(): Device[] {
    return this.devices;
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
  // Fin de los métodos auxiliares para el filtrado de usuarios.

  loadData(): void {
    // Carga únicamente los datos de la sección activa para evitar peticiones innecesarias.
    this.isLoading = true;
    this.errorMessage = '';
    if (this.activeSection === 'devices') {
      forkJoin({
        deviceTypes: this.adminService.getDeviceTypes(),
        buildings: this.adminService.getBuildings(),
      }).pipe(retry({ count: 3, delay: 1000 })).subscribe({
        next: (data) => {
          const typesById = new Map<number, DeviceType>();
          data.deviceTypes.forEach((type) => {
              const currentType = typesById.get(type.IdTipo);
              if (!currentType?.NombreTipo && type.NombreTipo) typesById.set(type.IdTipo, type);
            });
          this.deviceTypes = [...typesById.values()].sort((first, second) => first.NombreTipo.localeCompare(second.NombreTipo));
          this.buildings = data.buildings;
          this.loadDevicePage();
        },
        error: () => this.showLoadError(),
      });
      return;
    }

    if (this.activeSection === 'workshop') {
      this.workshopComponent?.loadData();
      this.isLoading = false;
      return;
    }

    // Carga de datos para secciones que no son dispositivos ni taller.
    const sectionRequest: Observable<Reassignment[] | AdminUser[]> = this.activeSection === 'reassignments'
      ? this.adminService.getReassignments().pipe(retry({ count: 3, delay: 1000 }))
      : this.adminService.getUsers().pipe(retry({ count: 3, delay: 1000 }));
    sectionRequest.subscribe({
      next: (items: Reassignment[] | AdminUser[]) => {
        if (this.activeSection === 'reassignments') this.reassignments = items as Reassignment[];
        else this.users = items as AdminUser[];
        this.isLoading = false;
      },
      error: () => this.showLoadError(),
    });
  }

  selectSection(section: AdminSection): void {
    // Cambia de sección, limpia mensajes y dispara su recarga.
    this.activeSection = section;
    this.message = '';
    this.errorMessage = '';
    this.loadData();
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
    if (this.deviceFilterTimer) clearTimeout(this.deviceFilterTimer);
    this.currentPage = Math.min(Math.max(page, 1), this.totalPages);
    this.loadDevicePage();
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
    this.selectedTypeId = null;
    this.selectedRegionalFilterId = null;
    this.selectedBuildingFilterId = null;
    this.selectedAreaFilterId = null;
    this.filterAreas = [];
    this.currentPage = 1;
    if (this.deviceFilterTimer) clearTimeout(this.deviceFilterTimer);
    this.loadDevicePage();
  }

  loadDevicePage(): void {
    if (this.activeSection !== 'devices') return;
    this.isLoading = true;
    const requestId = ++this.deviceRequestId;
    this.adminService.getDevices({
      Page: this.currentPage,
      SearchTerm: this.searchTerm,
      Brand: this.selectedBrand,
      Model: this.selectedModel,
      TypeId: this.selectedTypeId,
      RegionalId: this.selectedRegionalFilterId,
      BuildingId: this.selectedBuildingFilterId,
      AreaId: this.selectedAreaFilterId,
    }).subscribe({
      next: (result) => {
        if (requestId !== this.deviceRequestId) return;
        this.devices = result.Items;
        this.totalDeviceCount = result.TotalCount;
        this.currentPage = result.Page;
        this.isLoading = false;
      },
      error: () => {
        if (requestId === this.deviceRequestId) this.showLoadError();
      },
    });
  }

  selectRegionalFilter(idRegional: number | null): void {
    this.selectedRegionalFilterId = idRegional;
    this.selectedBuildingFilterId = null;
    this.selectedAreaFilterId = null;
    this.filterAreas = [];
    this.applyFilters();
  }

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

  selectDeviceRegion(idRegional: number | null): void {
    this.selectedRegionId = idRegional;
    this.selectedBuildingId = null;
    this.newDevice.IdArea = null;
    this.areas = [];
  }

  searchDeviceOptions(): void {
    this.selectedInventoryCode = '';
    this.newReassignment.IdEquipo = 0;
    if (this.deviceOptionSearch.trim().length < 2) {
      this.deviceOptions = [];
      return;
    }
    this.adminService.searchDeviceOptions(this.deviceOptionSearch.trim()).subscribe({
      next: (options) => this.deviceOptions = options,
      error: () => this.errorMessage = 'No se pudieron buscar dispositivos.',
    });
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
    this.isLoadingAreas = buildingId > 0;
    if (buildingId > 0) {
      this.adminService.getAreas(buildingId).pipe(finalize(() => this.isLoadingAreas = false)).subscribe({
        next: (areas) => this.areas = areas,
        error: () => this.errorMessage = 'No se pudieron cargar las áreas del edificio.',
      });
    }
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
    }
  }

  addDevice(): void {
    // Decide entre crear o actualizar según exista un ID en edición.
    this.clearMessages();
    if (!this.isDeviceComplete(this.newDevice)) {
      this.errorMessage = 'Completa código, número de serie, marca, modelo y tipo de dispositivo.';
      return;
    }
    const device = this.normalizeDevice(this.newDevice);
    const request = this.editingDeviceId === null
      ? this.adminService.createDevice(device)
      : this.adminService.updateDevice(this.editingDeviceId, device);
    request.subscribe({
      next: () => {
        this.message = this.editingDeviceId === null
          ? 'Dispositivo agregado correctamente.'
          : 'Dispositivo actualizado correctamente.';
        this.editingDeviceId = null;
        this.newDevice = { CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null, Estado: 'DISPONIBLE', NumeroPagoAsignado: null, NombreAsignado: null, IdArea: null };
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
    this.newReassignment.IdEdificio = this.reassignmentBuildingId;
    this.adminService.createReassignment(this.newReassignment).subscribe({
      next: () => {
        this.message = 'Reasignación registrada correctamente.';
        this.newReassignment = { IdEquipo: 0, NoPagoNuevo: null, NombreNuevo: '', Motivo: '', IdEdificio: 0, IdArea: 0 };
        this.reassignmentBuildingId = 0;
        this.reassignmentAreas = [];
        this.selectedInventoryCode = '';
        this.loadData();
      },
      error: () => this.errorMessage = 'No se pudo registrar la reasignación.',
    });
  }

  // Selecciona un dispositivo para reasignación y actualiza el modelo correspondiente.
  selectDeviceForReassignment(codigoInventario: string): void {
    this.selectedInventoryCode = codigoInventario;
    const device = this.deviceOptions.find((item) => item.CodigoInventario === codigoInventario);
    this.newReassignment.IdEquipo = device?.IdEquipo ?? 0;
  }

  // Selecciona un edificio para la reasignación y carga los departamentos correspondientes.
  selectReassignmentBuilding(idEdificio: number): void {
    const buildingId = Number(idEdificio);
    this.reassignmentBuildingId = buildingId;
    this.newReassignment.IdArea = 0;
    this.reassignmentAreas = [];
    this.isLoadingAreas = buildingId > 0;
    if (buildingId > 0) {
      this.adminService.getAreas(buildingId).pipe(finalize(() => this.isLoadingAreas = false)).subscribe({
        next: (areas) => this.reassignmentAreas = areas,
        error: () => this.errorMessage = 'No se pudieron cargar los departamentos del edificio.',
      });
    }
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
          DominioP: 'BA', Dominio: 0, Rol: 'UsuarioComun',
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
      DominioP: 'BA', Dominio: 0, Rol: 'UsuarioComun',
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
  }
  // Obtiene el mensaje de error a mostrar, usando un valor de respaldo si no se encuentra un mensaje específico.
  private getErrorMessage(error: { error?: { Message?: string; message?: string } }, fallback: string): string {
    return error.error?.Message ?? error.error?.message ?? fallback;
  }
}