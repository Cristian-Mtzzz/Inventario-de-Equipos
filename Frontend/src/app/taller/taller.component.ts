import { DatePipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject, Input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { AdminService } from '../admin/admin.service';
import { DeviceType } from '../admin/admin.models';
import { Maintenance, MaintenanceEditRequest, MaintenanceEntryRequest, MaintenanceExitRequest, ReceptionEntryRequest, WorkshopDevice } from './taller.models';
import { TallerService } from './taller.service';

@Component({
  selector: 'app-taller',
  imports: [DatePipe, FormsModule],
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
  deviceTypes: DeviceType[] = [];
  selectedMaintenance: Maintenance | null = null;
  pendingDeleteMaintenance: Maintenance | null = null;
  activeWindow: 'reception' | 'entry' | 'exit' | 'edit' | null = null;
  isLoading = false;
  isSaving = false;
  message = '';
  errorMessage = '';
  reception: ReceptionEntryRequest = {
    CodigoInventario: '',
    TipoDispositivo: '',
    AreaOrigen: '',
    FechaIngreso: this.getCurrentDateTime(),
  };
  entry: MaintenanceEntryRequest = { IdEquipo: 0, Dictamen: '', TipoReparacion: '', FechaIngreso: this.getCurrentDateTime() };
  exit: MaintenanceExitRequest = { DetalleReparacion: '', FechaSalida: this.getCurrentDateTime() };
  edit: MaintenanceEditRequest = { IdEquipo: 0, Dictamen: '', TipoReparacion: '', FechaIngreso: '', DetalleReparacion: '', FechaSalida: null };

  constructor() { this.loadData(); }

  loadData(): void {
    // Refresca en paralelo equipos, reparaciones y tipos disponibles.
    this.errorMessage = '';
    this.loadDevices();
    this.loadMaintenances();
    this.loadDeviceTypes();
  }

  loadDeviceTypes(): void {
    // Carga los tipos de dispositivo que aparecen en la recepción.
    this.adminService.getDeviceTypes().subscribe({
      next: (types) => this.deviceTypes = types,
      error: () => this.deviceTypes = [],
    });
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
    this.message = '';
    this.errorMessage = '';
    this.reception = {
      CodigoInventario: '',
      TipoDispositivo: '',
      AreaOrigen: '',
      FechaIngreso: this.getCurrentDateTime(),
    };
    this.activeWindow = 'reception';
  }

  saveReception(): void {
    // Valida y registra la recepción con la fecha/hora generada por el sistema.
    this.message = '';
    this.errorMessage = '';
    if (!this.reception.CodigoInventario.trim() || !this.reception.TipoDispositivo.trim() || !this.reception.AreaOrigen.trim() || !this.reception.FechaIngreso) {
      this.errorMessage = 'Completa el número de inventario, tipo de dispositivo, área de origen y la fecha de ingreso.';
      return;
    }

    this.isSaving = true;
    this.tallerService.createReceptionEntry(this.reception).pipe(finalize(() => this.isSaving = false)).subscribe({
      next: () => {
        this.message = 'Recepción registrada correctamente. El equipo quedó en espera de revisión.';
        this.closeWindow();
        this.loadData();
      },
      error: (error) => this.errorMessage = error.error?.Message ?? error.error?.message ?? 'No se pudo registrar la recepción.',
    });
  }

  openEntryWindow(): void {
    // Abre el flujo tradicional de ingreso para un equipo ya registrado.
    this.message = '';
    this.errorMessage = '';
    this.entry = { IdEquipo: 0, Dictamen: '', TipoReparacion: '', FechaIngreso: this.getCurrentDateTime() };
    this.activeWindow = 'entry';
  }

  saveEntry(): void {
    this.message = '';
    this.errorMessage = '';
    if (this.entry.IdEquipo <= 0 || !this.entry.FechaIngreso) {
      this.errorMessage = 'Selecciona un equipo e indica la fecha de ingreso.';
      return;
    }
    this.isSaving = true;
    this.tallerService.createMaintenance(this.entry).pipe(finalize(() => this.isSaving = false)).subscribe({
      next: () => { this.message = 'Ingreso al taller registrado.'; this.closeWindow(); this.loadMaintenances(); },
      error: (error) => this.errorMessage = error.error?.Message ?? error.error?.message ?? 'No se pudo registrar el ingreso.',
    });
  }

  openExitWindow(item: Maintenance): void {
    // Prepara la salida usando la reparación elegida como contexto.
    this.message = '';
    this.errorMessage = '';
    this.selectedMaintenance = item;
    this.exit = { DetalleReparacion: item.DetalleReparacion ?? '', FechaSalida: this.getCurrentDateTime() };
    this.activeWindow = 'exit';
  }

  saveExit(): void {
    // Registra la salida solo cuando existe detalle de reparación.
    this.message = '';
    this.errorMessage = '';
    if (!this.selectedMaintenance || !this.exit.FechaSalida || !this.exit.DetalleReparacion.trim()) {
      this.errorMessage = 'Indica la fecha de salida y describe lo que se le hizo al equipo.';
      return;
    }
    this.isSaving = true;
    this.tallerService.updateMaintenance(this.selectedMaintenance.IdReparacion, this.exit).pipe(finalize(() => this.isSaving = false)).subscribe({
      next: () => { this.message = 'Salida del taller registrada.'; this.closeWindow(); this.loadMaintenances(); },
      error: (error) => this.errorMessage = error.error?.Message ?? error.error?.message ?? 'No se pudo registrar la salida.',
    });
  }

  get isAdmin(): boolean { return this.authService.hasRole(['Admin']); }

  openEditWindow(item: Maintenance): void {
    // Copia una reparación al formulario que solo puede usar Admin.
    this.message = '';
    this.errorMessage = '';
    this.selectedMaintenance = item;
    this.edit = {
      IdEquipo: item.IdEquipo,
      Dictamen: item.Dictamen ?? '',
      TipoReparacion: item.TipoReparacion ?? '',
      FechaIngreso: this.toDateTimeLocal(item.FechaIngreso),
      DetalleReparacion: item.DetalleReparacion ?? '',
      FechaSalida: item.FechaSalida ? this.toDateTimeLocal(item.FechaSalida) : null,
    };
    this.activeWindow = 'edit';
  }

  saveEdit(): void {
    if (!this.selectedMaintenance || this.edit.IdEquipo <= 0 || !this.edit.FechaIngreso) {
      this.errorMessage = 'Selecciona un equipo e indica la fecha de ingreso.';
      return;
    }
    this.isSaving = true;
    this.tallerService.editMaintenance(this.selectedMaintenance.IdReparacion, this.edit).pipe(finalize(() => this.isSaving = false)).subscribe({
      next: () => { this.message = 'Reparación actualizada.'; this.closeWindow(); this.loadMaintenances(); },
      error: (error) => this.errorMessage = error.error?.Message ?? error.error?.message ?? 'No se pudo actualizar la reparación.',
    });
  }

  deleteMaintenance(item: Maintenance): void {
    if (!this.isAdmin) return;
    this.pendingDeleteMaintenance = item;
  }

  confirmDeleteMaintenance(): void {
    // Ejecuta la eliminación después de la confirmación visual del usuario.
    if (!this.pendingDeleteMaintenance) return;
    const maintenanceId = this.pendingDeleteMaintenance.IdReparacion;
    this.pendingDeleteMaintenance = null;
    this.isSaving = true;
    this.tallerService.deleteMaintenance(maintenanceId).pipe(finalize(() => this.isSaving = false)).subscribe({
      next: () => { this.message = 'Reparación eliminada.'; this.loadMaintenances(); },
      error: (error) => this.errorMessage = error.error?.Message ?? error.error?.message ?? 'No se pudo eliminar la reparación.',
    });
  }

  cancelDeleteMaintenance(): void {
    this.pendingDeleteMaintenance = null;
  }

  refreshPanel(): void {
    this.message = '';
    this.errorMessage = '';
    this.loadData();
  }

  closeWindow(): void {
    // Cierra cualquier ventana modal y libera la selección actual.
    this.activeWindow = null;
    this.selectedMaintenance = null;
  }

  getDeviceLabel(device: WorkshopDevice): string {
    return `${device.CodigoInventario} · ${device.Marca} ${device.Modelo}`;
  }

  isOpenMaintenance(item: Maintenance): boolean { return item.FechaSalida === null; }

  logout(): void {
    // Finaliza la sesión del técnico o administrador.
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }

  private getCurrentDateTime(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  private toDateTimeLocal(value: string): string {
    return value ? value.slice(0, 16) : '';
  }
}
