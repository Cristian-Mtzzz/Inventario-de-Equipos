import { ChangeDetectorRef, Component, inject, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, forkJoin, Observable } from 'rxjs';
import { SearchableSelectDirective } from '../shared/searchable-select.directive';
import { AdminService } from './admin.service';
import { Building, CatalogDepartment, DirectoryEmployee, RegionalOption } from './admin.models';

type CatalogView = 'regionals' | 'buildings' | 'departments' | 'employees';
type CatalogPanel = 'locations' | 'regionals';
type DeleteRequest = { view: CatalogView; key: number | string; label: string };

@Component({
  selector: 'app-catalog-management',
  imports: [FormsModule, SearchableSelectDirective],
  templateUrl: './catalog-management.component.html',
  styleUrl: './catalog-management.component.css',
})
export class CatalogManagementComponent {
  readonly changed = output<void>();
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly views: { id: CatalogView; label: string }[] = [
    { id: 'regionals', label: 'Regionales' },
    { id: 'buildings', label: 'Edificios' },
    { id: 'departments', label: 'Departamentos' },
    { id: 'employees', label: 'Empleados' },
  ];
  activePanel: CatalogPanel = 'locations';
  activeView: CatalogView = 'regionals';
  pageSize = 50;
  currentPage = 1;
  searchTerm = '';
  readonly pageSizeOptions = [10, 25, 50, 100];
  sortColumn = '';
  sortDirection: 'asc' | 'desc' = 'asc';
  regionals: RegionalOption[] = [];
  buildings: Building[] = [];
  departments: CatalogDepartment[] = [];
  employees: DirectoryEmployee[] = [];
  isLoading = false;
  isSaving = false;
  isDialogOpen = false;
  isLocationContextLocked = false;
  isDeleteDialogOpen = false;
  isEmployeeSearchOpen = false;
  editingId: number | null = null;
  editingEmployeeKey = '';
  pendingDelete: DeleteRequest | null = null;
  catalogRegionalId: number | null = null;
  catalogBuildingId: number | null = null;
  catalogAreaId: number | null = null;
  catalogEmployeeKey = '';
  selectedRegionId: number | null = null;
  selectedBuildingId: number | null = null;
  selectedAreaId: number | null = null;
  regionalName = '';
  buildingName = '';
  departmentName = '';
  employeeName = '';
  employeeNoPago = '';
  employeeSearchTerm = '';
  employeeSearchError = '';
  message = '';
  errorMessage = '';

  constructor(private readonly adminService: AdminService) {
    this.loadCatalogs();
  }

  get buildingsForSelectedRegional(): Building[] {
    if (this.catalogRegionalId === null) return [];
    const buildings = this.buildings.filter((building) => building.IdRegional === this.catalogRegionalId);
    return this.filterRows(buildings, (row) => [row.IdEdificio, row.NombreEdificio]);
  }

  get departmentsForSelectedBuilding(): CatalogDepartment[] {
    if (this.catalogBuildingId === null) return [];
    const departments = this.departments.filter((department) => department.IdEdificio === this.catalogBuildingId);
    return this.filterRows(departments, (row) => [row.IdArea, row.NombreArea]);
  }

  get employeesForSelectedDepartment(): DirectoryEmployee[] {
    if (this.catalogAreaId === null) return [];
    const employees = this.employeeRows.filter((employee) => employee.IdArea === this.catalogAreaId);
    return this.filterRows(employees, (row) => [row.NoPago, row.NombreCompleto]);
  }

  get searchedDirectoryEmployees(): DirectoryEmployee[] {
    const normalizedSearch = this.normalizeSearch(this.employeeSearchTerm);
    if (normalizedSearch.length < 2) return [];
    const searchTerms = normalizedSearch.split(/\s+/).filter(Boolean);
    return this.employeeRows
      .filter((employee) => {
        const searchableText = this.normalizeSearch(`${employee.NombreCompleto} ${employee.NoPago}`);
        return searchTerms.every((term) => searchableText.includes(term));
      })
      .slice(0, 50);
  }

  get selectedRegional(): RegionalOption | null {
    return this.regionals.find((regional) => regional.IdRegional === this.catalogRegionalId) ?? null;
  }

  get selectedCatalogDepartment(): CatalogDepartment | null {
    return this.departments.find((department) => department.IdArea === this.catalogAreaId) ?? null;
  }

  get selectedCatalogBuilding(): Building | null {
    return this.buildings.find((building) => building.IdEdificio === this.catalogBuildingId) ?? null;
  }

  get selectedCatalogEmployee(): DirectoryEmployee | null {
    return this.employeesForSelectedDepartment.find((employee) => employee.EmployeeKey === this.catalogEmployeeKey) ?? null;
  }

  get filteredBuildings(): Building[] {
    return this.selectedRegionId === null
      ? this.buildings
      : this.buildings.filter((building) => building.IdRegional === this.selectedRegionId);
  }

  get filteredDepartments(): CatalogDepartment[] {
    return this.selectedBuildingId === null
      ? []
      : this.departments.filter((department) => department.IdEdificio === this.selectedBuildingId);
  }

  get selectedBuildingName(): string {
    return this.buildings.find((building) => building.IdEdificio === this.selectedBuildingId)?.NombreEdificio
      ?? 'Selecciona un edificio';
  }

  get selectedRegionName(): string {
    return this.regionals.find((regional) => regional.IdRegional === this.selectedRegionId)?.NombreRegional ?? '-';
  }

  get selectedAreaName(): string {
    return this.departments.find((department) => department.IdArea === this.selectedAreaId)?.NombreArea ?? '-';
  }

  get employeeRows(): DirectoryEmployee[] {
    return [...this.employees].sort((first, second) => first.NombreCompleto.localeCompare(second.NombreCompleto));
  }

  get catalogRegionals(): RegionalOption[] {
    return this.filterRows(this.regionals, (row) => [row.IdRegional, row.NombreRegional]);
  }

  get catalogBuildings(): Building[] {
    return this.filterRows(this.buildings, (row) => [row.IdEdificio, row.NombreEdificio, row.NombreRegional]);
  }

  get catalogDepartments(): CatalogDepartment[] {
    return this.filterRows(this.departments, (row) => [row.IdArea, row.NombreArea, row.NombreEdificio, row.NombreRegional]);
  }

  get catalogEmployees(): DirectoryEmployee[] {
    return this.filterRows(this.employeeRows, (row) => [row.NoPago, row.NombreCompleto,
      this.employeeRegionalName(row), this.employeeBuildingName(row), this.employeeDepartmentName(row)]);
  }

  get visibleRegionals(): RegionalOption[] { return this.pageRows(this.catalogRegionals); }
  get visibleBuildings(): Building[] { return this.pageRows(this.catalogBuildings); }
  get visibleDepartments(): CatalogDepartment[] { return this.pageRows(this.catalogDepartments); }
  get visibleEmployees(): DirectoryEmployee[] { return this.pageRows(this.catalogEmployees); }

  get filteredCount(): number {
    return this.catalogRegionals.length;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredCount / this.pageSize));
  }

  get firstVisibleRow(): number {
    return this.filteredCount === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1;
  }

  get lastVisibleRow(): number {
    return Math.min(this.currentPage * this.pageSize, this.filteredCount);
  }

  get visiblePages(): number[] {
    const firstPage = Math.max(1, this.currentPage - 2);
    const lastPage = Math.min(this.totalPages, firstPage + 4);
    return Array.from({ length: lastPage - firstPage + 1 }, (_, index) => firstPage + index);
  }

  //metodo para cargar los catalogos de regionals, buildings, departments y empleados 
  loadCatalogs(): void {
    this.isLoading = true;
    this.errorMessage = '';
    forkJoin({
      regionals: this.adminService.getRegionals(),
      buildings: this.adminService.getBuildings(),
      departments: this.adminService.getCatalogDepartments(),
      employees: this.adminService.getDirectoryEmployees(),
    }).pipe(finalize(() => {
      this.isLoading = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: (catalogs) => {
        this.regionals = catalogs.regionals;
        this.buildings = catalogs.buildings;
        this.departments = catalogs.departments;
        this.employees = catalogs.employees;
        this.syncCatalogSelection();
        this.currentPage = Math.min(this.currentPage, this.totalPages);
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.errorMessage = this.getErrorMessage(error, 'No se pudieron cargar los catálogos.');
        this.changeDetector.markForCheck();
      },
    });
  }

  //metodo para seleccionar la vista del catalogo 
  selectView(view: CatalogView): void {
    this.activeView = view;
    this.currentPage = 1;
    this.searchTerm = '';
    this.sortColumn = '';
    this.sortDirection = 'asc';
    this.closeDialog();
    this.message = '';
    this.errorMessage = '';
  }

  selectPanel(panel: CatalogPanel): void {
    this.activePanel = panel;
    this.currentPage = 1;
    this.searchTerm = '';
    this.sortColumn = '';
    this.sortDirection = 'asc';
    this.closeDialog();
    this.message = '';
    this.errorMessage = '';
  }

  //actualiza la busqueda 
  updateSearch(value: string): void {
    this.searchTerm = value;
    this.currentPage = 1;
  }

  updatePageSize(value: number): void {
    this.pageSize = Number(value);
    this.currentPage = 1;
  }

  goToPage(page: number): void {
    this.currentPage = Math.min(Math.max(page, 1), this.totalPages);
  }

  sortBy(column: string): void {
    this.sortDirection = this.sortColumn === column && this.sortDirection === 'asc' ? 'desc' : 'asc';
    this.sortColumn = column;
    this.currentPage = 1;
  }

  sortIndicator(column: string): string {
    return this.sortColumn !== column ? '↕' : this.sortDirection === 'asc' ? '▲' : '▼';
  }

  openCreate(): void {
    this.resetForm();
    this.isDialogOpen = true;
  }

  openCreateFor(view: CatalogView): void {
    this.activeView = view;
    this.openCreate();
    this.selectedRegionId = this.catalogRegionalId;
    this.selectedBuildingId = this.catalogBuildingId;
    this.selectedAreaId = this.catalogAreaId;
    this.isLocationContextLocked = true;
  }

  editRegional(regional: RegionalOption): void {
    this.activeView = 'regionals';
    this.resetForm();
    this.editingId = regional.IdRegional;
    this.regionalName = regional.NombreRegional;
    this.isDialogOpen = true;
  }

  editBuilding(building: Building): void {
    this.activeView = 'buildings';
    this.resetForm();
    this.editingId = building.IdEdificio;
    this.buildingName = building.NombreEdificio;
    this.selectedRegionId = building.IdRegional;
    this.isDialogOpen = true;
  }

  editDepartment(department: CatalogDepartment): void {
    this.activeView = 'departments';
    this.resetForm();
    this.editingId = department.IdArea;
    this.departmentName = department.NombreArea;
    this.selectedRegionId = department.IdRegional;
    this.selectedBuildingId = department.IdEdificio;
    this.isDialogOpen = true;
  }

  editEmployee(employee: DirectoryEmployee): void {
    this.activeView = 'employees';
    this.resetForm();
    this.editingEmployeeKey = employee.EmployeeKey;
    this.employeeNoPago = employee.NoPago;
    this.employeeName = employee.NombreCompleto;
    this.selectedAreaId = employee.IdArea;
    const department = this.departments.find((item) => item.IdArea === employee.IdArea);
    if (department) {
      this.selectedBuildingId = department.IdEdificio;
      this.selectedRegionId = department.IdRegional;
    }
    this.isDialogOpen = true;
  }

  selectRegion(idRegional: number | null): void {
    this.selectedRegionId = idRegional;
    this.selectedBuildingId = null;
    this.selectedAreaId = null;
  }

  selectBuilding(idEdificio: number | null): void {
    this.selectedBuildingId = idEdificio;
    this.selectedAreaId = null;
  }

  selectCatalogRegional(idRegional: number | null): void {
    this.catalogRegionalId = idRegional;
    this.catalogBuildingId = null;
    this.catalogAreaId = null;
    this.catalogEmployeeKey = '';
    this.searchTerm = '';
  }

  selectCatalogBuilding(idEdificio: number): void {
    this.catalogBuildingId = Number(idEdificio) || null;
    this.catalogAreaId = null;
    this.catalogEmployeeKey = '';
    this.searchTerm = '';
  }

  selectCatalogDepartment(idArea: number): void {
    this.catalogAreaId = Number(idArea) || null;
    this.catalogEmployeeKey = '';
    this.searchTerm = '';
  }

  selectCatalogEmployee(employeeKey: string): void {
    this.catalogEmployeeKey = employeeKey;
    this.searchTerm = '';
  }

  openEmployeeSearch(): void {
    this.employeeSearchTerm = '';
    this.employeeSearchError = '';
    this.isEmployeeSearchOpen = true;
  }

  closeEmployeeSearch(): void {
    this.isEmployeeSearchOpen = false;
    this.employeeSearchError = '';
  }

  updateEmployeeSearch(value: string): void {
    this.employeeSearchTerm = value;
    this.employeeSearchError = '';
  }

  selectSearchedEmployee(employee: DirectoryEmployee): void {
    const department = this.departments.find((item) => item.IdArea === employee.IdArea);
    if (!department) {
      this.employeeSearchError = 'El empleado no tiene un departamento válido para completar su ubicación.';
      return;
    }

    this.catalogRegionalId = department.IdRegional;
    this.catalogBuildingId = department.IdEdificio;
    this.catalogAreaId = department.IdArea;
    this.catalogEmployeeKey = employee.EmployeeKey;
    this.activePanel = 'locations';
    this.closeEmployeeSearch();
  }

  editSelectedRegional(): void {
    if (this.selectedRegional) this.editRegional(this.selectedRegional);
  }

  deleteSelectedRegional(): void {
    if (this.selectedRegional) {
      this.askDelete('regionals', this.selectedRegional.IdRegional, this.selectedRegional.NombreRegional);
    }
  }

  editSelectedBuilding(): void {
    if (this.selectedCatalogBuilding) this.editBuilding(this.selectedCatalogBuilding);
  }

  deleteSelectedBuilding(): void {
    if (this.selectedCatalogBuilding) {
      this.askDelete('buildings', this.selectedCatalogBuilding.IdEdificio, this.selectedCatalogBuilding.NombreEdificio);
    }
  }

  editSelectedDepartment(): void {
    if (this.selectedCatalogDepartment) this.editDepartment(this.selectedCatalogDepartment);
  }

  deleteSelectedDepartment(): void {
    if (this.selectedCatalogDepartment) {
      this.askDelete('departments', this.selectedCatalogDepartment.IdArea, this.selectedCatalogDepartment.NombreArea);
    }
  }

  editSelectedEmployee(): void {
    if (this.selectedCatalogEmployee) this.editEmployee(this.selectedCatalogEmployee);
  }

  deleteSelectedEmployee(): void {
    if (this.selectedCatalogEmployee) {
      this.askDelete('employees', this.selectedCatalogEmployee.EmployeeKey, this.selectedCatalogEmployee.NombreCompleto);
    }
  }

  closeDialog(): void {
    this.isDialogOpen = false;
    this.resetForm();
  }

  save(): void {
    this.errorMessage = '';
    let request: Observable<void>;
    if (this.activeView === 'regionals') {
      if (!this.regionalName.trim()) return this.requireFields('Escribe el nombre de la regional.');
      const regional = { NombreRegional: this.regionalName.trim() };
      request = this.editingId === null
        ? this.adminService.createRegional(regional)
        : this.adminService.updateRegional(this.editingId, regional);
    } else if (this.activeView === 'buildings') {
      if (!this.buildingName.trim() || this.selectedRegionId === null) return this.requireFields('Completa el nombre y la regional del edificio.');
      const building = { NombreEdificio: this.buildingName.trim(), IdRegional: this.selectedRegionId };
      request = this.editingId === null
        ? this.adminService.createBuilding(building)
        : this.adminService.updateBuilding(this.editingId, building);
    } else if (this.activeView === 'departments') {
      if (!this.departmentName.trim() || this.selectedBuildingId === null) return this.requireFields('Completa el nombre y el edificio del departamento.');
      const department = { NombreArea: this.departmentName.trim(), IdEdificio: this.selectedBuildingId };
      request = this.editingId === null
        ? this.adminService.createDepartment(department)
        : this.adminService.updateDepartment(this.editingId, department);
    } else {
      if (!this.employeeNoPago.trim() || !this.employeeName.trim() || this.selectedAreaId === null) {
        return this.requireFields('Completa número de pago, nombre y departamento del empleado.');
      }
      const employee = {
        NoPago: this.employeeNoPago.trim(),
        NombreCompleto: this.employeeName.trim(),
        IdArea: this.selectedAreaId,
      };
      request = this.editingEmployeeKey
        ? this.adminService.updateDirectoryEmployeeByKey(this.editingEmployeeKey, employee)
        : this.adminService.createDirectoryEmployee(employee);
    }

    this.isSaving = true;
    request.pipe(finalize(() => this.isSaving = false)).subscribe({
      next: () => {
        this.message = this.editingId === null && !this.editingEmployeeKey
          ? 'Registro agregado correctamente.'
          : 'Registro actualizado correctamente.';
        this.adminService.clearEmployeeOptionsCache();
        this.changed.emit();
        this.closeDialog();
        this.loadCatalogs();
      },
      error: (error) => this.errorMessage = this.getErrorMessage(error, 'No se pudo guardar el registro.'),
    });
  }

  askDelete(view: CatalogView, key: number | string, label: string): void {
    this.pendingDelete = { view, key, label };
    this.isDeleteDialogOpen = true;
    this.errorMessage = '';
  }

  cancelDelete(): void {
    this.isDeleteDialogOpen = false;
    this.pendingDelete = null;
  }

  confirmDelete(): void {
    if (!this.pendingDelete) return;
    const { view, key } = this.pendingDelete;
    const request = view === 'regionals' ? this.adminService.deleteRegional(Number(key))
      : view === 'buildings' ? this.adminService.deleteBuilding(Number(key))
      : view === 'departments' ? this.adminService.deleteDepartment(Number(key))
      : this.adminService.deleteDirectoryEmployeeByKey(String(key));
    this.isSaving = true;
    request.pipe(finalize(() => this.isSaving = false)).subscribe({
      next: () => {
        this.message = 'Registro eliminado correctamente.';
        this.adminService.clearEmployeeOptionsCache();
        this.changed.emit();
        this.cancelDelete();
        this.loadCatalogs();
      },
      error: (error) => this.errorMessage = this.getErrorMessage(error, 'No se pudo eliminar el registro.'),
    });
  }

  employeeDepartmentName(employee: DirectoryEmployee): string {
    return this.departments.find((department) => department.IdArea === employee.IdArea)?.NombreArea ?? '-';
  }

  employeeBuildingName(employee: DirectoryEmployee): string {
    return this.departments.find((department) => department.IdArea === employee.IdArea)?.NombreEdificio ?? '-';
  }

  employeeRegionalName(employee: DirectoryEmployee): string {
    return this.departments.find((department) => department.IdArea === employee.IdArea)?.NombreRegional ?? '-';
  }

  private syncCatalogSelection(): void {
    if (this.catalogRegionalId !== null && !this.regionals.some((regional) => regional.IdRegional === this.catalogRegionalId)) {
      this.catalogRegionalId = null;
    }
    if (!this.buildingsForSelectedRegional.some((building) => building.IdEdificio === this.catalogBuildingId)) {
      this.catalogBuildingId = null;
    }
    if (!this.departmentsForSelectedBuilding.some((department) => department.IdArea === this.catalogAreaId)) {
      this.catalogAreaId = null;
    }
    if (!this.employeesForSelectedDepartment.some((employee) => employee.EmployeeKey === this.catalogEmployeeKey)) {
      this.catalogEmployeeKey = '';
    }
  }

  private requireFields(message: string): void {
    this.errorMessage = message;
  }

  private normalizeSearch(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
  }

  private filterRows<T>(rows: T[], values: (row: T) => unknown[]): T[] {
    const search = this.searchTerm.trim().toLocaleLowerCase();
    const filtered = search
      ? rows.filter((row) => values(row).some((value) => String(value ?? '').toLocaleLowerCase().includes(search)))
      : [...rows];
    if (!this.sortColumn) return filtered;
    return filtered.sort((first, second) => {
      const firstValue = String((first as Record<string, unknown>)[this.sortColumn] ?? '').toLocaleLowerCase();
      const secondValue = String((second as Record<string, unknown>)[this.sortColumn] ?? '').toLocaleLowerCase();
      const comparison = firstValue.localeCompare(secondValue, undefined, { numeric: true });
      return this.sortDirection === 'asc' ? comparison : -comparison;
    });
  }

  private pageRows<T>(rows: T[]): T[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return rows.slice(start, start + this.pageSize);
  }

  private resetForm(): void {
    this.editingId = null;
    this.editingEmployeeKey = '';
    this.isLocationContextLocked = false;
    this.regionalName = '';
    this.buildingName = '';
    this.departmentName = '';
    this.employeeName = '';
    this.employeeNoPago = '';
    this.selectedRegionId = null;
    this.selectedBuildingId = null;
    this.selectedAreaId = null;
    this.errorMessage = '';
  }

  private getErrorMessage(error: { error?: { Message?: string; message?: string; detail?: string }; message?: string }, fallback: string): string {
    return error.error?.Message ?? error.error?.message ?? error.error?.detail ?? error.message ?? fallback;
  }
}
