import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { apiUrl } from '../api-url';
import { toPascalCase } from '../shared/api-response';
import { Maintenance, MaintenanceAssessmentRequest, MaintenanceEditRequest, MaintenanceEntryRequest, MaintenanceExitRequest, ReceptionDefaults, ReceptionEntryRequest, WorkshopDevice, WorkshopTechnician } from './taller.models';

const API_TALLER_URL = apiUrl('taller');

// Cliente HTTP de recepción y mantenimiento; adapta la respuesta de Oracle al frontend.
@Injectable({ providedIn: 'root' })
export class TallerService {
  constructor(private readonly httpClient: HttpClient) { }

  getDevices(): Observable<WorkshopDevice[]> {
    return this.httpClient.get<unknown>(`${API_TALLER_URL}/devices`)
      .pipe(map((body) => toPascalCase<WorkshopDevice[]>(body)));
  }
  // Obtiene la lista de mantenimientos del taller.
  getMaintenances(): Observable<Maintenance[]> {
    return this.httpClient.get<unknown>(`${API_TALLER_URL}/maintenances`)
      .pipe(map((body) => toPascalCase<Maintenance[]>(body)));
  }
  // Registra una recepción de equipo en el taller.
  createReceptionEntry(reception: ReceptionEntryRequest): Observable<void> {
    // Registra una recepción y permite crear el equipo si todavía no existe.
    return this.httpClient.post<void>(`${API_TALLER_URL}/reception`, reception);
  }
  // Crea una nueva reparación en el taller.
  createMaintenance(maintenance: MaintenanceEntryRequest): Observable<void> {
    return this.httpClient.post<void>(`${API_TALLER_URL}/maintenances`, maintenance);
  }
  // Actualiza la información de una reparación existente, incluyendo la fecha de salida y el detalle del trabajo.
  updateMaintenance(idMantenimiento: number, maintenance: MaintenanceExitRequest): Observable<void> {
    // Registra el estado y las firmas de entrega del equipo reparado.
    return this.httpClient.put<void>(`${API_TALLER_URL}/maintenances/${idMantenimiento}`, maintenance);
  }
  updateAssessment(idMantenimiento: number, assessment: MaintenanceAssessmentRequest): Observable<void> {
    return this.httpClient.put<void>(`${API_TALLER_URL}/maintenances/${idMantenimiento}/assessment`, assessment);
  }
  // Edita la información de una reparación existente.
  editMaintenance(idMantenimiento: number, maintenance: MaintenanceEditRequest): Observable<void> {
    return this.httpClient.put<void>(`${API_TALLER_URL}/maintenances/${idMantenimiento}/edit`, maintenance);
  }
  // Quién recibe (usuario en sesión) y técnico asignado por defecto para el formulario de recepción.
  getReceptionDefaults(): Observable<ReceptionDefaults> {
    return this.httpClient.get<unknown>(`${API_TALLER_URL}/reception-defaults`)
      .pipe(map((body) => toPascalCase<ReceptionDefaults>(body)));
  }
  // Técnicos activos (rol TecnicoTaller) que se pueden asignar a una reparación.
  getTechnicians(): Observable<WorkshopTechnician[]> {
    return this.httpClient.get<unknown>(`${API_TALLER_URL}/technicians`)
      .pipe(map((body) => toPascalCase<WorkshopTechnician[]>(body)));
  }
  // Asigna el técnico a la reparación (actualiza el campo Técnico).
  assignTechnician(idMantenimiento: number, idUsuario: number): Observable<void> {
    return this.httpClient.put<void>(`${API_TALLER_URL}/maintenances/${idMantenimiento}/technician`, { IdUsuario: idUsuario });
  }
  // Elimina una reparación existente del taller.
  deleteMaintenance(idMantenimiento: number): Observable<void> {
    return this.httpClient.delete<void>(`${API_TALLER_URL}/maintenances/${idMantenimiento}`);
  }
}
