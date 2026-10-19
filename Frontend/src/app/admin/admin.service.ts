import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, map, Observable, shareReplay, tap, throwError } from 'rxjs';
import { apiUrl } from '../api-url';
import { toPascalCase } from '../shared/api-response';
import { AdminUser, Area, Building, CatalogDepartment, CreateAdminUser, CreateDesktopCombo, CreateDevice, CreateReassignment, Device, DeviceOption, DevicePageQuery, DeviceType, DirectoryEmployee, EmployeeAssignedDevice, EmployeeOption, EmployeeSearchResult, PagedResult, RegionalOption, Reassignment, SaveBuilding, SaveDepartment, SaveDeviceType, SaveDirectoryEmployee, SaveRegional, UpdateAdminUser, UpdateEmployee } from './admin.models';

const API_ADMIN_URL = apiUrl('admin');

// Los equipos asignados de la búsqueda de empleados no traen estos campos calculados.
const withDeviceDefaults = (device: EmployeeAssignedDevice): EmployeeAssignedDevice => ({
  ...device,
  AsignadoA: device.AsignadoA ?? null,
  NCombo: device.NCombo ?? null,
  Componente: device.Componente ?? null,
});

// Cliente HTTP del módulo Admin. Centraliza las URLs, adapta las respuestas del
// backend al modelo usado por las vistas y cachea catálogos que cambian poco.
@Injectable({ providedIn: 'root' })
export class AdminService {
  private deviceTypesCache$?: Observable<DeviceType[]>;
  private buildingsCache$?: Observable<Building[]>;
  private readonly areasCacheByBuilding = new Map<number, Observable<Area[]>>();
  private readonly employeeOptionsCacheByArea = new Map<number, Observable<EmployeeOption[]>>();
  constructor(private readonly httpClient: HttpClient) { }

  // GET a la API admin que devuelve el cuerpo con las propiedades en PascalCase.
  private get<T>(path: string, params?: HttpParams): Observable<T> {
    return this.httpClient.get<unknown>(`${API_ADMIN_URL}/${path}`, { params })
      .pipe(map((body) => toPascalCase<T>(body)));
  }

  // Consulta dispositivos paginados con filtros; Reportes recorre todas las páginas coincidentes.
  getDevices(query: DevicePageQuery): Observable<PagedResult<Device>> {
    let params = new HttpParams()
      .set('page', query.Page)
      .set('pageSize', query.PageSize);
    if (query.SearchTerm.trim()) params = params.set('searchTerm', query.SearchTerm.trim());
    if (query.Brand.trim()) params = params.set('brand', query.Brand.trim());
    if (query.Model.trim()) params = params.set('model', query.Model.trim());
    if (query.TypeId !== null) params = params.set('typeId', query.TypeId);
    if (query.RegionalId !== null) params = params.set('regionalId', query.RegionalId);
    if (query.BuildingId !== null) params = params.set('buildingId', query.BuildingId);
    if (query.AreaId !== null) params = params.set('areaId', query.AreaId);
    if (query.State?.trim()) params = params.set('state', query.State.trim());
    if (query.ComboOnly) params = params.set('comboOnly', true);

    return this.get<Partial<PagedResult<Device>>>('devices', params).pipe(map((result) => ({
      Items: result.Items ?? [],
      TotalCount: result.TotalCount ?? 0,
      Page: result.Page ?? query.Page,
      PageSize: result.PageSize ?? 25,
    })));
  }

  searchDeviceOptions(searchTerm: string): Observable<DeviceOption[]> {
    return this.get<DeviceOption[]>('device-options', new HttpParams().set('searchTerm', searchTerm));
  }

  searchEmployees(searchTerm: string): Observable<EmployeeSearchResult[]> {
    return this.get<EmployeeSearchResult[]>('employees/search', new HttpParams().set('searchTerm', searchTerm)).pipe(
      map((employees) => employees.map((employee) => ({
        ...employee,
        AssignedDevices: (employee.AssignedDevices ?? []).map(withDeviceDefaults),
      }))),
    );
  }

  updateEmployee(currentNoPago: string, employee: UpdateEmployee): Observable<void> {
    return this.httpClient.put<void>(`${API_ADMIN_URL}/employees/${encodeURIComponent(currentNoPago)}`, employee);
  }

  updateDirectoryEmployeeByKey(employeeKey: string, employee: UpdateEmployee): Observable<void> {
    const params = new HttpParams().set('employeeKey', employeeKey);
    return this.httpClient.put<void>(`${API_ADMIN_URL}/employees/directory/by-key`, employee, { params });
  }

  getEmployeeOptions(idArea: number): Observable<EmployeeOption[]> {
    const cachedOptions = this.employeeOptionsCacheByArea.get(idArea);
    if (cachedOptions) return cachedOptions;

    const request = this.get<EmployeeOption[]>('employees/options', new HttpParams().set('idArea', idArea)).pipe(
      map((employees) => employees.map((employee) => ({ ...employee, IdArea: employee.IdArea ?? 0 }))),
      shareReplay({ bufferSize: 1, refCount: false }),
      catchError((error) => {
        this.employeeOptionsCacheByArea.delete(idArea);
        return throwError(() => error);
      }),
    );
    this.employeeOptionsCacheByArea.set(idArea, request);
    return request;
  }

  getDirectoryEmployees(): Observable<DirectoryEmployee[]> {
    return this.get<DirectoryEmployee[]>('employees/directory');
  }

  clearEmployeeOptionsCache(): void { this.employeeOptionsCacheByArea.clear(); }

  // Botón Refrescar: descarta todos los catálogos en caché para volver a pedirlos al servidor.
  clearCatalogCaches(): void {
    this.clearDeviceTypesCache();
    this.clearBuildingsCache();
    this.clearAreasCache();
    this.clearEmployeeOptionsCache();
  }

  getRegionals(): Observable<RegionalOption[]> {
    return this.get<RegionalOption[]>('regionals');
  }

  getCatalogDepartments(): Observable<CatalogDepartment[]> {
    return this.get<CatalogDepartment[]>('catalog/departments');
  }

  createRegional(regional: SaveRegional): Observable<void> {
    return this.httpClient.post<void>(`${API_ADMIN_URL}/regionals`, regional).pipe(tap(() => this.clearBuildingsCache()));
  }
  updateRegional(id: number, regional: SaveRegional): Observable<void> {
    return this.httpClient.put<void>(`${API_ADMIN_URL}/regionals/${id}`, regional).pipe(tap(() => this.clearBuildingsCache()));
  }
  deleteRegional(id: number): Observable<void> {
    return this.httpClient.delete<void>(`${API_ADMIN_URL}/regionals/${id}`).pipe(tap(() => this.clearBuildingsCache()));
  }
  createBuilding(building: SaveBuilding): Observable<void> {
    return this.httpClient.post<void>(`${API_ADMIN_URL}/buildings`, building).pipe(tap(() => this.clearBuildingsCache()));
  }
  updateBuilding(id: number, building: SaveBuilding): Observable<void> {
    return this.httpClient.put<void>(`${API_ADMIN_URL}/buildings/${id}`, building).pipe(tap(() => this.clearBuildingsCache()));
  }
  deleteBuilding(id: number): Observable<void> {
    return this.httpClient.delete<void>(`${API_ADMIN_URL}/buildings/${id}`).pipe(tap(() => this.clearBuildingsCache()));
  }
  createDepartment(department: SaveDepartment): Observable<void> {
    return this.httpClient.post<void>(`${API_ADMIN_URL}/departments`, department).pipe(tap(() => this.clearAreasCache()));
  }
  updateDepartment(id: number, department: SaveDepartment): Observable<void> {
    return this.httpClient.put<void>(`${API_ADMIN_URL}/departments/${id}`, department).pipe(tap(() => this.clearAreasCache()));
  }
  deleteDepartment(id: number): Observable<void> {
    return this.httpClient.delete<void>(`${API_ADMIN_URL}/departments/${id}`).pipe(tap(() => this.clearAreasCache()));
  }
  getCatalogDeviceTypes(): Observable<DeviceType[]> {
    return this.get<DeviceType[]>('catalog/device-types');
  }
  createDeviceType(deviceType: SaveDeviceType): Observable<void> {
    return this.httpClient.post<void>(`${API_ADMIN_URL}/device-types`, deviceType)
      .pipe(tap(() => this.clearDeviceTypesCache()));
  }
  updateDeviceType(id: number, deviceType: SaveDeviceType): Observable<void> {
    return this.httpClient.put<void>(`${API_ADMIN_URL}/device-types/${id}`, deviceType)
      .pipe(tap(() => this.clearDeviceTypesCache()));
  }
  deleteDeviceType(id: number): Observable<void> {
    return this.httpClient.delete<void>(`${API_ADMIN_URL}/device-types/${id}`)
      .pipe(tap(() => this.clearDeviceTypesCache()));
  }
  createDirectoryEmployee(employee: SaveDirectoryEmployee): Observable<void> { return this.httpClient.post<void>(`${API_ADMIN_URL}/employees/directory`, employee); }
  deleteDirectoryEmployee(noPago: string): Observable<void> { return this.httpClient.delete<void>(`${API_ADMIN_URL}/employees/directory/${encodeURIComponent(noPago)}`); }
  deleteDirectoryEmployeeByKey(employeeKey: string): Observable<void> {
    const params = new HttpParams().set('employeeKey', employeeKey);
    return this.httpClient.delete<void>(`${API_ADMIN_URL}/employees/directory/by-key`, { params });
  }

  getDeviceTypes(): Observable<DeviceType[]> {
    // Los tipos se reutilizan entre formularios y por eso se cachean durante la sesión.
    if (this.deviceTypesCache$) return this.deviceTypesCache$;
    this.deviceTypesCache$ = this.get<DeviceType[]>('device-types').pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.deviceTypesCache$;
  }

  private clearDeviceTypesCache(): void { this.deviceTypesCache$ = undefined; }

  getBuildings(): Observable<Building[]> {
    if (this.buildingsCache$) return this.buildingsCache$;
    const request = this.get<Building[]>('buildings').pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
      catchError((error) => {
        this.buildingsCache$ = undefined;
        return throwError(() => error);
      }),
    );
    this.buildingsCache$ = request;
    return request;
  }

  private clearBuildingsCache(): void {
    this.buildingsCache$ = undefined;
  }

  getAreas(idEdificio: number): Observable<Area[]> {
    const cachedAreas = this.areasCacheByBuilding.get(idEdificio);
    if (cachedAreas) return cachedAreas;

    // La API no devuelve el edificio de cada área; se completa con el solicitado.
    const request = this.get<Area[]>(`areas/${idEdificio}`).pipe(
      map((areas) => areas.map((area) => ({ ...area, IdEdificio: area.IdEdificio ?? idEdificio }))),
      shareReplay({ bufferSize: 1, refCount: false }),
      catchError((error) => {
        this.areasCacheByBuilding.delete(idEdificio);
        return throwError(() => error);
      }),
    );
    this.areasCacheByBuilding.set(idEdificio, request);
    return request;
  }

  hasAreasCache(idEdificio: number): boolean {
    return this.areasCacheByBuilding.has(idEdificio);
  }

  private clearAreasCache(): void {
    this.areasCacheByBuilding.clear();
  }

  createDevice(device: CreateDevice): Observable<void> {
    // Solicita al backend insertar un dispositivo nuevo.
    return this.httpClient.post<void>(`${API_ADMIN_URL}/devices`, device);
  }

  createDesktopCombo(combo: CreateDesktopCombo): Observable<void> {
    return this.httpClient.post<void>(`${API_ADMIN_URL}/devices/desktop-combos`, combo);
  }

  // Persiste los cambios de un dispositivo existente. Si es pieza de un combo, applyToCombo
  // reasigna las tres piezas; sin él solo cambia esta y el combo se separa si cambia su asignación.
  updateDevice(idEquipo: number, device: CreateDevice, applyToCombo = false): Observable<void> {
    const params = applyToCombo ? new HttpParams().set('applyToCombo', true) : undefined;
    return this.httpClient.put<void>(`${API_ADMIN_URL}/devices/${idEquipo}`, device, { params });
  }

  updateDeviceByIdentifier(codigoInventario: string, noSerie: string, idEquipo: number, device: CreateDevice): Observable<void> {
    // Usa los identificadores originales para editar aunque código o serie cambien.
    const params = new URLSearchParams({ codigoInventario, noSerie });
    return this.httpClient.put<void>(`${API_ADMIN_URL}/devices/by-identifier?${params}`, device).pipe(
      // Si los identificadores originales ya no existen (404) o la API no expone la
      // ruta (405), se intenta actualizar por ID.
      catchError((error) => error.status === 404 || error.status === 405
        ? this.updateDevice(idEquipo, device)
        : throwError(() => error)),
    );
  }

  deleteDevice(idEquipo: number): Observable<void> {
    // Solicita eliminar el equipo y sus relaciones permitidas.
    return this.httpClient.delete<void>(`${API_ADMIN_URL}/devices/${idEquipo}`);
  }

  getReassignments(): Observable<Reassignment[]> {
    // Consulta el historial de cambios de responsable.
    return this.get<Reassignment[]>('reassignments');
  }

  createReassignment(reassignment: CreateReassignment): Observable<void> {
    // Registra el cambio de responsable y permite nombre sin número de pago.
    return this.httpClient.post<void>(`${API_ADMIN_URL}/reassignments`, reassignment);
  }

  deleteReassignment(idReasignacion: number): Observable<void> {
    return this.httpClient.delete<void>(`${API_ADMIN_URL}/reassignments/${idReasignacion}`);
  }

  getUsers(): Observable<AdminUser[]> {
    // Consulta los usuarios que el administrador puede gestionar.
    return this.get<AdminUser[]>('users');
  }
  // Crea un nuevo usuario en el sistema. La contraseña inicial se genera en el backend y no se muestra en pantalla.
  createUser(user: CreateAdminUser): Observable<void> {
    return this.httpClient.post<void>(`${API_ADMIN_URL}/users`, user);
  }
  updateUser(idUsuario: number, user: UpdateAdminUser): Observable<void> {
    return this.httpClient.put<void>(`${API_ADMIN_URL}/users/${idUsuario}`, user);
  }
  resetUserPassword(idUsuario: number): Observable<void> {
    return this.httpClient.post<void>(`${API_ADMIN_URL}/users/${idUsuario}/reset-password`, {});
  }
  // Elimina un usuario del sistema.
  deleteUser(idUsuario: number): Observable<void> {
    return this.httpClient.delete<void>(`${API_ADMIN_URL}/users/${idUsuario}`);
  }
}
