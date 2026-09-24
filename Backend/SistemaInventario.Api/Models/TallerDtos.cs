namespace SistemaInventario.Api.Models;

// Contratos del taller para representar recepción y las etapas de una reparación:
// ingreso, seguimiento, edición administrativa y salida.
public sealed record WorkshopDeviceDto(
    int IdEquipo,
    string CodigoInventario,
    string NoSerie,
    string Marca,
    string Modelo);

public sealed record MaintenanceDto(
    int IdReparacion,
    int IdEquipo,
    string CodigoInventario,
    string NoSerie,
    string Marca,
    string Modelo,
    int IdTecnico,
    string? Dictamen,
    string? TipoReparacion,
    string? DetalleReparacion,
    DateTime FechaIngreso,
    DateTime? FechaSalida);

public sealed record CreateMaintenanceEntryDto(
    int IdEquipo,
    string? Dictamen,
    string? TipoReparacion,
    DateTime FechaIngreso);

public sealed record CreateReceptionEntryDto(
    string CodigoInventario,
    string TipoDispositivo,
    string AreaOrigen,
    DateTime FechaIngreso);

public sealed record CreateMaintenanceExitDto(
    string? DetalleReparacion,
    DateTime FechaSalida);

public sealed record UpdateMaintenanceDto(
    int IdEquipo,
    string? Dictamen,
    string? TipoReparacion,
    DateTime FechaIngreso,
    string? DetalleReparacion,
    DateTime? FechaSalida);