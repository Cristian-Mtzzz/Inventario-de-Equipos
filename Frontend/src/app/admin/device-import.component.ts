import { ChangeDetectorRef, Component, inject, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PagePipe, TablePageSizeComponent, TablePaginatorComponent } from '../shared/table-paginator';
import type ExcelJS from 'exceljs';
import { catchError, concat, concatMap, defer, finalize, from, map, Observable, of, tap, toArray } from 'rxjs';
import { apiErrorMessage } from '../shared/api-response';
import { AdminService } from './admin.service';
import { DeviceType } from './admin.models';
import { ComboComponentName, DESKTOP_TYPE_KEY, formatIngresoNumber, ImportItem, normalizeKey, parseDeviceImport } from './device-import.parser';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'].map((name, index) => ({ value: index + 1, name }));
const MIN_YEAR = 2000;

// needs-type: el tipo no existe en el catálogo y no se marcó para crearlo.
type ItemStatus = 'ready' | 'invalid' | 'needs-type' | 'saving' | 'saved' | 'failed';

interface ImportEntry {
  item: ImportItem;
  status: ItemStatus;
  // Errores del archivo, avisos o respuesta del servidor al guardar.
  messages: string[];
}

// Tipo escrito en el archivo que no existe en el catálogo.
interface NewTypeOption {
  key: string;
  name: string;
  count: number;
  create: boolean;
}

/**
 * Carga masiva de dispositivos desde Excel (.xlsx). Lee el archivo en el navegador,
 * reconoce el tipo de cada fila con el catálogo de tipos (los tipos nuevos se pueden
 * crear al importar), muestra una vista previa con los errores y registra solo los
 * elementos válidos con los mismos endpoints del formulario manual. Todos quedan
 * DISPONIBLES; empleado, fecha de asignación y área se asignan después.
 */
@Component({
  selector: 'app-device-import',
  imports: [FormsModule, PagePipe, TablePageSizeComponent, TablePaginatorComponent],
  templateUrl: './device-import.component.html',
  styleUrl: './device-import.component.css',
})
export class DeviceImportComponent {
  readonly closed = output<void>();
  // Se emite al cerrar si se registró al menos un equipo, para refrescar la tabla.
  readonly imported = output<void>();
  private readonly adminService = inject(AdminService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  private typesByKey = new Map<string, DeviceType>();
  isCatalogLoaded = false;
  fileName = '';
  // Mes y año en que ingresaron los equipos del archivo; forman su número de ingreso.
  readonly months = MONTHS;
  ingresoMonth: number | null = null;
  ingresoYear: number | null = new Date().getFullYear();
  entries: ImportEntry[] = [];
  // Página actual y tamaño de página de la tabla (paginación en el navegador).
  entryPage = 1;
  entryPageSize = 10;
  newTypes: NewTypeOption[] = [];
  fileErrors: string[] = [];
  errorMessage = '';
  isReading = false;
  isImporting = false;
  hasFinished = false;
  // Elementos listos al iniciar la importación (para mostrar el progreso).
  totalToImport = 0;

  constructor() {
    this.adminService.getDeviceTypes().subscribe({
      next: (types) => {
        this.setDeviceTypes(types);
        this.isCatalogLoaded = true;
        this.refreshStatuses();
        this.changeDetector.markForCheck();
      },
      error: () => {
        this.errorMessage = 'No se pudo cargar el catálogo de tipos de dispositivo.';
        this.changeDetector.markForCheck();
      },
    });
  }

  get readyCount(): number { return this.countBy('ready'); }
  get invalidCount(): number { return this.countBy('invalid'); }
  get needsTypeCount(): number { return this.countBy('needs-type'); }
  get savedCount(): number { return this.countBy('saved'); }
  get failedCount(): number { return this.countBy('failed'); }
  get processedCount(): number { return this.savedCount + this.failedCount; }
  get comboCount(): number { return this.entries.filter((entry) => entry.item.kind === 'combo').length; }
  get deviceCount(): number { return this.entries.length - this.comboCount; }

  get hasIngresoPeriod(): boolean {
    return this.ingresoMonth !== null && this.isValidYear(this.ingresoYear);
  }

  get canImport(): boolean {
    return this.readyCount > 0 && this.hasIngresoPeriod && this.isCatalogLoaded && !this.isImporting && !this.isReading;
  }

  // Número de ingreso NNNNN-MM-AAAA; mientras no se elija el periodo muestra el patrón.
  ingresoNumber(item: ImportItem): string {
    if (item.number === null) return '—';
    if (!this.hasIngresoPeriod) return `${String(item.number).padStart(5, '0')}-MM-AAAA`;
    return formatIngresoNumber(item.number, this.ingresoMonth!, this.ingresoYear!);
  }

  // Nombre del tipo como está en el catálogo (o como viene en el archivo si es nuevo).
  typeLabel(equipoKey: string, equipo: string): string {
    return this.typesByKey.get(equipoKey)?.NombreTipo ?? equipo;
  }

  toggleNewType(option: NewTypeOption, create: boolean): void {
    option.create = create;
    this.refreshStatuses();
  }

  async selectFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.resetPreview();
    this.fileName = file.name;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      this.fileErrors = ['Selecciona un archivo de Excel con formato .xlsx.'];
      return;
    }

    this.isReading = true;
    try {
      const result = parseDeviceImport(await this.readRows(file));
      this.fileErrors = result.fileErrors;
      this.entries = result.items.map((item) => ({ item, status: 'ready', messages: [] }));
      this.entryPage = 1;
      this.refreshStatuses();
    } catch {
      this.fileErrors = ['No se pudo leer el archivo. Verifica que sea un Excel válido y que no esté protegido.'];
    } finally {
      this.isReading = false;
      this.changeDetector.markForCheck();
    }
  }

  // Crea los tipos nuevos marcados y luego registra los elementos válidos uno por uno;
  // un fallo no detiene a los demás.
  importDevices(): void {
    if (!this.canImport) return;
    this.isImporting = true;
    this.errorMessage = '';
    this.totalToImport = this.readyCount;
    const failedTypes = new Map<string, string>();

    concat(
      this.createNewTypes(failedTypes),
      defer(() => from(this.entries.filter((entry) => entry.status === 'ready'))).pipe(
        concatMap((entry) => this.saveEntry(entry, failedTypes)),
      ),
    ).pipe(
      finalize(() => {
        this.isImporting = false;
        this.hasFinished = true;
        this.changeDetector.markForCheck();
      }),
    ).subscribe();
  }

  closeDialog(): void {
    if (this.isImporting) return;
    if (this.savedCount > 0) this.imported.emit();
    this.closed.emit();
  }

  private createNewTypes(failedTypes: Map<string, string>): Observable<unknown> {
    const toCreate = this.newTypes.filter((option) => option.create && !this.typesByKey.has(option.key));
    if (toCreate.length === 0) return of(null);

    return from(toCreate).pipe(
      concatMap((option) => this.adminService.createDeviceType({ TipoDispositivo: option.name }).pipe(
        catchError((error) => {
          failedTypes.set(option.key, apiErrorMessage(error, `No se pudo crear el tipo "${option.name}".`));
          return of(null);
        }),
      )),
      toArray(),
      // El servicio limpia la caché al crear tipos; se recarga el catálogo con sus nuevos ID.
      concatMap(() => this.adminService.getDeviceTypes()),
      tap((types) => this.setDeviceTypes(types)),
      catchError(() => {
        this.errorMessage = 'No se pudo recargar el catálogo de tipos después de crearlos.';
        return of(null);
      }),
    );
  }

  private saveEntry(entry: ImportEntry, failedTypes: Map<string, string>): Observable<unknown> {
    const typeKey = entry.item.kind === 'combo' ? DESKTOP_TYPE_KEY : entry.item.rows[0].equipoKey;
    const typeError = failedTypes.get(typeKey);
    const idTipo = this.typesByKey.get(typeKey)?.IdTipo;
    if (typeError || idTipo === undefined) {
      this.finishEntry(entry, typeError ?? 'El tipo de dispositivo no está disponible en el catálogo.');
      return of(null);
    }

    entry.status = 'saving';
    this.changeDetector.markForCheck();
    return this.save(entry.item, idTipo).pipe(
      map(() => ''),
      catchError((error) => of(apiErrorMessage(error, 'No se pudo registrar.'))),
      tap((error) => this.finishEntry(entry, error)),
    );
  }

  private finishEntry(entry: ImportEntry, error: string): void {
    entry.status = error ? 'failed' : 'saved';
    entry.messages = error ? [error] : [];
    this.changeDetector.markForCheck();
  }

  private save(item: ImportItem, idTipo: number): Observable<void> {
    if (item.kind === 'device') {
      const [row] = item.rows;
      return this.adminService.createDevice({
        CodigoInventario: row.inventario,
        NoSerie: row.serie,
        Marca: row.marca,
        Modelo: row.modelo,
        IdTipo: idTipo,
        Estado: 'DISPONIBLE',
        NumeroPagoAsignado: null,
        NombreAsignado: null,
        IdArea: null,
        NumeroIngreso: this.ingresoNumber(item),
      });
    }

    // El backend guarda el número del combo también como número de ingreso de cada componente.
    return this.adminService.createDesktopCombo({
      NCombo: this.ingresoNumber(item),
      IdTipo: idTipo,
      Estado: 'DISPONIBLE',
      NumeroPagoAsignado: null,
      NombreAsignado: null,
      IdArea: null,
      Componentes: item.rows.map((row) => ({
        Componente: row.equipoKey as ComboComponentName,
        CodigoInventario: row.inventario,
        NoSerie: row.serie,
        Marca: row.marca,
        Modelo: row.modelo,
      })),
    });
  }

  // Recalcula el estado de cada elemento según sus errores y el catálogo de tipos.
  private refreshStatuses(): void {
    if (!this.isCatalogLoaded) return;
    this.updateNewTypes();
    const createKeys = new Set(this.newTypes.filter((option) => option.create).map((option) => option.key));

    for (const entry of this.entries) {
      if (entry.status === 'saved' || entry.status === 'failed') continue;
      const { item } = entry;
      if (item.errors.length > 0) {
        entry.status = 'invalid';
        entry.messages = [...item.errors];
        continue;
      }

      if (item.kind === 'combo') {
        const hasDesktopType = this.typesByKey.has(DESKTOP_TYPE_KEY);
        entry.status = hasDesktopType ? 'ready' : 'invalid';
        entry.messages = hasDesktopType ? [] : ['No existe el tipo "COMPUTADORA ESCRITORIO" en el catálogo.'];
        continue;
      }

      const [row] = item.rows;
      if (this.typesByKey.has(row.equipoKey)) {
        entry.status = 'ready';
        entry.messages = [];
      } else if (createKeys.has(row.equipoKey)) {
        entry.status = 'ready';
        entry.messages = [`Se creará el tipo "${row.equipo}".`];
      } else {
        entry.status = 'needs-type';
        entry.messages = [`El tipo "${row.equipo}" no existe en el catálogo.`];
      }
    }
  }

  // Lista los tipos del archivo que no existen en el catálogo, conservando la selección.
  private updateNewTypes(): void {
    const previous = new Map(this.newTypes.map((option) => [option.key, option.create]));
    const options = new Map<string, NewTypeOption>();
    for (const { item } of this.entries) {
      const [row] = item.rows;
      if (item.kind !== 'device' || item.errors.length > 0 || this.typesByKey.has(row.equipoKey)) continue;
      const option = options.get(row.equipoKey)
        ?? { key: row.equipoKey, name: row.equipo, count: 0, create: previous.get(row.equipoKey) ?? false };
      option.count++;
      options.set(row.equipoKey, option);
    }
    this.newTypes = [...options.values()].sort((first, second) => first.name.localeCompare(second.name));
  }

  private setDeviceTypes(types: DeviceType[]): void {
    this.typesByKey = new Map(types.map((type) => [normalizeKey(type.NombreTipo), type]));
  }

  private isValidYear(year: number | null): boolean {
    return year !== null && Number.isInteger(year) && year >= MIN_YEAR && year <= new Date().getFullYear() + 1;
  }

  private countBy(status: ItemStatus): number {
    return this.entries.filter((entry) => entry.status === status).length;
  }

  private resetPreview(): void {
    this.entries = [];
    this.newTypes = [];
    this.fileErrors = [];
    this.errorMessage = '';
    this.hasFinished = false;
  }

  // Convierte la primera hoja con datos en filas de texto; las celdas combinadas
  // devuelven el valor de la celda principal y las fórmulas su resultado. Los números
  // se leen sin formato para que un inventario no aparezca como "4,126,458".
  private async readRows(file: File): Promise<string[][]> {
    const { default: ExcelJSModule } = await import('exceljs');
    const workbook = new ExcelJSModule.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets.find((worksheet) => worksheet.actualRowCount > 0);
    if (!sheet) return [];

    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row: ExcelJS.Row, rowNumber: number) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell: ExcelJS.Cell, columnNumber: number) => {
        const value = cell.value;
        const result = value && typeof value === 'object' && 'result' in value ? value.result : value;
        values[columnNumber - 1] = (typeof result === 'number' ? String(result) : cell.text ?? '').trim();
      });
      rows[rowNumber - 1] = Array.from(values, (value) => value ?? '');
    });
    return Array.from(rows, (row) => row ?? []);
  }
}
