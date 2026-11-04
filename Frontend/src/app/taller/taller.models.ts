// Contratos del módulo Taller. Separan datos de consulta de los formularios
// usados para recepción, ingreso, salida y edición administrativa.
// Equipo que puede asociarse a una reparación.
export interface WorkshopDevice {
  IdEquipo: number;
  CodigoInventario: string;
  NoSerie: string;
  Marca: string;
  Modelo: string;
}

// Reparación completa tal como se muestra en la tabla del taller.
export interface Maintenance {
  IdReparacion: number;
  // Vacío cuando el ingreso vino por recepción: ese equipo no está en Dispositivos.
  IdEquipo: number | null;
  CodigoInventario: string;
  NoSerie: string;
  Marca: string;
  Modelo: string;
  IdTecnico: number;
  TipoDispositivo: string | null;
  Dictamen: string | null;
  TipoReparacion: string | null;
  DetalleReparacion: string | null;
  FechaIngreso: string;
  FechaSalida: string | null;
  MemoNumero: string | null;
  Recibe: string | null;
  Tecnico: string | null;
  Departamento: string | null;
  DescripcionEquipo: string | null;
  EquipoEnGarantia: string | null;
  PiezasSustituidas: string | null;
  Observaciones: string | null;
  EquipoFuncional: string | null;
  TecnicoEntrega: string | null;
  ClienteRecibe: string | null;
  FechaEntrega: string | null;
}

// Datos para abrir una reparación sobre un equipo existente.
export interface MaintenanceEntryRequest {
  IdEquipo: number;
  Dictamen: string;
  TipoReparacion: string;
  FechaIngreso: string;
}

// Datos de recepción; la fecha llega inicializada por el sistema y no por el usuario.
export interface ReceptionEntryRequest {
  CodigoInventario: string;
  NoSerie: string;
  Marca: string;
  Modelo: string;
  TipoDispositivo: string;
  DescripcionEquipo: string;
  EquipoEnGarantia: string;
  MemoNumero: string;
  Recibe: string;
  Tecnico: string;
  Departamento: string;
  IdEdificio: number;
  IdArea: number;
  FechaIngreso: string;
}

export interface MaintenanceAssessmentRequest {
  Dictamen: string;
  PiezasSustituidas: string;
  Observaciones: string;
  // SI o NO; lo indica quien hace el dictamen (técnico asignado o admin de taller).
  EquipoEnGarantia?: string;
}

// Información necesaria para cerrar una reparación.
export interface MaintenanceExitRequest {
  EquipoFuncional: string;
  ClienteRecibe: string;
  FechaEntrega: string;
}

// Usuario con rol de técnico de taller que se puede asignar a una reparación.
export interface WorkshopTechnician {
  IdUsuario: number;
  Nombre: string;
}

// Datos que la recepción completa sola (usuario que recibe y técnico por defecto).
export interface ReceptionDefaults {
  Recibe: string;
  Tecnico: string;
}
