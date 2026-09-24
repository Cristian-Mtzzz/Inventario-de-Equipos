import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { map, Observable, shareReplay } from 'rxjs';
import { AdminUser, Area, CreateAdminUser, CreateDevice, CreateReassignment, Device, DeviceType, Employee, Reassignment } from './admin.models';

const API_ADMIN_URL = '/api/admin';

// Cliente HTTP del módulo Admin. Centraliza las URLs, transforma respuestas del
// backend al modelo usado por las vistas y cachea catálogos que cambian poco.
@Injectable({ providedIn: 'root' })
export class AdminService {
  private deviceTypesCache$?: Observable<DeviceType[]>;
  private areasCache$?: Observable<Area[]>;
  private employeesCache$?: Observable<Employee[]>;

  constructor(private readonly httpClient: HttpClient) {}

  getDevices(): Observable<Device[]> {
    // Obtiene equipos y transforma nombres de propiedades para el modelo del frontend.
    return this.httpClient.get<Array<Device & {
      idEquipo?: number; codigoInventario?: string; noSerie?: string; marca?: string;
      modelo?: string; idTipo?: number | null; estado?: string;
      numeroPagoAsignado?: string | null; idArea?: number | null;
      nombreTipo?: string | null; nombreArea?: string | null; asignadoA?: string | null;
    }>>(`${API_ADMIN_URL}/devices`).pipe(map((devices) => devices.map((device) => ({
      IdEquipo: device.IdEquipo ?? device.idEquipo ?? 0,
      CodigoInventario: device.CodigoInventario ?? device.codigoInventario ?? '',
      NoSerie: device.NoSerie ?? device.noSerie ?? '',
      Marca: device.Marca ?? device.marca ?? '',
      Modelo: device.Modelo ?? device.modelo ?? '',
      IdTipo: device.IdTipo ?? device.idTipo ?? null,
      NombreTipo: device.NombreTipo ?? device.nombreTipo ?? null,
      Estado: device.Estado ?? device.estado ?? '',
      NumeroPagoAsignado: device.NumeroPagoAsignado ?? device.numeroPagoAsignado ?? null,
      IdArea: device.IdArea ?? device.idArea ?? null,
      NombreArea: device.NombreArea ?? device.nombreArea ?? null,
      AsignadoA: device.AsignadoA ?? device.asignadoA ?? null,
    }))));
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

  getAreas(): Observable<Area[]> {
    // Obtiene áreas para asociarlas a equipos y reasignaciones.
    if (this.areasCache$) return this.areasCache$;
    this.areasCache$ = this.httpClient.get<Array<Area & { idArea?: number; nombreArea?: string }>>(`${API_ADMIN_URL}/areas`).pipe(
      map((areas) => areas.map((area) => ({
        IdArea: area.IdArea ?? area.idArea ?? 0,
        NombreArea: area.NombreArea ?? area.nombreArea ?? '',
      }))),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.areasCache$;
  }

  getEmployees(): Observable<Employee[]> {
    // Obtiene el catálogo de empleados usado por asignaciones conocidas.
    if (this.employeesCache$) return this.employeesCache$;
    this.employeesCache$ = this.httpClient.get<Array<Employee & { noPago?: string; nombreCompleto?: string; idArea?: number | null }>>(`${API_ADMIN_URL}/employees`).pipe(
      map((employees) => employees.map((employee) => ({
        NoPago: employee.NoPago ?? employee.noPago ?? '',
        NombreCompleto: employee.NombreCompleto ?? employee.nombreCompleto ?? '',
        IdArea: employee.IdArea ?? employee.idArea ?? null,
      }))),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.employeesCache$;
  }

  createDevice(device: CreateDevice): Observable<void> {
    // Solicita al backend insertar un dispositivo nuevo.
    return this.httpClient.post<void>(`${API_ADMIN_URL}/devices`, device);
  }

  updateDevice(idEquipo: number, device: CreateDevice): Observable<void> {
    // Persiste los cambios de un dispositivo existente.
    return this.httpClient.put<void>(`${API_ADMIN_URL}/devices/${idEquipo}`, device);
  }

  deleteDevice(idEquipo: number): Observable<void> {
    // Solicita eliminar el equipo y sus relaciones permitidas.
    return this.httpClient.delete<void>(`${API_ADMIN_URL}/devices/${idEquipo}`);
  }

  getReassignments(): Observable<Reassignment[]> {
    // Consulta el historial de cambios de responsable.
    return this.httpClient.get<Array<Reassignment & {
      idReasignacion?: number; idEquipo?: number; noPagoAnterior?: string | null;
      noPagoNuevo?: string | null; fechaCambio?: string; motivo?: string;
    }>>(`${API_ADMIN_URL}/reassignments`).pipe(map((items) => items.map((item) => ({
      IdReasignacion: item.IdReasignacion ?? item.idReasignacion ?? 0,
      IdEquipo: item.IdEquipo ?? item.idEquipo ?? 0,
      NoPagoAnterior: item.NoPagoAnterior ?? item.noPagoAnterior ?? null,
      NoPagoNuevo: item.NoPagoNuevo ?? item.noPagoNuevo ?? null,
      FechaCambio: item.FechaCambio ?? item.fechaCambio ?? '',
      Motivo: item.Motivo ?? item.motivo ?? '',
    }))));
  }

  createReassignment(reassignment: CreateReassignment): Observable<void> {
    // Registra el cambio de responsable y permite nombre sin número de pago.
    return this.httpClient.post<void>(`${API_ADMIN_URL}/reassignments`, reassignment);
  }

  getUsers(): Observable<AdminUser[]> {
    // Consulta los usuarios que el administrador puede gestionar.
    return this.httpClient.get<Array<AdminUser & {
      idUsuario?: number; usuario?: string; rol?: string;
    }>>(`${API_ADMIN_URL}/users`).pipe(map((users) => users.map((user) => ({
      IdUsuario: user.IdUsuario ?? user.idUsuario ?? 0,
      Usuario: user.Usuario ?? user.usuario ?? '',
      Rol: user.Rol ?? user.rol ?? '',
    }))));
  }

  createUser(user: CreateAdminUser): Observable<void> {
    return this.httpClient.post<void>(`${API_ADMIN_URL}/users`, user);
  }

  deleteUser(idUsuario: number): Observable<void> {
    return this.httpClient.delete<void>(`${API_ADMIN_URL}/users/${idUsuario}`);
  }
}