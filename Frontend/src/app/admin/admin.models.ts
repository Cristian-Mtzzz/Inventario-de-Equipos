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
  IdArea: number | null;
  NombreArea: string | null;
  AsignadoA: string | null;
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
  IdArea: number | null;
}

// Catálogo de áreas disponibles para ubicar un equipo.
export interface Area {
  IdArea: number;
  NombreArea: string;
}

// Registro histórico de una reasignación ya guardada.
export interface Reassignment {
  IdReasignacion: number;
  IdEquipo: number;
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
}

// Usuario listado en la administración, sin exponer su contraseña.
export interface AdminUser {
  IdUsuario: number;
  Usuario: string;
  Rol: string;
}

// Datos necesarios para crear un usuario y asignarle un rol.
export interface CreateAdminUser {
  Usuario: string;
  Password: string;
  Rol: string;
}

// Tipo de equipo usado por los selectores de inventario y recepción.
export interface DeviceType {
  IdTipo: number;
  NombreTipo: string;
}

// Empleado empresarial usado para sugerir número de pago y área.
export interface Employee {
  NoPago: string;
  NombreCompleto: string;
  IdArea: number | null;
}