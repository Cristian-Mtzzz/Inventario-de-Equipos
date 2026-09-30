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
    string? NombreEdificio,
    int? IdRegional,
    string? NombreRegional);

public sealed record PagedResult<T>(IReadOnlyList<T> Items, int TotalCount, int Page, int PageSize);

public sealed record DeviceOptionDto(int IdEquipo, string CodigoInventario, string NoSerie, string Marca, string Modelo);

public sealed record EmployeeSearchDto(
    string NoPago,
    string NombreCompleto,
    string Estado,
    int? IdArea,
    string? NombreArea,
    int? IdEdificio,
    string? NombreEdificio,
    int? IdRegional,
    string? NombreRegional,
    IReadOnlyList<EmployeeAssignedDeviceDto> AssignedDevices);

public sealed record UpdateEmployeeDto(string NombreCompleto, string? NoPago, int IdArea);

public sealed record EmployeeOptionDto(string NoPago, string NombreCompleto, int? IdArea);

public sealed record DirectoryEmployeeDto(string EmployeeKey, string NoPago, string NombreCompleto, int? IdArea);

/// <summary>Regional shown and maintained in the administrative catalog.</summary>
public sealed record RegionalDto(int IdRegional, string NombreRegional);

/// <summary>Editable regional name.</summary>
public sealed record SaveRegionalDto(string NombreRegional);

/// <summary>Department with its parent building and regional.</summary>
public sealed record CatalogDepartmentDto(
    int IdArea,
    string NombreArea,
    int IdEdificio,
    string NombreEdificio,
    int? IdRegional,
    string? NombreRegional);

/// <summary>Editable department name and parent building.</summary>
public sealed record SaveDepartmentDto(string NombreArea, int IdEdificio);

/// <summary>Editable building name and parent regional.</summary>
public sealed record SaveBuildingDto(string NombreEdificio, int IdRegional);

/// <summary>Employee data maintained in the administrative catalog.</summary>
public sealed record SaveDirectoryEmployeeDto(string? NoPago, string NombreCompleto, int IdArea);

public sealed record EmployeeAssignedDeviceDto(
    int IdEquipo,
    string CodigoInventario,
    string NoSerie,
    string Marca,
    string Modelo,
    int? IdTipo,
    string? NombreTipo,
    string Estado,
    string? NumeroPagoAsignado,
    string? NombreAsignado,
    int? IdArea,
    string? NombreArea,
    int? IdEdificio,
    string? NombreEdificio,
    int? IdRegional,
    string? NombreRegional);

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

// Registro histórico de un cambio de responsable.
public sealed record ReassignmentDto(
    int IdReasignacion,
    int IdEquipo,
    string CodigoInventario,
    string? NoPagoAnterior,
    string? NoPagoNuevo,
    string? NombreEdificio,
    string? NombreArea,
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
    string ClaveSegura,
    IReadOnlyList<string> Modules,
    bool IsSuperAdmin);

// Datos permitidos para dar de alta un usuario. La contraseña inicial se genera en el backend.
public sealed record CreateAdminUserDto(
    string Usuario,
    string NombrePersona,
    DateTime? FechaExpiracion,
    string Estado,
    string DominioP,
    int Dominio,
    string Rol,
    IReadOnlyList<string> Modules,
    bool IsSuperAdmin);

public sealed record UpdateAdminUserDto(
    string NombrePersona,
    DateTime? FechaExpiracion,
    string Estado,
    string DominioP,
    int Dominio,
    string Rol,
    IReadOnlyList<string> Modules,
    bool IsSuperAdmin);

// Catálogo de áreas donde puede ubicarse un equipo.
public sealed record AreaDto(int IdArea, string NombreArea);

// Edificio disponible para filtrar los departamentos/áreas del formulario.
public sealed record BuildingDto(int IdEdificio, string NombreEdificio, int? IdRegional, string? NombreRegional);