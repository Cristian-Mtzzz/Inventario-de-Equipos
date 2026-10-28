// Contratos del módulo Tickets de soporte: creación por el administrador, reasignación
// a otro técnico y cierre con la confirmación del No. de pago del empleado atendido.

export interface Ticket {
  IdTicket: number;
  FechaCreacion: string;
  FechaFinalizacion: string | null;
  // Minutos entre creación y finalización; vacío mientras el ticket siga abierto.
  MinutosTranscurridos: number | null;
  IdEmpleado: number;
  Empleado: string;
  Region: string | null;
  Edificio: string | null;
  Departamento: string | null;
  Detalle: string;
  IdTecnico: number;
  Tecnico: string | null;
  Estado: string;
  Observaciones: string | null;
  Valoracion: string | null;
  // APLICATIVO, REDES o HARDWARE; vacío en los tickets creados antes de pedir el tipo.
  TipoSoporte: string | null;
}

export interface TicketTechnician {
  IdUsuario: number;
  Nombre: string;
}

export interface CreateTicketRequest {
  IdEmpleado: number;
  Detalle: string;
  IdTecnico: number;
  TipoSoporte: TicketSupportType | '';
}

// Tipos de soporte que se pueden elegir al crear o editar el ticket.
export type TicketSupportType = 'APLICATIVO' | 'REDES' | 'HARDWARE';

export const TICKET_SUPPORT_TYPES: { value: TicketSupportType; label: string }[] = [
  { value: 'APLICATIVO', label: 'Soporte aplicativo' },
  { value: 'REDES', label: 'Soporte de redes' },
  { value: 'HARDWARE', label: 'Soporte de hardware' },
];

export interface FinishTicketRequest {
  NoPago: string;
  Observaciones: string;
  Valoracion: 'BUENO' | 'MALO' | '';
}

// Minutos en que un ticket pendiente pasa de verde a amarillo y de amarillo a rojo.
// Se configuran en la tabla TICKETS_CONFIG, no en la aplicación.
export interface TicketAlertThresholds {
  MinutosVerde: number;
  MinutosAmarillo: number;
}
