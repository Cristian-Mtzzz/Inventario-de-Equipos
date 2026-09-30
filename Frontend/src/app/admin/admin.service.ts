import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { catchError, map, Observable, shareReplay, tap, throwError } from 'rxjs';
import { AdminUser, Area, Building, CatalogDepartment, CreateAdminUser, CreateDevice, CreateReassignment, Device, DeviceOption, DevicePageQuery, DeviceType, DirectoryEmployee, EmployeeOption, EmployeeSearchResult, PagedResult, RegionalOption, Reassignment, SaveBuilding, SaveDepartment, SaveDirectoryEmployee, SaveRegional, UpdateAdminUser, UpdateEmployee } from './admin.models';

const API_ADMIN_URL = '/api/admin';

type ApiDevice = Device & {
  idEquipo?: number; codigoInventario?: string; noSerie?: string; marca?: string;
  modelo?: string; idTipo?: number | null; estado?: string;
  numeroPagoAsignado?: string | null; nombreAsignado?: string | null; idArea?: number | null;
  nombreTipo?: string | null; nombreArea?: string | null; asignadoA?: string | null;
  idEdificio?: number | null; nombreEdificio?: string | null;
  idRegional?: number | null; nombreRegional?: string | null;
};

const normalizeDevice = (device: ApiDevice): Device => ({
  IdEquipo: device.IdEquipo ?? device.idEquipo ?? 0,
  CodigoInventario: device.CodigoInventario ?? device.codigoInventario ?? '',
  NoSerie: device.NoSerie ?? device.noSerie ?? '',
  Marca: device.Marca ?? device.marca ?? '',
  Modelo: device.Modelo ?? device.modelo ?? '',
  IdTipo: device.IdTipo ?? device.idTipo ?? null,
  NombreTipo: device.NombreTipo ?? device.nombreTipo ?? null,
  Estado: device.Estado ?? device.estado ?? '',
  NumeroPagoAsignado: device.NumeroPagoAsignado ?? device.numeroPagoAsignado ?? null,
  NombreAsignado: device.NombreAsignado ?? device.nombreAsignado ?? null,
  IdArea: device.IdArea ?? device.idArea ?? null,
  NombreArea: device.NombreArea ?? device.nombreArea ?? null,
  AsignadoA: device.AsignadoA ?? device.asignadoA ?? null,
  IdEdificio: device.IdEdificio ?? device.idEdificio ?? null,
  NombreEdificio: device.NombreEdificio ?? device.nombreEdificio ?? null,
  IdRegional: device.IdRegional ?? device.idRegional ?? null,
  NombreRegional: device.NombreRegional ?? device.nombreRegional ?? null,
});

// Cliente HTTP del módulo Admin. Centraliza las URLs, transforma respuestas del
// backend al modelo usado por las vistas y cachea catálogos que cambian poco.
@Injectable({ providedIn: 'root' })
export class AdminService {
  private deviceTypesCache$?: Observable<DeviceType[]>;
  private buildingsCache$?: Observable<Building[]>;
  private readonly areasCacheByBuilding = new Map<number, Observable<Area[]>>();
  private employeeOptionsCache$?: Observable<EmployeeOption[]>;
  constructor(private readonly httpClient: HttpClient) { }

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

    return this.httpClient.get<PagedResult<ApiDevice> & {
      items?: ApiDevice[]; totalCount?: number; page?: number; pageSize?: number;
    }>(`${API_ADMIN_URL}/devices`, { params }).pipe(map((result) => ({
      Items: (result.Items ?? result.items ?? []).map(normalizeDevice),
      TotalCount: result.TotalCount ?? result.totalCount ?? 0,
      Page: result.Page ?? result.page ?? query.Page,
      PageSize: result.PageSize ?? result.pageSize ?? 25,
    })));
  }

  searchDeviceOptions(searchTerm: string): Observable<DeviceOption[]> {
    const params = new HttpParams().set('searchTerm', searchTerm);
    return this.httpClient.get<Array<DeviceOption & {
      idEquipo?: number; codigoInventario?: string; noSerie?: string; marca?: string; modelo?: string;
    }>>(`${API_ADMIN_URL}/device-options`, { params }).pipe(map((options) => options.map((device) => ({
      IdEquipo: device.IdEquipo ?? device.idEquipo ?? 0,
      CodigoInventario: device.CodigoInventario ?? device.codigoInventario ?? '',
      NoSerie: device.NoSerie ?? device.noSerie ?? '',
      Marca: device.Marca ?? device.marca ?? '',
      Modelo: device.Modelo ?? device.modelo ?? '',
    }))));
  }

  searchEmployees(searchTerm: string): Observable<EmployeeSearchResult[]> {
    const params = new HttpParams().set('searchTerm', searchTerm);
    return this.httpClient.get<Array<EmployeeSearchResult & {
      noPago?: string; nombreCompleto?: string; estado?: string; idArea?: number | null; nombreArea?: string | null;
      idEdificio?: number | null; nombreEdificio?: string | null; idRegional?: number | null;
      nombreRegional?: string | null; assignedDevices?: ApiDevice[];
    }>>(`${API_ADMIN_URL}/employees/search`, { params }).pipe(map((employees) => employees.map((employee) => ({
      NoPago: employee.NoPago ?? employee.noPago ?? '',
      NombreCompleto: employee.NombreCompleto ?? employee.nombreCompleto ?? '',
      Estado: employee.Estado ?? employee.estado ?? '',
      IdArea: employee.IdArea ?? employee.idArea ?? null,
      NombreArea: employee.NombreArea ?? employee.nombreArea ?? null,
      IdEdificio: employee.IdEdificio ?? employee.idEdificio ?? null,
      NombreEdificio: employee.NombreEdificio ?? employee.nombreEdificio ?? null,
      IdRegional: employee.IdRegional ?? employee.idRegional ?? null,
      NombreRegional: employee.NombreRegional ?? employee.nombreRegional ?? null,
      AssignedDevices: (employee.AssignedDevices ?? employee.assignedDevices ?? []).map(normalizeDevice),
    }))));
  }

  updateEmployee(currentNoPago: string, employee: UpdateEmployee): Observable<void> {
    return this.httpClient.put<void>(`${API_ADMIN_URL}/employees/${encodeURIComponent(currentNoPago)}`, employee);
  }

  updateDirectoryEmployeeByKey(employeeKey: string, employee: UpdateEmployee): Observable<void> {
    const params = new HttpParams().set('employeeKey', employeeKey);
    return this.httpClient.put<void>(`${API_ADMIN_URL}/employees/directory/by-key`, employee, { params });
  }

  getEmployeeOptions(): Observable<EmployeeOption[]> {
    if (this.employeeOptionsCache$) return this.employeeOptionsCache$;
    this.employeeOptionsCache$ = this.httpClient.get<Array<EmployeeOption & {
      noPago?: string; nombreCompleto?: string; idArea?: number;
    }>>(`${API_ADMIN_URL}/employees/options`).pipe(map((employees) => employees.map((employee) => ({
      NoPago: employee.NoPago ?? employee.noPago ?? '',
      NombreCompleto: employee.NombreCompleto ?? employee.nombreCompleto ?? '',
      IdArea: employee.IdArea ?? employee.idArea ?? 0,
    }))), shareReplay({ bufferSize: 1, refCount: false }));
    return this.employeeOptionsCache$;
  }

  getDirectoryEmployees(): Observable<DirectoryEmployee[]> {
    return this.httpClient.get<Array<DirectoryEmployee & {
      employeeKey?: string; noPago?: string; nombreCompleto?: string; idArea?: number | null;
    }>>(`${API_ADMIN_URL}/employees/directory`).pipe(map((employees) => employees.map((employee) => ({
      EmployeeKey: employee.EmployeeKey ?? employee.employeeKey ?? '',
      NoPago: employee.NoPago ?? employee.noPago ?? '',
      NombreCompleto: employee.NombreCompleto ?? employee.nombreCompleto ?? '',
      IdArea: employee.IdArea ?? employee.idArea ?? null,
    }))));
  }

  clearEmployeeOptionsCache(): void { this.employeeOptionsCache$ = undefined; }

  getRegionals(): Observable<RegionalOption[]> {
    return this.httpClient.get<Array<RegionalOption & { idRegional?: number; nombreRegional?: string }>>(
      `${API_ADMIN_URL}/regionals`,
    ).pipe(map((items) => items.map((item) => ({
      IdRegional: item.IdRegional ?? item.idRegional ?? 0,
      NombreRegional: item.NombreRegional ?? item.nombreRegional ?? '',
    }))));
  }

  getCatalogDepartments(): Observable<CatalogDepartment[]> {
    return this.httpClient.get<Array<CatalogDepartment & {
      idArea?: number; nombreArea?: string; idEdificio?: number; nombreEdificio?: string;
      idRegional?: number | null; nombreRegional?: string | null;
    }>>(`${API_ADMIN_URL}/catalog/departments`).pipe(map((items) => items.map((item) => ({
      IdArea: item.IdArea ?? item.idArea ?? 0,
      NombreArea: item.NombreArea ?? item.nombreArea ?? '',
      IdEdificio: item.IdEdificio ?? item.idEdificio ?? 0,
      NombreEdificio: item.NombreEdificio ?? item.nombreEdificio ?? '',
      IdRegional: item.IdRegional ?? item.idRegional ?? null,
      NombreRegional: item.NombreRegional ?? item.nombreRegional ?? null,
    }))));
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
  createDirectoryEmployee(employee: SaveDirectoryEmployee): Observable<void> { return this.httpClient.post<void>(`${API_ADMIN_URL}/employees/directory`, employee); }
  deleteDirectoryEmployee(noPago: string): Observable<void> { return this.httpClient.delete<void>(`${API_ADMIN_URL}/employees/directory/${encodeURIComponent(noPago)}`); }
  deleteDirectoryEmployeeByKey(employeeKey: string): Observable<void> {
    const params = new HttpParams().set('employeeKey', employeeKey);
    return this.httpClient.delete<void>(`${API_ADMIN_URL}/employees/directory/by-key`, { params });
  }

  getDeviceTypes(): Observable<DeviceType[]> {
    // Los tipos se reutilizan entre formularios y por eso se cachean durante la sesión.
    if (this.deviceTypesCache$) return this.deviceTypesCache$;
    this.deviceTypesCache$ = this.httpClient.get<Array<DeviceType & { idTipo?: number; nombreTipo?: string; tipoDispositivo?: string }>>(`${API_ADMIN_URL}/device-types`).pipe(
      map((types) => types.map((type) => ({
        IdTipo: type.IdTipo ?? type.idTipo ?? 0,
        NombreTipo: type.NombreTipo ?? type.nombreTipo ?? type.tipoDispositivo ?? '',
      }))),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.deviceTypesCache$;
  }

  getBuildings(): Observable<Building[]> {
    if (this.buildingsCache$) return this.buildingsCache$;
    const request = this.httpClient.get<Array<Building & {
      idEdificio?: number; nombreEdificio?: string; idRegional?: number | null; nombreRegional?: string | null;
    }>>(`${API_ADMIN_URL}/buildings`).pipe(
      map((buildings) => buildings.map((building) => ({
        IdEdificio: building.IdEdificio ?? building.idEdificio ?? 0,
        NombreEdificio: building.NombreEdificio ?? building.nombreEdificio ?? '',
        IdRegional: building.IdRegional ?? building.idRegional ?? null,
        NombreRegional: building.NombreRegional ?? building.nombreRegional ?? null,
      }))),
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

    const request = this.httpClient.get<Array<Area & { idArea?: number; nombreArea?: string; idEdificio?: number }>>(`${API_ADMIN_URL}/areas/${idEdificio}`).pipe(
      map((areas) => areas.map((area) => ({
        IdArea: area.IdArea ?? area.idArea ?? 0,
        NombreArea: area.NombreArea ?? area.nombreArea ?? '',
        IdEdificio: area.IdEdificio ?? area.idEdificio ?? idEdificio,
      }))),
      shareReplay({ bufferSize: 1, refCount: false }),
      catchError((error) => {
        this.areasCacheByBuilding.delete(idEdificio);
        return throwError(() => error);
      }),
    );
    this.areasCacheByBuilding.set(idEdificio, request);
    return request;
  }

  private clearAreasCache(): void {
    this.areasCacheByBuilding.clear();
  }

  createDevice(device: CreateDevice): Observable<void> {
    // Solicita al backend insertar un dispositivo nuevo.
    return this.httpClient.post<void>(`${API_ADMIN_URL}/devices`, device);
  }

  updateDevice(idEquipo: number, device: CreateDevice): Observable<void> {
    // Persiste los cambios de un dispositivo existente.
    return this.httpClient.put<void>(`${API_ADMIN_URL}/devices/${idEquipo}`, device);
  }

  updateDeviceByIdentifier(codigoInventario: string, noSerie: string, idEquipo: number, device: CreateDevice): Observable<void> {
    // Usa los identificadores originales para editar aunque código o serie cambien.
    const params = new URLSearchParams({ codigoInventario, noSerie });
    return this.httpClient.put<void>(`${API_ADMIN_URL}/devices/by-identifier?${params}`, device).pipe(
      // Permite trabajar mientras se reinicia una API que todavía solo expone la ruta por ID.
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
    return this.httpClient.get<Array<Reassignment & {
      idReasignacion?: number; idEquipo?: number; codigoInventario?: string; noPagoAnterior?: string | null;
      noPagoNuevo?: string | null; nombreEdificio?: string | null; nombreArea?: string | null; fechaCambio?: string; motivo?: string;
    }>>(`${API_ADMIN_URL}/reassignments`).pipe(map((items) => items.map((item) => ({
      IdReasignacion: item.IdReasignacion ?? item.idReasignacion ?? 0,
      IdEquipo: item.IdEquipo ?? item.idEquipo ?? 0,
      CodigoInventario: item.CodigoInventario ?? item.codigoInventario ?? '',
      NoPagoAnterior: item.NoPagoAnterior ?? item.noPagoAnterior ?? null,
      NoPagoNuevo: item.NoPagoNuevo ?? item.noPagoNuevo ?? null,
      NombreEdificio: item.NombreEdificio ?? item.nombreEdificio ?? null,
      NombreArea: item.NombreArea ?? item.nombreArea ?? null,
      FechaCambio: item.FechaCambio ?? item.fechaCambio ?? '',
      Motivo: item.Motivo ?? item.motivo ?? '',
    }))));
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
    return this.httpClient.get<Array<AdminUser & {
      idUsuario?: number; usuario?: string; nombrePersona?: string; fechaExpiracion?: string | null;
      estado?: string; dominioP?: string; dominio?: number; rol?: string; claveSegura?: string;
      modules?: string[]; isSuperAdmin?: boolean;
    }>>(`${API_ADMIN_URL}/users`).pipe(map((users) => users.map((user) => ({
      IdUsuario: user.IdUsuario ?? user.idUsuario ?? 0,
      Usuario: user.Usuario ?? user.usuario ?? '',
      NombrePersona: user.NombrePersona ?? user.nombrePersona ?? '',
      FechaExpiracion: user.FechaExpiracion ?? user.fechaExpiracion ?? null,
      Estado: user.Estado ?? user.estado ?? '',
      DominioP: user.DominioP ?? user.dominioP ?? '',
      Dominio: user.Dominio ?? user.dominio ?? 0,
      Rol: user.Rol ?? user.rol ?? '',
      ClaveSegura: user.ClaveSegura ?? user.claveSegura ?? '0',
      Modules: user.Modules ?? user.modules ?? [],
      IsSuperAdmin: user.IsSuperAdmin ?? user.isSuperAdmin ?? false,
    }))));
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