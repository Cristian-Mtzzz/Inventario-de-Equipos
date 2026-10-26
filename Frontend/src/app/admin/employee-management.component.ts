import { ChangeDetectorRef, Component, Input, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { DigitsOnlyDirective } from '../shared/digits-only.directive';
import { PagePipe, TablePageSizeComponent, TablePaginatorComponent } from '../shared/table-paginator';
import { apiErrorMessage } from '../shared/api-response';
import { AdminService } from './admin.service';
import { EmployeeRosterRow } from './admin.models';

@Component({
  selector: 'app-employee-management',
  imports: [FormsModule, DigitsOnlyDirective, PagePipe, TablePageSizeComponent, TablePaginatorComponent],
  templateUrl: './employee-management.component.html',
  // Reutiliza los estilos del panel para que la sección se vea igual que las demás.
  styleUrls: ['./admin.component.css', './employee-management.component.css'],
})
// Sección Empleados: lista el directorio ordenado por región, edificio y departamento,
// y permite completar el No. de pago, que en la mayoría de los registros está vacío.
export class EmployeeManagementComponent {
  private readonly adminService = inject(AdminService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  private isActive = false;
  // Al entrar se limpian los mensajes y se reintenta la carga si la primera falló.
  @Input() set active(value: boolean) {
    if (value && !this.isActive) {
      this.clearMessages();
      if (!this.employeesLoaded) this.reload();
    }
    this.isActive = value;
  }
  get active(): boolean { return this.isActive; }

  employees: EmployeeRosterRow[] = [];
  employeePage = 1;
  employeePageSize = 10;
  searchTerm = '';
  isLoading = false;
  message = '';
  errorMessage = '';
  private employeesLoaded = false;

  // No. de pago que se está escribiendo en cada fila, por clave de empleado. Mientras la
  // fila esté aquí el input muestra lo tecleado y no el valor guardado.
  private readonly drafts = new Map<string, string>();
  // Fila que se está guardando; bloquea su input para no mandar dos veces lo mismo.
  savingKey: string | null = null;

  constructor() {
    this.reload();
  }

  get filteredEmployees(): EmployeeRosterRow[] {
    const term = this.searchTerm.trim().toUpperCase();
    if (!term) return this.employees;
    return this.employees.filter((employee) =>
      employee.NombreCompleto.toUpperCase().includes(term)
      || (employee.NoPago ?? '').toUpperCase().includes(term)
      || (employee.Departamento ?? '').toUpperCase().includes(term)
      || (employee.Edificio ?? '').toUpperCase().includes(term)
      || (employee.Region ?? '').toUpperCase().includes(term));
  }

  display(value: string | null): string {
    return value?.trim() ? value : '-';
  }

  // Lo tecleado si la fila se está editando; si no, el valor guardado.
  paymentValue(employee: EmployeeRosterRow): string {
    return this.drafts.get(employee.EmployeeKey) ?? employee.NoPago ?? '';
  }

  // Se limpia aquí además de la directiva: si se pega texto, el borrador no debe
  // quedarse con lo que el input ya descartó.
  onPaymentInput(employee: EmployeeRosterRow, value: string): void {
    this.drafts.set(employee.EmployeeKey, value.replace(/\D/g, '').slice(0, 5));
    this.clearMessages();
  }

  updateSearch(term: string): void {
    this.searchTerm = term;
    this.employeePage = 1;
  }

  reload(): void {
    this.isLoading = true;
    this.clearMessages();
    this.adminService.getEmployeeRoster().pipe(
      finalize(() => { this.isLoading = false; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: (employees) => {
        this.employees = employees;
        this.employeesLoaded = true;
        this.drafts.clear();
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudieron cargar los empleados.');
        this.changeDetector.markForCheck();
      },
    });
  }

  // Enter guarda el No. de pago de esa fila. Dejarlo vacío borra el que tuviera.
  savePaymentNumber(employee: EmployeeRosterRow): void {
    if (this.savingKey) return;
    const typed = this.paymentValue(employee).trim();
    const current = employee.NoPago?.trim() ?? '';
    if (typed === current) {
      this.drafts.delete(employee.EmployeeKey);
      return;
    }

    this.savingKey = employee.EmployeeKey;
    this.clearMessages();
    this.adminService.setEmployeePaymentNumber(employee.EmployeeKey, typed || null).pipe(
      finalize(() => { this.savingKey = null; this.changeDetector.markForCheck(); })
    ).subscribe({
      next: () => {
        employee.NoPago = typed || null;
        this.drafts.delete(employee.EmployeeKey);
        this.message = typed
          ? `No. de pago ${typed} asignado a ${employee.NombreCompleto}.`
          : `Se quitó el No. de pago de ${employee.NombreCompleto}.`;
        this.changeDetector.markForCheck();
      },
      // El borrador se conserva para que se pueda corregir sin volver a teclearlo.
      error: (error) => {
        this.errorMessage = apiErrorMessage(error, 'No se pudo guardar el No. de pago.');
        this.changeDetector.markForCheck();
      },
    });
  }

  // Salir del input sin presionar Enter descarta lo escrito y deja el valor guardado.
  discardDraft(employee: EmployeeRosterRow): void {
    this.drafts.delete(employee.EmployeeKey);
  }

  private clearMessages(): void {
    this.message = '';
    this.errorMessage = '';
  }
}
