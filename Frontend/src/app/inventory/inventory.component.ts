import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { AdminService } from '../admin/admin.service';
import { Area, Building, CreateDevice, CreateReassignment, Device, DeviceType, Reassignment } from '../admin/admin.models';

@Component({
  selector: 'app-inventory',
  imports: [DatePipe, FormsModule],
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
  reassignments: Reassignment[] = [];
  areas: Area[] = [];
  isLoadingAreas = false;
  buildings: Building[] = [];
  selectedBuildingId: number | null = null;
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

  newDevice: CreateDevice = {
    CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null,
    Estado: 'DISPONIBLE', NumeroPagoAsignado: null, NombreAsignado: null, IdArea: null,
  };
  newReassignment: CreateReassignment = { IdEquipo: 0, NoPagoNuevo: null, NombreNuevo: '', Motivo: '', IdEdificio: 0, IdArea: 0 };
  reassignmentBuildingId = 0;
  reassignmentAreas: Area[] = [];
  selectedInventoryCode = '';
  editingDeviceId: number | null = null;
  editingCodigoInventario = '';
  editingNoSerie = '';
  isEditDialogOpen = false;
  pendingDeleteDeviceId: number | null = null;
  isDeleteDialogOpen = false;

  constructor() {
    this.loadDevices();
  }

  get canRemoveDevices(): boolean {
    return this.authService.hasRole(['Admin']);
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

  get pagedDevices(): Device[] {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    return this.filteredDevices.slice(startIndex, startIndex + this.pageSize);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredDevices.length / this.pageSize));
  }

  get availableBrands(): string[] {
    return [...new Set(this.devices.map((device) => device.Marca).filter(Boolean))].sort((first, second) => first.localeCompare(second));
  }

  get availableModels(): string[] {
    return [...new Set(this.devices.map((device) => device.Modelo).filter(Boolean))].sort((first, second) => first.localeCompare(second));
  }

  loadDevices(): void {
    // Carga equipos y catálogos necesarios para los formularios de inventario.
    this.adminService.getDevices().subscribe({
      next: (devices) => {
        this.devices = devices;
        this.currentPage = Math.min(this.currentPage, this.totalPages);
        forkJoin({
          deviceTypes: this.adminService.getDeviceTypes(),
          buildings: this.adminService.getBuildings(),
        }).subscribe((data) => {
          this.deviceTypes = data.deviceTypes;
          this.buildings = data.buildings;
        });
      },
      error: () => this.errorMessage = 'No se pudo cargar el inventario. Verifica que la API esté activa.',
    });
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

  selectBuilding(idEdificio: number | null): void {
    const buildingId = Number(idEdificio);
    this.selectedBuildingId = buildingId || null;
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
      this.areas = [];
    }
  }

  loadReassignments(): void {
    // Carga el historial que se muestra en la pestaña Reasignaciones.
    this.adminService.getReassignments().subscribe({
      next: (items) => this.reassignments = items,
      error: () => this.errorMessage = 'No se pudieron cargar las reasignaciones.',
    });
  }

  selectSection(section: 'devices' | 'reassignments'): void {
    // Cambia de pestaña y solicita únicamente los datos necesarios.
    this.activeSection = section;
    this.message = '';
    this.errorMessage = '';
    if (section === 'devices') this.loadDevices();
    else this.loadReassignments();
  }

  refreshPanel(): void {
    // Repite la carga de la pestaña activa y limpia mensajes anteriores.
    this.message = '';
    this.errorMessage = '';
    this.selectSection(this.activeSection);
  }

  addDevice(): void {
    this.clearMessages();
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
    // Coloca los datos seleccionados en el formulario modal de edición.
    this.editingDeviceId = device.IdEquipo;
    this.editingCodigoInventario = device.CodigoInventario;
    this.editingNoSerie = device.NoSerie;
    this.selectedBuildingId = device.Estado === 'DISPONIBLE' ? null : device.IdEdificio;
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
    this.isEditDialogOpen = true;
  }

  saveEditedDevice(): void {
    // Envía los cambios y vuelve a cargar la tabla cuando la API responde.
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

  cancelEdit(): void {
    this.editingDeviceId = null;
    this.editingCodigoInventario = '';
    this.editingNoSerie = '';
    this.selectedBuildingId = null;
    this.areas = [];
    this.isEditDialogOpen = false;
  }

  askRemoveDevice(idEquipo: number): void {
    this.pendingDeleteDeviceId = idEquipo;
    this.isDeleteDialogOpen = true;
  }

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

  cancelRemoveDevice(): void {
    this.pendingDeleteDeviceId = null;
    this.isDeleteDialogOpen = false;
  }

  selectDevice(codigoInventario: string): void {
    this.selectedInventoryCode = codigoInventario;
    this.newReassignment.IdEquipo = this.devices.find((device) => device.CodigoInventario === codigoInventario)?.IdEquipo ?? 0;
  }

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

  addReassignment(): void {
    // Envía una reasignación y refresca ambas tablas al terminar.
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
        this.loadDevices();
        this.loadReassignments();
      },
      error: (error) => this.errorMessage = error.error?.Message ?? 'No se pudo registrar la reasignación.',
    });
  }

  getInventoryCode(idEquipo: number): string {
    return this.devices.find((device) => device.IdEquipo === idEquipo)?.CodigoInventario ?? String(idEquipo);
  }

  goToPage(page: number): void {
    this.currentPage = Math.min(Math.max(page, 1), this.totalPages);
  }

  logout(): void {
    // Finaliza la sesión y navega a login.
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }

  private clearMessages(): void {
    this.message = '';
    this.errorMessage = '';
  }
}
