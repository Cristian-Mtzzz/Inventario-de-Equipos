import { Component, ViewChild, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin, Observable, retry } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { AdminService } from './admin.service';
import { AdminUser, Area, CreateAdminUser, CreateDevice, CreateReassignment, Device, DeviceType, Employee, Reassignment } from './admin.models';
import { TallerComponent } from '../taller/taller.component';

type AdminSection = 'devices' | 'reassignments' | 'users' | 'workshop';

@Component({
  selector: 'app-admin',
  imports: [DatePipe, FormsModule, TallerComponent],
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
  reassignments: Reassignment[] = [];
  users: AdminUser[] = [];
  areas: Area[] = [];
  deviceTypes: DeviceType[] = [];
  employees: Employee[] = [];
  editingDeviceId: number | null = null;
  isEditDialogOpen = false;
  pendingDeviceId: number | null = null;
  pendingUserId: number | null = null;
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
  userSearchTerm = '';
  selectedUserRole = '';
  @ViewChild(TallerComponent) workshopComponent?: TallerComponent;

  newDevice: CreateDevice = {
    CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null,
    Estado: 'DISPONIBLE', NumeroPagoAsignado: null, IdArea: null,
  };
  newReassignment: CreateReassignment = { IdEquipo: 0, NoPagoNuevo: null, NombreNuevo: '', Motivo: '' };
  selectedInventoryCode = '';
  newUser: CreateAdminUser = { Usuario: '', Password: '', Rol: 'UsuarioComun' };

  constructor() {
    this.loadData();
  }

  get filteredDevices(): Device[] {
    const normalizedSearch = this.searchTerm.trim().toLowerCase();
    return this.devices.filter((device) => {
      const matchesSearch = !normalizedSearch
        || (device.CodigoInventario ?? '').toLowerCase().includes(normalizedSearch)
        || (device.NoSerie ?? '').toLowerCase().includes(normalizedSearch);
      const matchesBrand = !this.selectedBrand || device.Marca === this.selectedBrand;
      const matchesModel = !this.selectedModel || device.Modelo === this.selectedModel;
      const matchesType = this.selectedTypeId === null || device.IdTipo === this.selectedTypeId;

      return matchesSearch && matchesBrand && matchesModel && matchesType;
    });
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredDevices.length / this.pageSize));
  }

  get pagedDevices(): Device[] {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    return this.filteredDevices.slice(startIndex, startIndex + this.pageSize);
  }

  get availableBrands(): string[] {
    return [...new Set(this.devices.map((device) => device.Marca).filter(Boolean))].sort((first, second) => first.localeCompare(second));
  }

  get availableModels(): string[] {
    return [...new Set(this.devices.map((device) => device.Modelo).filter(Boolean))].sort((first, second) => first.localeCompare(second));
  }

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

  loadData(): void {
    // Carga únicamente los datos de la sección activa para evitar peticiones innecesarias.
    this.isLoading = true;
    this.errorMessage = '';
    if (this.activeSection === 'devices') {
      forkJoin({
        devices: this.adminService.getDevices(),
        deviceTypes: this.adminService.getDeviceTypes(),
        employees: this.adminService.getEmployees(),
        areas: this.adminService.getAreas(),
      }).pipe(retry({ count: 3, delay: 1000 })).subscribe({
        next: (data) => {
          this.devices = data.devices;
          const typesById = new Map<number, DeviceType>();
          [...data.deviceTypes, ...this.devices
            .filter((device) => device.IdTipo !== null && device.NombreTipo)
            .map((device) => ({ IdTipo: device.IdTipo!, NombreTipo: device.NombreTipo! }))]
            .forEach((type) => {
              const currentType = typesById.get(type.IdTipo);
              if (!currentType?.NombreTipo && type.NombreTipo) typesById.set(type.IdTipo, type);
            });
          this.deviceTypes = [...typesById.values()].sort((first, second) => first.NombreTipo.localeCompare(second.NombreTipo));
          this.employees = data.employees;
          this.areas = data.areas;
          this.currentPage = Math.min(this.currentPage, this.totalPages);
          this.isLoading = false;
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
    this.currentPage = Math.min(Math.max(page, 1), this.totalPages);
  }

  applyFilters(): void {
    this.currentPage = 1;
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedBrand = '';
    this.selectedModel = '';
    this.selectedTypeId = null;
    this.currentPage = 1;
  }

  clearUserFilters(): void {
    this.userSearchTerm = '';
    this.selectedUserRole = '';
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
        this.newDevice = { CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null, Estado: 'DISPONIBLE', NumeroPagoAsignado: null, IdArea: null };
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
    this.newDevice = {
      CodigoInventario: device.CodigoInventario,
      NoSerie: device.NoSerie,
      Marca: device.Marca,
      Modelo: device.Modelo,
      IdTipo: device.IdTipo,
      Estado: device.Estado,
      NumeroPagoAsignado: device.NumeroPagoAsignado,
      IdArea: device.IdArea,
    };
    this.activeSection = 'devices';
    this.isEditDialogOpen = true;
    this.clearMessages();
  }

  cancelEdit(): void {
    // Cancela la edición y restaura el formulario a su estado inicial.
    this.editingDeviceId = null;
    this.isEditDialogOpen = false;
    this.newDevice = { CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null, Estado: 'DISPONIBLE', NumeroPagoAsignado: null, IdArea: null };
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

  setAreaFromPayment(noPago: string | null): void {
    const employee = this.employees.find((item) => item.NoPago === noPago);
    if (!noPago) {
      this.newDevice.Estado = 'DISPONIBLE';
      this.newDevice.IdArea = null;
      return;
    }
    if (employee?.IdArea !== null && employee?.IdArea !== undefined) {
      this.newDevice.IdArea = employee.IdArea;
    }
  }

  private normalizeDevice(device: CreateDevice): CreateDevice {
    const numeroPago = device.NumeroPagoAsignado?.trim() || null;
    return {
      ...device,
      NumeroPagoAsignado: numeroPago,
      Estado: numeroPago ? device.Estado : 'DISPONIBLE',
      IdArea: numeroPago ? device.IdArea : null,
    };
  }

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

  cancelRemoveDevice(): void {
    this.pendingDeviceId = null;
    this.isDeleteDialogOpen = false;
  }

  addReassignment(): void {
    // Guarda el nuevo responsable y actualiza también la colección de dispositivos.
    this.clearMessages();
    this.adminService.createReassignment(this.newReassignment).subscribe({
      next: () => {
        this.message = 'Reasignación registrada correctamente.';
        this.newReassignment = { IdEquipo: 0, NoPagoNuevo: null, NombreNuevo: '', Motivo: '' };
        this.selectedInventoryCode = '';
        this.loadData();
        this.adminService.getDevices().subscribe({
          next: (devices) => this.devices = devices,
          error: () => this.errorMessage = 'La reasignación se guardó, pero no se pudo refrescar la tabla de dispositivos.',
        });
      },
      error: () => this.errorMessage = 'No se pudo registrar la reasignación.',
    });
  }

  selectDeviceForReassignment(codigoInventario: string): void {
    this.selectedInventoryCode = codigoInventario;
    const device = this.devices.find((item) => item.CodigoInventario === codigoInventario);
    this.newReassignment.IdEquipo = device?.IdEquipo ?? 0;
  }

  getInventoryCode(idEquipo: number): string {
    return this.devices.find((device) => device.IdEquipo === idEquipo)?.CodigoInventario ?? String(idEquipo);
  }

  addUser(): void {
    // Crea un usuario con el rol seleccionado desde el panel.
    this.clearMessages();
    this.adminService.createUser(this.newUser).subscribe({
      next: () => {
        this.message = 'Usuario agregado correctamente.';
        this.newUser = { Usuario: '', Password: '', Rol: 'UsuarioComun' };
        this.loadData();
      },
      error: () => this.errorMessage = 'No se pudo agregar el usuario.',
    });
  }

  askRemoveUser(idUsuario: number): void {
    this.pendingUserId = idUsuario;
    this.pendingDeviceId = null;
    this.isDeleteDialogOpen = true;
  }

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

  cancelRemoveUser(): void {
    this.pendingUserId = null;
    this.isDeleteDialogOpen = false;
  }

  private clearMessages(): void {
    this.message = '';
    this.errorMessage = '';
  }

  private showLoadError(): void {
    this.errorMessage = 'No se pudo cargar esta sección. Verifica que el backend esté iniciado.';
    this.isLoading = false;
  }

  private getErrorMessage(error: { error?: { Message?: string; message?: string } }, fallback: string): string {
    return error.error?.Message ?? error.error?.message ?? fallback;
  }
}