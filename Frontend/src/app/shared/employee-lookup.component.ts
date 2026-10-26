import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, catchError, debounceTime, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import { apiUrl } from '../api-url';
import { toPascalCase } from './api-response';

// Empleado elegido en el buscador, con su ubicación para completar Regional, Edificio y Departamento.
export interface EmployeeLookupResult {
  IdEmpleado: number;
  EmployeeKey: string;
  NoPago: string;
  NombreCompleto: string;
  IdArea: number | null;
  NombreArea: string | null;
  IdEdificio: number | null;
  NombreEdificio: string | null;
  IdRegional: number | null;
  NombreRegional: string | null;
}

// Posición del empleado elegido dentro de la lista de empleados de su departamento (para dejarlo
// seleccionado en el combo): primero por No. de pago y, si no tiene, por nombre. -1 si no está.
export function findEmployeeIndex(
  options: readonly { NoPago: string | null; NombreCompleto: string }[],
  employee: { NoPago: string | null; NombreCompleto: string },
): number {
  const pago = (employee.NoPago ?? '').trim();
  const name = employee.NombreCompleto.trim().toUpperCase();
  const byPayment = pago ? options.findIndex((option) => (option.NoPago ?? '').trim() === pago) : -1;
  return byPayment >= 0 ? byPayment : options.findIndex((option) => option.NombreCompleto.trim().toUpperCase() === name);
}

const LOOKUP_URL = apiUrl('admin/employees/lookup');

/**
 * Botón "Buscar empleado" con su ventana de búsqueda, igual al buscador de Mantenimiento:
 * se escribe el nombre (o el No. de pago), se elige el empleado y el formulario recibe su
 * ubicación por el evento `selected` para completar Regional, Edificio y Departamento.
 * Uso: `<app-employee-lookup (selected)="usarEmpleado($event)" />`
 */
@Component({
  selector: 'app-employee-lookup',
  imports: [FormsModule],
  template: `
    <!-- "secondary": los temas del panel pintan de color sólido todo botón de formulario que no la tenga. -->
    <button type="button" class="secondary employee-lookup-trigger" [disabled]="disabled()" (click)="open()">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="10.8" cy="10.8" r="6.8"></circle>
        <path d="m16 16 5 5"></path>
      </svg>
      <span>{{ label() }}</span>
    </button>

    @if (isOpen()) {
    <div class="employee-lookup-backdrop" role="presentation" (click)="close()">
      <section class="employee-lookup-modal" role="dialog" aria-modal="true" aria-labelledby="employee-lookup-title"
        (click)="$event.stopPropagation()">
        <div class="employee-lookup-heading">
          <div>
            <p class="employee-lookup-eyebrow">DIRECTORIO DE EMPLEADOS</p>
            <h2 id="employee-lookup-title">Buscar empleado</h2>
          </div>
          <button type="button" class="secondary employee-lookup-close" aria-label="Cerrar búsqueda" (click)="close()">×</button>
        </div>

        <label class="employee-lookup-label" for="employee-lookup-term">Nombre o No. de pago</label>
        <input #searchInput id="employee-lookup-term" type="text" inputmode="search" autocomplete="off"
          [ngModel]="term()" (ngModelChange)="search($event)" name="employeeLookupTerm" />

        @if (errorMessage()) {
        <p class="employee-lookup-error" role="alert">{{ errorMessage() }}</p>
        } @else if (term().trim().length < 2) {
        <p class="employee-lookup-hint">Escribe al menos 2 caracteres para buscar.</p>
        } @else if (isLoading()) {
        <p class="employee-lookup-hint">Buscando...</p>
        } @else if (results().length === 0) {
        <p class="employee-lookup-hint">No se encontraron coincidencias.</p>
        } @else {
        <div class="employee-lookup-results" role="list" aria-label="Resultados de empleados">
          @for (employee of results(); track employee.EmployeeKey) {
          <button type="button" class="secondary employee-lookup-result" role="listitem" (click)="choose(employee)">
            <span class="employee-lookup-result-name">{{ employee.NombreCompleto }}</span>
            <span class="employee-lookup-result-meta">Número de pago: {{ employee.NoPago || 'No registrado' }}</span>
            <span class="employee-lookup-result-meta">
              {{ employee.NombreRegional || 'Sin regional' }} · {{ employee.NombreEdificio || 'Sin edificio' }} ·
              {{ employee.NombreArea || 'Sin departamento' }}
            </span>
          </button>
          }
        </div>
        }
      </section>
    </div>
    }
  `,
  styles: `
    :host { display: block; }
    .employee-lookup-trigger {
      display: inline-flex; align-items: center; justify-content: center; gap: .55rem;
      width: 100%; min-height: 2.6rem; padding: .55rem .9rem;
      border: 1px solid #aac9c1; border-radius: var(--ui-radius, 8px);
      color: #276968; background: #fff; cursor: pointer; font: inherit; font-weight: 700;
    }
    .employee-lookup-trigger:hover:not(:disabled) { border-color: #276968; background: #eef6f3; }
    .employee-lookup-trigger:disabled { opacity: .6; cursor: not-allowed; }
    .employee-lookup-trigger svg, .employee-lookup-heading svg {
      width: 1.15rem; height: 1.15rem; fill: none; stroke: currentColor; stroke-linecap: round; stroke-width: 1.8;
    }
    .employee-lookup-backdrop {
      position: fixed; z-index: 140; inset: 0; display: grid; place-items: center; padding: 1rem;
      background: rgba(15, 37, 40, .45);
    }
    .employee-lookup-modal {
      display: grid; gap: .6rem; width: min(620px, 100%); max-height: calc(100dvh - 2rem); overflow: auto;
      padding: 1.25rem 1.5rem; border-radius: 12px; background: #fff; box-shadow: 0 24px 60px rgba(15, 37, 40, .28);
      text-align: left;
    }
    .employee-lookup-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
    .employee-lookup-heading h2 { margin: .15rem 0 0; color: #173f43; font-size: 1.25rem; }
    .employee-lookup-eyebrow { margin: 0; color: #397b78; font-size: .7rem; font-weight: 800; letter-spacing: .14em; }
    .employee-lookup-close {
      box-shadow: none !important;
      border: 0; color: #294649; background: transparent; cursor: pointer; font-size: 1.6rem; line-height: 1;
    }
    .employee-lookup-label { color: #294649; font-size: .76rem; font-weight: 700; }
    .employee-lookup-modal input {
      width: 100%; min-height: 2.65rem; padding: .5rem .75rem; border: 1px solid #d3dfdb;
      border-radius: var(--ui-radius, 8px); font: inherit;
    }
    .employee-lookup-modal input:focus { outline: none; border-color: #397b78; box-shadow: 0 0 0 3px rgba(57, 123, 120, .14); }
    .employee-lookup-hint, .employee-lookup-error {
      margin: 0; padding: .75rem; border-radius: 4px; font-size: .85rem;
    }
    .employee-lookup-hint { color: #617573; background: #f2f7f5; }
    .employee-lookup-error { color: #a8442f; background: #fcebe7; }
    .employee-lookup-results { display: grid; gap: .4rem; max-height: min(52vh, 24rem); overflow-y: auto; }
    .employee-lookup-result {
      display: grid; gap: .3rem; width: 100%; padding: .75rem; border: 1px solid #dfe9e5; border-radius: 4px;
      color: #203238; background: #fff; cursor: pointer; text-align: left; font: inherit;
    }
    .employee-lookup-result:hover, .employee-lookup-result:focus-visible { border-color: #276968; background: #f2f7f5; }
    .employee-lookup-result-name { font-size: .9rem; font-weight: 800; }
    .employee-lookup-result-meta { color: #617573; font-size: .76rem; }
  `,
})
export class EmployeeLookupComponent {
  private readonly httpClient = inject(HttpClient);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly terms = new Subject<string>();

  readonly label = input('Buscar empleado');
  readonly disabled = input(false);
  readonly selected = output<EmployeeLookupResult>();

  readonly isOpen = signal(false);
  readonly term = signal('');
  readonly results = signal<EmployeeLookupResult[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal('');

  constructor() {
    // Busca en el servidor 300 ms después de la última tecla; una búsqueda nueva cancela la anterior.
    this.terms.pipe(
      map((value) => value.trim()),
      debounceTime(300),
      distinctUntilChanged(),
      tap((value) => { this.errorMessage.set(''); this.isLoading.set(value.length >= 2); }),
      switchMap((value) => value.length < 2
        ? of([] as EmployeeLookupResult[])
        : this.httpClient.get<unknown>(LOOKUP_URL, { params: new HttpParams().set('searchTerm', value) }).pipe(
          map((body) => toPascalCase<EmployeeLookupResult[]>(body)),
          catchError(() => {
            this.errorMessage.set('No se pudo buscar al empleado.');
            return of([] as EmployeeLookupResult[]);
          }),
        )),
      takeUntilDestroyed(inject(DestroyRef)),
    ).subscribe((results) => {
      this.results.set(results);
      this.isLoading.set(false);
    });
  }

  open(): void {
    this.term.set('');
    this.results.set([]);
    this.errorMessage.set('');
    this.terms.next('');
    this.isOpen.set(true);
    setTimeout(() => this.searchInput()?.nativeElement.focus());
  }

  close(): void {
    this.isOpen.set(false);
  }

  search(value: string): void {
    this.term.set(value);
    this.terms.next(value);
  }

  choose(employee: EmployeeLookupResult): void {
    this.selected.emit(employee);
    this.close();
  }
}
