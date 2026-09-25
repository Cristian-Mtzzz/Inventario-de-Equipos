namespace SistemaInventario.Api.Models;

// Contratos que viajan entre API y frontend. Separan datos de lectura de los
// campos permitidos al crear equipos, reasignaciones o usuarios.
public sealed record DeviceDto(
    int IdEquipo,
    string CodigoInventario,
    string NoSerie,
    string Marca,
    string Modelo,
    int? IdTipo,
    string? NombreTipo,
    string Estado,
    string? NumeroPagoAsignado,
    int? IdArea,
    string? NombreArea,
    string? AsignadoA,
    string? NombreAsignado,
    int? IdEdificio,
    string? NombreEdificio);

// Datos permitidos para crear o editar un equipo; no incluye campos calculados.
public sealed record CreateDeviceDto(
    string CodigoInventario,
    string NoSerie,
    string Marca,
    string Modelo,
    int? IdTipo,
    string Estado,
    string? NumeroPagoAsignado,
    string? NombreAsignado,
    int? IdArea);

// Catálogo utilizado por los selectores de tipo de dispositivo.
public sealed record DeviceTypeDto(int IdTipo, string NombreTipo);

// Catálogo de empleados disponible para asignar un equipo.
public sealed record EmployeeDto(string NoPago, string NombreCompleto, int? IdArea);

// Registro histórico de un cambio de responsable.
public sealed record ReassignmentDto(
    int IdReasignacion,
    int IdEquipo,
    string? NoPagoAnterior,
    string? NoPagoNuevo,
    DateTime FechaCambio,
    string Motivo);

// Datos necesarios para registrar una nueva reasignación.
public sealed record CreateReassignmentDto(
    int IdEquipo,
    string? NoPagoNuevo,
    string? NombreNuevo,
    string Motivo,
    int IdEdificio,
    int IdArea);

// Usuario que se muestra en la administración, sin exponer la contraseña.
public sealed record AdminUserDto(
    int IdUsuario,
    string Usuario,
    string NombrePersona,
    DateTime? FechaExpiracion,
    string Estado,
    string DominioP,
    int Dominio,
    string Rol,
    string ClaveSegura);

// Datos permitidos para dar de alta un usuario. La contraseña inicial se genera en el backend.
public sealed record CreateAdminUserDto(
    string Usuario,
    string NombrePersona,
    DateTime? FechaExpiracion,
    string Estado,
    string DominioP,
    int Dominio,
    string Rol);

// Catálogo de áreas donde puede ubicarse un equipo.
public sealed record AreaDto(int IdArea, string NombreArea);

// Edificio disponible para filtrar los departamentos/áreas del formulario.
public sealed record BuildingDto(int IdEdificio, string NombreEdificio);