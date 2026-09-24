import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { AdminService } from '../admin/admin.service';
import { Area, CreateDevice, CreateReassignment, Device, DeviceType, Employee, Reassignment } from '../admin/admin.models';

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
  deviceTypes: DeviceType[] = [];
  employees: Employee[] = [];
  activeSection: 'devices' | 'reassignments' = 'devices';
  pageSize = 25;
  currentPage = 1;
  message = '';
  errorMessage = '';

  newDevice: CreateDevice = {
    CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null,
    Estado: 'DISPONIBLE', NumeroPagoAsignado: null, IdArea: null,
  };
  newReassignment: CreateReassignment = { IdEquipo: 0, NoPagoNuevo: null, NombreNuevo: '', Motivo: '' };
  selectedInventoryCode = '';
  editingDeviceId: number | null = null;
  isEditDialogOpen = false;

  constructor() {
    this.loadDevices();
  }

  get pagedDevices(): Device[] {
    // Proyecta la página visible sin modificar la lista completa.
    const startIndex = (this.currentPage - 1) * this.pageSize;
    return this.devices.slice(startIndex, startIndex + this.pageSize);
  }

  get totalPages(): number {
    // Calcula el número de páginas según el tamaño configurado.
    return Math.max(1, Math.ceil(this.devices.length / this.pageSize));
  }

  loadDevices(): void {
    // Carga equipos y catálogos necesarios para los formularios de inventario.
    this.adminService.getDevices().subscribe({
      next: (devices) => {
        this.devices = devices;
        this.currentPage = Math.min(this.currentPage, this.totalPages);
        forkJoin({
          deviceTypes: this.adminService.getDeviceTypes(),
          employees: this.adminService.getEmployees(),
          areas: this.adminService.getAreas(),
        }).subscribe((data) => {
          this.deviceTypes = data.deviceTypes;
          this.employees = data.employees;
          this.areas = data.areas;
        });
      },
      error: () => this.errorMessage = 'No se pudo cargar el inventario. Verifica que la API esté activa.',
    });
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
        this.newDevice = { CodigoInventario: '', NoSerie: '', Marca: '', Modelo: '', IdTipo: null, Estado: 'DISPONIBLE', NumeroPagoAsignado: null, IdArea: null };
        this.loadDevices();
      },
      error: (error) => this.errorMessage = error.error?.Message ?? 'No se pudo agregar el dispositivo.',
    });
  }

  editDevice(device: Device): void {
    // Coloca los datos seleccionados en el formulario modal de edición.
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
    this.isEditDialogOpen = false;
  }

  selectDevice(codigoInventario: string): void {
    this.selectedInventoryCode = codigoInventario;
    this.newReassignment.IdEquipo = this.devices.find((device) => device.CodigoInventario === codigoInventario)?.IdEquipo ?? 0;
  }

  setAreaFromPayment(noPago: string | null): void {
    const employee = this.employees.find((item) => item.NoPago === noPago);
    if (employee?.IdArea !== null && employee?.IdArea !== undefined) this.newDevice.IdArea = employee.IdArea;
  }

  addReassignment(): void {
    // Envía una reasignación y refresca ambas tablas al terminar.
    this.clearMessages();
    this.adminService.createReassignment(this.newReassignment).subscribe({
      next: () => {
        this.message = 'Reasignación registrada correctamente.';
        this.newReassignment = { IdEquipo: 0, NoPagoNuevo: null, NombreNuevo: '', Motivo: '' };
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
