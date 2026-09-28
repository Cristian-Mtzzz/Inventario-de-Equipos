// Modelos compartidos por formularios, tablas y servicios administrativos.
// Cada propiedad conserva el nombre de la columna o DTO que usa el backend.
// Equipo que se muestra en la tabla de inventario.
export interface Device {
  IdEquipo: number;
  CodigoInventario: string;
  NoSerie: string;
  Marca: string;
  Modelo: string;
  IdTipo: number | null;
  NombreTipo: string | null;
  Estado: string;
  NumeroPagoAsignado: string | null;
  NombreAsignado: string | null;
  IdArea: number | null;
  NombreArea: string | null;
  AsignadoA: string | null;
  IdEdificio: number | null;
  NombreEdificio: string | null;
  IdRegional: number | null;
  NombreRegional: string | null;
}

export interface PagedResult<T> {
  Items: T[];
  TotalCount: number;
  Page: number;
  PageSize: number;
}

export interface DevicePageQuery {
  Page: number;
  SearchTerm: string;
  Brand: string;
  Model: string;
  TypeId: number | null;
  RegionalId: number | null;
  BuildingId: number | null;
  AreaId: number | null;
}

export interface DeviceOption {
  IdEquipo: number;
  CodigoInventario: string;
  Marca: string;
  Modelo: string;
}

// Datos mínimos que se envían al crear o editar un equipo.
export interface CreateDevice {
  CodigoInventario: string;
  NoSerie: string;
  Marca: string;
  Modelo: string;
  IdTipo: number | null;
  Estado: string;
  NumeroPagoAsignado: string | null;
  NombreAsignado: string | null;
  IdArea: number | null;
}

// Catálogo de áreas disponibles para ubicar un equipo.
export interface Area {
  IdArea: number;
  NombreArea: string;
  IdEdificio: number;
}

// Edificio utilizado para limitar el catálogo de áreas disponibles.
export interface Building {
  IdEdificio: number;
  NombreEdificio: string;
  IdRegional: number | null;
  NombreRegional: string | null;
}

export interface EmployeeSearchResult {
  NoPago: string;
  NombreCompleto: string;
  Estado: string;
  IdArea: number | null;
  NombreArea: string | null;
  IdEdificio: number | null;
  NombreEdificio: string | null;
  IdRegional: number | null;
  NombreRegional: string | null;
  AssignedDevices: EmployeeAssignedDevice[];
}

export interface EmployeeAssignedDevice extends Device {
  NumeroPagoAsignado: string | null;
}

// Registro histórico de una reasignación ya guardada.
export interface Reassignment {
  IdReasignacion: number;
  IdEquipo: number;
  CodigoInventario: string;
  NoPagoAnterior: string | null;
  NoPagoNuevo: string | null;
  FechaCambio: string;
  Motivo: string;
}

// Formulario de reasignación; número y nombre son independientes y opcionales.
export interface CreateReassignment {
  IdEquipo: number;
  NoPagoNuevo: string | null;
  NombreNuevo: string;
  Motivo: string;
  IdEdificio: number;
  IdArea: number;
}

// Usuario listado en la administración, sin exponer su contraseña.
export interface AdminUser {
  IdUsuario: number;
  Usuario: string;
  NombrePersona: string;
  FechaExpiracion: string | null;
  Estado: string;
  DominioP: string;
  Dominio: number;
  Rol: string;
  ClaveSegura: string;
}

// Datos necesarios para crear un usuario; la contraseña inicial se genera en backend.
export interface CreateAdminUser {
  Usuario: string;
  NombrePersona: string;
  FechaExpiracion: string | null;
  Estado: string;
  DominioP: string;
  Dominio: number;
  Rol: string;
}

export type UpdateAdminUser = Omit<CreateAdminUser, 'Usuario'>;

// Tipo de equipo usado por los selectores de inventario y recepción.
export interface DeviceType {
  IdTipo: number;
  NombreTipo: string;
}

