import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { Maintenance, MaintenanceEditRequest, MaintenanceEntryRequest, MaintenanceExitRequest, ReceptionEntryRequest, WorkshopDevice } from './taller.models';

const API_TALLER_URL = '/api/taller';
const API_DEVICES_URL = '/api/admin/devices';

// Cliente HTTP de recepción y mantenimiento; adapta la respuesta de Oracle al frontend.
@Injectable({ providedIn: 'root' })
export class TallerService {
  constructor(private readonly httpClient: HttpClient) {}

  getDevices(): Observable<WorkshopDevice[]> {
    return this.httpClient.get<Array<WorkshopDevice & {
      idEquipo?: number; codigoInventario?: string; noSerie?: string; marca?: string; modelo?: string;
    }>>(`${API_DEVICES_URL}`).pipe(map((devices) => devices.map((device) => ({
      IdEquipo: device.IdEquipo ?? device.idEquipo ?? 0,
      CodigoInventario: device.CodigoInventario ?? device.codigoInventario ?? '',
      NoSerie: device.NoSerie ?? device.noSerie ?? '',
      Marca: device.Marca ?? device.marca ?? '',
      Modelo: device.Modelo ?? device.modelo ?? '',
    }))));
  }

  getMaintenances(): Observable<Maintenance[]> {
    return this.httpClient.get<Array<Maintenance & {
      idReparacion?: number; idEquipo?: number; codigoInventario?: string; noSerie?: string;
      marca?: string; modelo?: string; idTecnico?: number; dictamen?: string | null;
      tipoReparacion?: string | null; detalleReparacion?: string | null;
      fechaIngreso?: string; fechaSalida?: string | null;
    }>>(`${API_TALLER_URL}/maintenances`).pipe(map((items) => items.map((item) => ({
      IdReparacion: item.IdReparacion ?? item.idReparacion ?? 0,
      IdEquipo: item.IdEquipo ?? item.idEquipo ?? 0,
      CodigoInventario: item.CodigoInventario ?? item.codigoInventario ?? '',
      NoSerie: item.NoSerie ?? item.noSerie ?? '',
      Marca: item.Marca ?? item.marca ?? '',
      Modelo: item.Modelo ?? item.modelo ?? '',
      IdTecnico: item.IdTecnico ?? item.idTecnico ?? 0,
      Dictamen: item.Dictamen ?? item.dictamen ?? null,
      TipoReparacion: item.TipoReparacion ?? item.tipoReparacion ?? null,
      DetalleReparacion: item.DetalleReparacion ?? item.detalleReparacion ?? null,
      FechaIngreso: item.FechaIngreso ?? item.fechaIngreso ?? '',
      FechaSalida: item.FechaSalida ?? item.fechaSalida ?? null,
    }))));
  }

  createReceptionEntry(reception: ReceptionEntryRequest): Observable<void> {
    // Registra una recepción y permite crear el equipo si todavía no existe.
    return this.httpClient.post<void>(`${API_TALLER_URL}/reception`, reception);
  }

  createMaintenance(maintenance: MaintenanceEntryRequest): Observable<void> {
    return this.httpClient.post<void>(`${API_TALLER_URL}/maintenances`, maintenance);
  }

  updateMaintenance(idMantenimiento: number, maintenance: MaintenanceExitRequest): Observable<void> {
    // Cierra una reparación con fecha de salida y detalle del trabajo.
    return this.httpClient.put<void>(`${API_TALLER_URL}/maintenances/${idMantenimiento}`, maintenance);
  }

  editMaintenance(idMantenimiento: number, maintenance: MaintenanceEditRequest): Observable<void> {
    return this.httpClient.put<void>(`${API_TALLER_URL}/maintenances/${idMantenimiento}/edit`, maintenance);
  }

  deleteMaintenance(idMantenimiento: number): Observable<void> {
    return this.httpClient.delete<void>(`${API_TALLER_URL}/maintenances/${idMantenimiento}`);
  }
}