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
  IdEquipo: number;
  CodigoInventario: string;
  NoSerie: string;
  Marca: string;
  Modelo: string;
  IdTecnico: number;
  Dictamen: string | null;
  TipoReparacion: string | null;
  DetalleReparacion: string | null;
  FechaIngreso: string;
  FechaSalida: string | null;
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
  TipoDispositivo: string;
  AreaOrigen: string;
  FechaIngreso: string;
}

// Información necesaria para cerrar una reparación.
export interface MaintenanceExitRequest {
  DetalleReparacion: string;
  FechaSalida: string;
}

// Modelo completo usado por Admin para corregir una reparación.
export interface MaintenanceEditRequest {
  IdEquipo: number;
  Dictamen: string;
  TipoReparacion: string;
  FechaIngreso: string;
  DetalleReparacion: string;
  FechaSalida: string | null;
}