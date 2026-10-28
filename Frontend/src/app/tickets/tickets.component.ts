import { ChangeDetectorRef, Component, DestroyRef, Input, inject } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { finalize, firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { AppHeaderComponent } from '../shared/app-header.component';
import { ModuleTabsComponent } from '../shared/module-tabs.component';
import { apiErrorMessage } from '../shared/api-response';
import { DigitsOnlyDirective } from '../shared/digits-only.directive';
import { HighlightInvalidDirective, RequiredIdDirective } from '../shared/required-fields.directive';
import { EmployeeLookupComponent, EmployeeLookupResult } from '../shared/employee-lookup.component';
import { PagePipe, TablePageSizeComponent, TablePaginatorComponent } from '../shared/table-paginator';
import { CreateTicketRequest, FinishTicketRequest, TICKET_SUPPORT_TYPES, Ticket, TicketAlertThresholds, TicketSupportType, TicketTechnician } from './tickets.models';
import { TicketsService } from './tickets.service';
import { TicketReportFilters, elapsed, emptyTicketReportFilters, exportTicketsReport, filterTicketsForReport } from './tickets-report';

type TicketWindow = 'none' | 'create' | 'reassign' | 'finish' | 'report';

// Empleado mostrado en el formulario. NoPago es null al editar (la tabla no lo trae), así que
// el aviso de "sin No. de pago" solo aparece cuando se acaba de elegir con el buscador.
interface TicketFormEmployee {
  NombreCompleto: string;
  NoPago: string | null;
  Regional: string | null;
  Edificio: string | null;
  Departamento: string | null;
}

const emptyTicket = (): CreateTicketRequest => ({ IdEmpleado: 0, Detalle: '', IdTecnico: 0, TipoSoporte: '' });
const emptyFinish = (): FinishTicketRequest => ({ NoPago: '', Observaciones: '', Valoracion: '' });

@Component({
  selector: 'app-tickets',
  imports: [DatePipe, FormsModule, AppHeaderComponent, ModuleTabsComponent, DigitsOnlyDirective, HighlightInvalidDirective, RequiredIdDirective, EmployeeLookupComponent, PagePipe, TablePageSizeComponent, TablePaginatorComponent],
  templateUrl: './tickets.component.html',
  // Reusa los estilos del taller para que el módulo se vea igual que el resto del sistema;
  // tickets.component.css solo agrega lo propio de esta pantalla.
  styleUrls: ['../taller/taller.component.css', './tickets.component.css'],
})
// Módulo Tickets de soporte. Sirve como pantalla propia (/tickets) y como sección del
// panel administrativo; lo que se puede hacer depende del rol:
//  - Admin de tickets: crea, edita y reasigna.
//  - Técnico: solo finaliza los tickets que tiene asignados.
export class TicketsComponent {
  private readonly ticketsService = inject(TicketsService);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);

  // Dentro del panel administrativo la cabecera y el título los pone el panel.
  @Input() embedded = false;

  private isActive = true;
  // Cuando se usa como sección del panel, solo carga al entrar en ella.
  @Input() set active(value: boolean) {
    if (value && !this.isActive) {
      this.clearMessages();
      if (!this.ticketsLoaded) this.loadTickets();
    }
    this.isActive = value;
  }
  get active(): boolean { return this.isActive; }

  tickets: Ticket[] = [];
  ticketPage = 1;
  ticketPageSize = 10;
  searchTerm = '';
  isLoading = false;
  isSaving = false;
  message = '';
  errorMessage = '';
  private ticketsLoaded = false;

  activeWindow: TicketWindow = 'none';
  selectedTicket: Ticket | null = null;
  editingTicketId: number | null = null;

  // Formulario de creación/edición: el empleado se elige con el buscador y su ubicación
  // (Regional, Edificio, Departamento) se completa sola.
  form: CreateTicketRequest = emptyTicket();
  technicians: TicketTechnician[] = [];
  readonly supportTypes = TICKET_SUPPORT_TYPES;
  selectedEmployee: TicketFormEmployee | null = null;

  reassignTechnicianId = 0;
  finish: FinishTicketRequest = emptyFinish();
  // Filtros de la ventana "Exportar reporte".
  reportFilters: TicketReportFilters = emptyTicketReportFilters();
  isExporting = false;

  // Reloj que alimenta el contador de la tabla; avanza cada segundo.
  private now = Date.now();
  // Minutos para el cambio de color. Son los de referencia hasta que llegan los de la base.
  private thresholds: TicketAlertThresholds = { MinutosVerde: 30, MinutosAmarillo: 60 };

  constructor() {
    this.loadTickets();
    this.loadAlertThresholds();
    if (this.isTicketManager) this.loadFormCatalogs();

    const clock = setInterval(() => {
      this.now = Date.now();
      this.changeDetector.markForCheck();
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(clock));
  }

  // Si fallan, quedan los minutos de referencia: el contador sigue funcionando.
  private loadAlertThresholds(): void {
    this.ticketsService.getAlertThresholds().subscribe({
      next: (thresholds) => { this.thresholds = thresholds; this.changeDetector.markForCheck(); },
      error: () => { },
    });
  }

  get isTicketManager(): boolean { return this.authService.hasRole(['Admin', 'AdminTicket']); }
  get isTechnician(): boolean { return this.authService.hasRole(['TecnicoTaller']) && !this.isTicketManager; }


  get filteredTickets(): Ticket[] {
    const term = this.searchTerm.trim().toUpperCase();
    if (!term) return this.tickets;
    return this.tickets.filter((ticket) =>
      ticket.Empleado.toUpperCase().includes(term)
      || ticket.Detalle.toUpperCase().includes(term)
      || (ticket.Tecnico ?? '').toUpperCase().includes(term)
      || (ticket.Departamento ?? '').toUpperCase().includes(term)
      || this.supportTypeLabel(ticket.TipoSoporte).toUpperCase().includes(term)
      || String(ticket.IdTicket).includes(term));
  }

  display(value: string | null): string { return value?.trim() ? value : '-'; }

  // Nombre legible del tipo de soporte (APLICATIVO -> Soporte aplicativo).
  supportTypeLabel(value: string | null): string {
    return this.supportTypes.find((type) => type.value === value?.toUpperCase())?.label ?? '-';
  }

  isOpen(ticket: Ticket): boolean { return ticket.Estado?.toUpperCase() === 'PENDIENTE'; }

  // Minutos que lleva abierto el ticket, según el reloj que avanza cada segundo.
  private openMinutes(ticket: Ticket): number {
    return this.openSeconds(ticket) / 60;
  }

  private openSeconds(ticket: Ticket): number {
    // La API manda la fecha sin zona horaria: el navegador la lee como hora local,
    // que es la misma del servidor.
    const start = new Date(ticket.FechaCreacion).getTime();
    return Number.isNaN(start) ? 0 : Math.max(0, (this.now - start) / 1000);
  }

  // Contador en vivo del tiempo que la tarea lleva activa: "2 d 03:15:42".
  activeElapsed(ticket: Ticket): string {
    if (!this.isOpen(ticket)) return '-';

    const total = Math.floor(this.openSeconds(ticket));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = (value: number) => String(value).padStart(2, '0');
    const clock = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    return days > 0 ? `${days} d ${clock}` : clock;
  }

  // Color del estado según lo que lleva esperando, con los minutos configurados en la base.
  alertLevel(ticket: Ticket): 'ok' | 'warn' | 'late' | '' {
    if (!this.isOpen(ticket)) return '';
    const minutes = this.openMinutes(ticket);
    if (minutes <= this.thresholds.MinutosVerde) return 'ok';
    if (minutes <= this.thresholds.MinutosAmarillo) return 'warn';
    return 'late';
  }

  // Duración del servicio en un formato corto: "1d, 22h, 20m".
  elapsed(ticket: Ticket): string {
    return elapsed(ticket);
  }

  updateSearch(term: string): void {
    this.searchTerm = term;
    this.ticketPage = 1;
  }

  loadTickets(): void {
    this.isLoading = true;
    this.ticketsService.getTickets().pipe(
      finalize(() => { this.isLoading = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: (tickets) => {
        this.tickets = tickets;
        this.ticketsLoaded = true;
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudieron cargar los tickets.');
        this.changeDetector.markForCheck();
      },
    });
  }

  // Los errores conservan el mensaje de la API: si falta un permiso, el motivo se ve
  // en pantalla en lugar de dejar el selector vacío sin explicación.
  private loadFormCatalogs(): void {
    this.ticketsService.getTechnicians().subscribe({
      next: (technicians) => { this.technicians = technicians; this.changeDetector.markForCheck(); },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudieron cargar los técnicos.');
        this.changeDetector.markForCheck();
      },
    });
  }

  // Sin técnicos de taller activos no hay a quién asignarle el ticket.
  get hasNoTechnicians(): boolean {
    return this.technicians.length === 0;
  }

  // Empleado elegido en el buscador: su ubicación llena Regional, Edificio y Departamento.
  selectEmployee(employee: EmployeeLookupResult): void {
    this.form.IdEmpleado = employee.IdEmpleado;
    this.selectedEmployee = {
      NombreCompleto: employee.NombreCompleto,
      NoPago: employee.NoPago ?? '',
      Regional: employee.NombreRegional,
      Edificio: employee.NombreEdificio,
      Departamento: employee.NombreArea,
    };
  }

  // Avisa en el formulario si al empleado elegido le falta el No. de pago, porque
  // entonces el técnico no podrá confirmar el cierre.
  get selectedEmployeeNeedsPayment(): boolean {
    return this.selectedEmployee?.NoPago !== null && this.selectedEmployee?.NoPago?.trim() === '';
  }

  openCreateWindow(): void {
    if (!this.isTicketManager) return;
    this.clearMessages();
    this.editingTicketId = null;
    this.form = emptyTicket();
    this.selectedEmployee = null;
    this.activeWindow = 'create';
  }

  // Al editar se muestra el empleado del ticket; con el buscador se puede cambiar por otro.
  openEditWindow(ticket: Ticket): void {
    if (!this.isTicketManager || !this.isOpen(ticket)) return;
    this.clearMessages();
    this.editingTicketId = ticket.IdTicket;
    this.form = {
      IdEmpleado: ticket.IdEmpleado,
      Detalle: ticket.Detalle,
      IdTecnico: ticket.IdTecnico,
      TipoSoporte: (ticket.TipoSoporte?.toUpperCase() as TicketSupportType | undefined) ?? '',
    };
    this.selectedEmployee = {
      NombreCompleto: ticket.Empleado,
      NoPago: null,
      Regional: ticket.Region,
      Edificio: ticket.Edificio,
      Departamento: ticket.Departamento,
    };
    this.activeWindow = 'create';
  }

  openReassignWindow(ticket: Ticket): void {
    if (!this.isTicketManager || !this.isOpen(ticket)) return;
    this.clearMessages();
    this.selectedTicket = ticket;
    this.reassignTechnicianId = ticket.IdTecnico;
    this.activeWindow = 'reassign';
  }

  openFinishWindow(ticket: Ticket): void {
    if (!this.isOpen(ticket)) return;
    this.clearMessages();
    this.selectedTicket = ticket;
    this.finish = emptyFinish();
    this.activeWindow = 'finish';
  }

  // Cuántos tickets entrarían en el reporte con los filtros actuales (vista previa en la ventana).
  get reportCount(): number {
    return filterTicketsForReport(this.tickets, this.reportFilters).length;
  }

  openReportWindow(): void {
    if (!this.isTicketManager) return;
    this.clearMessages();
    this.reportFilters = emptyTicketReportFilters();
    this.activeWindow = 'report';
  }

  // Vuelve a pedir los tickets para exportar datos al día, aplica los filtros y descarga el Excel.
  async exportReport(): Promise<void> {
    if (!this.isTicketManager) return;
    this.clearMessages();
    if (this.reportFilters.desde && this.reportFilters.hasta && this.reportFilters.desde > this.reportFilters.hasta) {
      this.errorMessage = 'La fecha "desde" no puede ser posterior a la fecha "hasta".';
      return;
    }
    this.isExporting = true;
    try {
      this.tickets = await firstValueFrom(this.ticketsService.getTickets());
      const tickets = filterTicketsForReport(this.tickets, this.reportFilters);
      const technician = this.technicians.find((item) => item.IdUsuario === this.reportFilters.idTecnico)?.Nombre ?? '';
      await exportTicketsReport(tickets, this.reportFilters, technician);
      this.closeWindow();
      this.message = `Reporte de tickets exportado: ${tickets.length} tickets.`;
    } catch (error) {
      this.errorMessage = error instanceof HttpErrorResponse
        ? apiErrorMessage(error, 'No se pudieron cargar los tickets para el reporte.')
        : 'No se pudo generar el archivo de Excel.';
    } finally {
      this.isExporting = false;
      this.changeDetector.markForCheck();
    }
  }

  closeWindow(): void {
    this.activeWindow = 'none';
    this.selectedTicket = null;
    this.editingTicketId = null;
  }

  saveTicket(): void {
    this.clearMessages();
    if (this.form.IdEmpleado <= 0 || !this.form.TipoSoporte || !this.form.Detalle.trim() || this.form.IdTecnico <= 0) {
      this.errorMessage = 'Selecciona el empleado y el tipo de soporte, describe la solicitud y asigna un técnico.';
      return;
    }

    const payload: CreateTicketRequest = {
      IdEmpleado: this.form.IdEmpleado,
      Detalle: this.form.Detalle.trim(),
      IdTecnico: this.form.IdTecnico,
      TipoSoporte: this.form.TipoSoporte,
    };
    const request = this.editingTicketId === null
      ? this.ticketsService.createTicket(payload)
      : this.ticketsService.updateTicket(this.editingTicketId, payload);

    this.isSaving = true;
    request.pipe(
      finalize(() => { this.isSaving = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => {
        this.message = this.editingTicketId === null ? 'Ticket creado.' : 'Ticket actualizado.';
        this.closeWindow();
        this.loadTickets();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudo guardar el ticket.');
        this.changeDetector.markForCheck();
      },
    });
  }

  saveReassignment(): void {
    this.clearMessages();
    if (!this.selectedTicket || this.reassignTechnicianId <= 0) {
      this.errorMessage = 'Selecciona el técnico que atenderá el ticket.';
      return;
    }

    this.isSaving = true;
    this.ticketsService.reassignTicket(this.selectedTicket.IdTicket, this.reassignTechnicianId).pipe(
      finalize(() => { this.isSaving = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => {
        this.message = 'Ticket reasignado.';
        this.closeWindow();
        this.loadTickets();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudo reasignar el ticket.');
        this.changeDetector.markForCheck();
      },
    });
  }

  // El No. de pago lo verifica el servidor contra EMPLEADOS_IHSS: si no coincide, el
  // ticket se queda abierto y se muestra el error.
  saveFinish(): void {
    this.clearMessages();
    if (!this.selectedTicket) return;
    if (!this.finish.NoPago.trim()) {
      this.errorMessage = 'Ingresa el No. de pago del empleado para confirmar el servicio.';
      return;
    }
    if (!this.finish.Valoracion) {
      this.errorMessage = 'Indica si la ayuda fue buena o mala.';
      return;
    }

    this.isSaving = true;
    this.ticketsService.finishTicket(this.selectedTicket.IdTicket, {
      NoPago: this.finish.NoPago.trim(),
      Observaciones: this.finish.Observaciones.trim(),
      Valoracion: this.finish.Valoracion,
    }).pipe(
      finalize(() => { this.isSaving = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => {
        this.message = 'Tarea finalizada.';
        this.closeWindow();
        this.loadTickets();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudo finalizar la tarea.');
        this.changeDetector.markForCheck();
      },
    });
  }

  refreshPanel(): void {
    this.clearMessages();
    this.loadTickets();
  }

  logout(): void {
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }

  private clearMessages(): void {
    this.message = '';
    this.errorMessage = '';
  }
}
