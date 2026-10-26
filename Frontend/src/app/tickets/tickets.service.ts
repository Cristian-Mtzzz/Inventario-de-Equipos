import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { apiUrl } from '../api-url';
import { toPascalCase } from '../shared/api-response';
import { CreateTicketRequest, FinishTicketRequest, Ticket, TicketAlertThresholds, TicketEmployee, TicketTechnician } from './tickets.models';

const API_TICKETS_URL = apiUrl('tickets');

// Cliente HTTP del módulo Tickets de soporte.
@Injectable({ providedIn: 'root' })
export class TicketsService {
  constructor(private readonly httpClient: HttpClient) { }

  // El backend decide el alcance: el técnico recibe solo sus tickets y el admin todos.
  getTickets(): Observable<Ticket[]> {
    return this.httpClient.get<unknown>(API_TICKETS_URL).pipe(map((body) => toPascalCase<Ticket[]>(body)));
  }

  getEmployees(idArea: number): Observable<TicketEmployee[]> {
    const params = new HttpParams().set('idArea', idArea);
    return this.httpClient.get<unknown>(`${API_TICKETS_URL}/employees`, { params })
      .pipe(map((body) => toPascalCase<TicketEmployee[]>(body)));
  }

  // Umbrales de color del ticket pendiente; vienen de la base para poder ajustarlos.
  getAlertThresholds(): Observable<TicketAlertThresholds> {
    return this.httpClient.get<unknown>(`${API_TICKETS_URL}/alert-thresholds`)
      .pipe(map((body) => toPascalCase<TicketAlertThresholds>(body)));
  }

  getTechnicians(): Observable<TicketTechnician[]> {
    return this.httpClient.get<unknown>(`${API_TICKETS_URL}/technicians`)
      .pipe(map((body) => toPascalCase<TicketTechnician[]>(body)));
  }

  // La fecha y hora de creación las pone el servidor.
  createTicket(ticket: CreateTicketRequest): Observable<void> {
    return this.httpClient.post<void>(API_TICKETS_URL, ticket);
  }

  updateTicket(idTicket: number, ticket: CreateTicketRequest): Observable<void> {
    return this.httpClient.put<void>(`${API_TICKETS_URL}/${idTicket}`, ticket);
  }

  reassignTicket(idTicket: number, idTecnico: number): Observable<void> {
    return this.httpClient.put<void>(`${API_TICKETS_URL}/${idTicket}/technician`, { IdTecnico: idTecnico });
  }

  // Si el No. de pago no coincide con el del empleado, la API responde con el error
  // y el ticket se queda abierto.
  finishTicket(idTicket: number, finish: FinishTicketRequest): Observable<void> {
    return this.httpClient.put<void>(`${API_TICKETS_URL}/${idTicket}/finish`, finish);
  }
}
