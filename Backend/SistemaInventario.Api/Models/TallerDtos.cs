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
    string? TipoDispositivo,
    string? Dictamen,
    string? TipoReparacion,
    string? DetalleReparacion,
    DateTime FechaIngreso,
    DateTime? FechaSalida,
    string? MemoNumero,
    string? Recibe,
    string? Tecnico,
    string? Departamento,
    string? DescripcionEquipo,
    string? EquipoEnGarantia,
    string? PiezasSustituidas,
    string? Observaciones,
    string? EquipoFuncional,
    string? TecnicoEntrega,
    string? ClienteRecibe,
    DateTime? FechaEntrega);

public sealed record CreateMaintenanceEntryDto(
    int IdEquipo,
    string? Dictamen,
    string? TipoReparacion,
    DateTime FechaIngreso);

public sealed record CreateReceptionEntryDto(
    string CodigoInventario,
    string NoSerie,
    string TipoDispositivo,
    string DescripcionEquipo,
    string EquipoEnGarantia,
    string? MemoNumero,
    string Recibe,
    string Tecnico,
    string Departamento,
    int IdEdificio,
    int IdArea,
    DateTime FechaIngreso);

public sealed record UpdateMaintenanceAssessmentDto(
    string? Dictamen,
    string? PiezasSustituidas,
    string? Observaciones);

public sealed record UpdateMaintenanceExitDto(
    string EquipoFuncional,
    string TecnicoEntrega,
    string ClienteRecibe,
    DateTime FechaEntrega);

public sealed record UpdateMaintenanceDto(
    int IdEquipo,
    string? Dictamen,
    string? TipoReparacion,
    DateTime FechaIngreso,
    string? DetalleReparacion,
    DateTime? FechaSalida);