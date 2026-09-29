import { ChangeDetectorRef, Component, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize, forkJoin, Observable } from 'rxjs';
import { AdminService } from './admin.service';
import { Building, CatalogDepartment, DirectoryEmployee, RegionalOption } from './admin.models';

type CatalogView = 'regionals' | 'buildings' | 'departments' | 'employees';
type DeleteRequest = { view: CatalogView; key: number | string; label: string };
type LocationSearchResult = {
  key: string;
  type: 'Edificio' | 'Departamento' | 'Empleado';
  title: string;
  location: string;
  IdEdificio: number;
  IdArea?: number;
  EmployeeKey?: string;
};

@Component({
  selector: 'app-catalog-management',
  imports: [FormsModule],
  templateUrl: './catalog-management.component.html',
  styleUrl: './catalog-management.component.css',
})
//exporta la clase CatalogManagementComponent que maneja la gestión de catálogos en la aplicación
//  incluyendo la visualización, creación, edición y eliminación de regionales, edificios, departamentos y empleados.
export class CatalogManagementComponent {
  readonly changed = output<void>();
  readonly views: { id: CatalogView; label: string }[] = [
    { id: 'regionals', label: 'Regionales' },
    { id: 'buildings', label: 'Ubicaciones' },
  ];
  //estados y propiedades del componente
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
  lockLocationRegion = false;
  lockLocationBuilding = false;
  lockLocationDepartment = false;
  isDeleteDialogOpen = false;
  editingId: number | null = null;
  editingEmployeeKey = '';
  pendingDelete: DeleteRequest | null = null;
  selectedRegionId: number | null = null;
  selectedBuildingId: number | null = null;
  selectedAreaId: number | null = null;
  locationRegionId: number | null = null;
  locationBuildingOptionId: number | null = null;
  locationBuildingId: number | null = null;
  locationDepartmentOptionId: number | null = null;
  locationAreaId: number | null = null;
  locationEmployeeOptionKey = '';
  locationEmployeeKey = '';
  isLocationSearchOpen = false;
  locationSearchTerm = '';
  locationSearchSubmitted = false;
  locationSearchError = '';
  regionalName = '';
  buildingName = '';
  departmentName = '';
  employeeName = '';
  employeeNoPago = '';
  message = '';
  errorMessage = '';

    //metodo constructor que inyecta el servicio AdminService y ChangeDetectorRef, y llama a loadCatalogs() para cargar los catálogos iniciales.
  constructor(
    private readonly adminService: AdminService,
    private readonly changeDetector: ChangeDetectorRef,
  ) {
    this.loadCatalogs();
  }

    //metodos para filtrar y paginar los catálogos de regionales, edificios, departamentos y empleados, así como para manejar la creación, edición y eliminación de registros.
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

  get locationBuildingName(): string {
    return this.buildings.find((building) => building.IdEdificio === this.locationBuildingId)?.NombreEdificio
      ?? 'Selecciona un edificio';
  }

  get locationDepartmentName(): string {
    return this.departments.find((department) => department.IdArea === this.locationAreaId)?.NombreArea
      ?? 'Selecciona un departamento';
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

  get locationBuildings(): Building[] {
    return this.locationRegionId === null
      ? []
      : this.catalogBuildings.filter((building) => building.IdRegional === this.locationRegionId);
  }

  get locationDepartments(): CatalogDepartment[] {
    return this.locationBuildingId === null
      ? []
      : this.catalogDepartments.filter((department) => department.IdEdificio === this.locationBuildingId);
  }

  get locationEmployees(): DirectoryEmployee[] {
    return this.locationAreaId === null
      ? []
      : this.catalogEmployees.filter((employee) => employee.IdArea === this.locationAreaId);
  }

  get locationSearchResults(): LocationSearchResult[] {
    const term = this.locationSearchTerm.trim().toLocaleLowerCase();
    if (!this.locationSearchSubmitted || term.length < 2) return [];

    const results: LocationSearchResult[] = [];
    const matches = (values: unknown[]) => values.some((value) =>
      String(value ?? '').toLocaleLowerCase().includes(term));

    this.buildings.forEach((building) => {
      const regional = this.regionals.find((item) => item.IdRegional === building.IdRegional);
      if (!matches([building.IdEdificio, building.NombreEdificio, regional?.NombreRegional])) return;
      results.push({
        key: `building-${building.IdEdificio}`,
        type: 'Edificio',
        title: building.NombreEdificio,
        location: regional?.NombreRegional ?? 'Sin regional',
        IdEdificio: building.IdEdificio,
      });
    });

    this.departments.forEach((department) => {
      if (!matches([department.IdArea, department.NombreArea, department.NombreEdificio, department.NombreRegional])) return;
      results.push({
        key: `department-${department.IdArea}`,
        type: 'Departamento',
        title: department.NombreArea,
        location: `${department.NombreEdificio} · ${department.NombreRegional ?? 'Sin regional'}`,
        IdEdificio: department.IdEdificio,
        IdArea: department.IdArea,
      });
    });

    const departmentsById = new Map(this.departments.map((department) => [department.IdArea, department]));
    this.employees.forEach((employee) => {
      if (employee.IdArea === null) return;
      const department = departmentsById.get(employee.IdArea);
      if (!matches([
        employee.NoPago,
        employee.NombreCompleto,
        department?.NombreArea,
        department?.NombreEdificio,
        department?.NombreRegional,
      ])) return;
      results.push({
        key: `employee-${employee.EmployeeKey}`,
        type: 'Empleado',
        title: employee.NombreCompleto,
        location: `${department?.NombreArea ?? 'Sin departamento'} · ${department?.NombreEdificio ?? 'Sin edificio'} · ${department?.NombreRegional ?? 'Sin regional'}`,
        IdEdificio: department?.IdEdificio ?? 0,
        IdArea: employee.IdArea,
        EmployeeKey: employee.EmployeeKey,
      });
    });

    return results.slice(0, 100);
  }

  //metodos para obtener las filas visibles de los catálogos de regionales, edificios, departamentos y empleados
  //así como para calcular el número total de páginas y las filas visibles en la página actual.

  get visibleRegionals(): RegionalOption[] { return this.pageRows(this.catalogRegionals); }
  get visibleBuildings(): Building[] { return this.pageRows(this.catalogBuildings); }
  get visibleDepartments(): CatalogDepartment[] { return this.pageRows(this.catalogDepartments); }
  get visibleEmployees(): DirectoryEmployee[] { return this.pageRows(this.catalogEmployees); }

  get filteredCount(): number {
    return this.activeView === 'regionals' ? this.catalogRegionals.length
      : this.activeView === 'buildings' ? this.catalogBuildings.length
      : this.activeView === 'departments' ? this.catalogDepartments.length
      : this.catalogEmployees.length;
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
        if (this.locationRegionId === null && catalogs.regionals.length > 0) {
          const buildingCounts = new Map<number, number>();
          catalogs.buildings.forEach((building) => {
            if (building.IdRegional === null) return;
            buildingCounts.set(building.IdRegional, (buildingCounts.get(building.IdRegional) ?? 0) + 1);
          });
          const preferredRegional = catalogs.regionals.find((regional) =>
            regional.NombreRegional.trim().toLocaleUpperCase() === 'TEGUCIGALPA');
          const mostPopulatedRegional = catalogs.regionals.reduce((mostPopulated, regional) =>
            (buildingCounts.get(regional.IdRegional) ?? 0) > (buildingCounts.get(mostPopulated.IdRegional) ?? 0)
              ? regional
              : mostPopulated).IdRegional;
          this.locationRegionId = preferredRegional?.IdRegional ?? mostPopulatedRegional;
        }
        this.currentPage = Math.min(this.currentPage, this.totalPages);
      },
      error: (error) => this.errorMessage = this.getErrorMessage(error, 'No se pudieron cargar los catálogos.'),
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

  openCreateFor(view: Exclude<CatalogView, 'regionals'>): void {
    this.activeView = view;
    this.openCreate();
    this.selectedRegionId = this.locationRegionId;
    this.lockLocationRegion = true;
    this.lockLocationBuilding = view !== 'buildings';
    if (view !== 'buildings') {
      this.selectedBuildingId = this.locationBuildingId;
    }
    if (view === 'employees') {
      this.selectedAreaId = this.locationAreaId;
      this.lockLocationDepartment = true;
    }
  }

  editRegional(regional: RegionalOption): void {
    this.resetForm();
    this.activeView = 'regionals';
    this.editingId = regional.IdRegional;
    this.regionalName = regional.NombreRegional;
    this.isDialogOpen = true;
  }

  editBuilding(building: Building): void {
    this.resetForm();
    this.activeView = 'buildings';
    this.lockLocationRegion = true;
    this.editingId = building.IdEdificio;
    this.buildingName = building.NombreEdificio;
    this.selectedRegionId = building.IdRegional;
    this.isDialogOpen = true;
  }

  editDepartment(department: CatalogDepartment): void {
    this.resetForm();
    this.activeView = 'departments';
    this.lockLocationRegion = true;
    this.lockLocationBuilding = true;
    this.editingId = department.IdArea;
    this.departmentName = department.NombreArea;
    this.selectedRegionId = department.IdRegional;
    this.selectedBuildingId = department.IdEdificio;
    this.isDialogOpen = true;
  }

  editEmployee(employee: DirectoryEmployee): void {
    this.resetForm();
    this.activeView = 'employees';
    this.lockLocationRegion = true;
    this.lockLocationBuilding = true;
    this.lockLocationDepartment = true;
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

  selectLocationRegion(idRegional: number | null): void {
    this.locationRegionId = idRegional;
    this.locationBuildingOptionId = null;
    this.locationBuildingId = null;
    this.locationDepartmentOptionId = null;
    this.locationAreaId = null;
    this.locationEmployeeOptionKey = '';
    this.locationEmployeeKey = '';
  }

  selectLocationBuilding(idEdificio: number | null): void {
    this.locationBuildingOptionId = idEdificio;
    if (idEdificio === null) {
      this.locationBuildingId = null;
      this.locationDepartmentOptionId = null;
      this.locationAreaId = null;
      this.locationEmployeeOptionKey = '';
      this.locationEmployeeKey = '';
      return;
    }
    if (this.locationBuildingId !== idEdificio) {
      this.locationDepartmentOptionId = null;
      this.locationAreaId = null;
      this.locationEmployeeOptionKey = '';
      this.locationEmployeeKey = '';
    }
    this.locationBuildingId = idEdificio;
  }

  editLocationBuilding(): void {
    const building = this.buildings.find((item) => item.IdEdificio === this.locationBuildingOptionId);
    if (building) this.editBuilding(building);
  }

  deleteLocationBuilding(): void {
    const building = this.buildings.find((item) => item.IdEdificio === this.locationBuildingOptionId);
    if (building) this.askDelete('buildings', building.IdEdificio, building.NombreEdificio);
  }

  selectLocationDepartment(idArea: number | null): void {
    this.locationDepartmentOptionId = idArea;
    if (idArea === null) {
      this.locationAreaId = null;
      this.locationEmployeeOptionKey = '';
      this.locationEmployeeKey = '';
      return;
    }
    if (this.locationAreaId !== idArea) {
      this.locationEmployeeOptionKey = '';
      this.locationEmployeeKey = '';
    }
    this.locationAreaId = idArea;
  }

  editLocationDepartment(): void {
    const department = this.departments.find((item) => item.IdArea === this.locationDepartmentOptionId);
    if (department) this.editDepartment(department);
  }

  deleteLocationDepartment(): void {
    const department = this.departments.find((item) => item.IdArea === this.locationDepartmentOptionId);
    if (department) this.askDelete('departments', department.IdArea, department.NombreArea);
  }

  selectLocationEmployee(employeeKey: string): void {
    this.locationEmployeeOptionKey = employeeKey;
    this.locationEmployeeKey = employeeKey;
  }

  openLocationSearch(): void {
    this.locationSearchTerm = '';
    this.locationSearchSubmitted = false;
    this.locationSearchError = '';
    this.isLocationSearchOpen = true;
  }

  closeLocationSearch(): void {
    this.isLocationSearchOpen = false;
  }

  updateLocationSearch(value: string): void {
    this.locationSearchTerm = value;
    this.locationSearchSubmitted = false;
    this.locationSearchError = '';
  }

  searchLocationCatalogs(): void {
    this.locationSearchError = '';
    if (this.locationSearchTerm.trim().length < 2) {
      this.locationSearchSubmitted = false;
      this.locationSearchError = 'Escribe al menos 2 caracteres para buscar.';
      return;
    }
    this.locationSearchSubmitted = true;
  }

  selectLocationSearchResult(result: LocationSearchResult): void {
    const building = this.buildings.find((item) => item.IdEdificio === result.IdEdificio);
    if (!building || building.IdRegional === null) return;

    this.selectLocationRegion(building.IdRegional);
    this.selectLocationBuilding(building.IdEdificio);
    if (result.IdArea !== undefined) this.selectLocationDepartment(result.IdArea);
    if (result.EmployeeKey) this.selectLocationEmployee(result.EmployeeKey);
    this.closeLocationSearch();
  }

  editLocationEmployee(): void {
    const employee = this.locationEmployees.find((item) => item.EmployeeKey === this.locationEmployeeOptionKey);
    if (employee) this.editEmployee(employee);
  }

  deleteLocationEmployee(): void {
    const employee = this.locationEmployees.find((item) => item.EmployeeKey === this.locationEmployeeOptionKey);
    if (employee) this.askDelete('employees', employee.EmployeeKey, employee.NombreCompleto);
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
    request.pipe(finalize(() => {
      this.isSaving = false;
      this.changeDetector.markForCheck();
    })).subscribe({
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
    request.pipe(finalize(() => {
      this.isSaving = false;
      this.changeDetector.markForCheck();
    })).subscribe({
      next: () => {
        this.message = 'Registro eliminado correctamente.';
        if (view === 'regionals' && Number(key) === this.locationRegionId) {
          this.locationRegionId = null;
          this.locationBuildingId = null;
          this.locationAreaId = null;
        } else if (view === 'buildings' && Number(key) === this.locationBuildingId) {
          this.locationBuildingId = null;
          this.locationAreaId = null;
        } else if (view === 'departments' && Number(key) === this.locationAreaId) {
          this.locationAreaId = null;
        }
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

  private requireFields(message: string): void {
    this.errorMessage = message;
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
    this.lockLocationRegion = false;
    this.lockLocationBuilding = false;
    this.lockLocationDepartment = false;
    this.editingId = null;
    this.editingEmployeeKey = '';
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
