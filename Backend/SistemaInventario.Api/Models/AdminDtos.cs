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
    string? AsignadoA);

public sealed record CreateDeviceDto(
    string CodigoInventario,
    string NoSerie,
    string Marca,
    string Modelo,
    int? IdTipo,
    string Estado,
    string? NumeroPagoAsignado,
    int? IdArea);

public sealed record DeviceTypeDto(int IdTipo, string NombreTipo);

public sealed record EmployeeDto(string NoPago, string NombreCompleto, int? IdArea);

public sealed record ReassignmentDto(
    int IdReasignacion,
    int IdEquipo,
    string? NoPagoAnterior,
    string? NoPagoNuevo,
    DateTime FechaCambio,
    string Motivo);

public sealed record CreateReassignmentDto(
    int IdEquipo,
    string? NoPagoNuevo,
    string? NombreNuevo,
    string Motivo);

public sealed record AdminUserDto(int IdUsuario, string Usuario, string Rol);

public sealed record CreateAdminUserDto(string Usuario, string Password, string Rol);

public sealed record AreaDto(int IdArea, string NombreArea);