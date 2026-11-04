namespace SistemaInventario.Api.Models;

// Contratos del módulo Tickets de soporte: creación por parte del administrador,
// reasignación a otro técnico y cierre con verificación del No. de pago del empleado.

/// <summary>Ticket tal como lo muestra la tabla, con la ubicación del empleado atendido.</summary>
public sealed record TicketDto(
    int IdTicket,
    DateTime FechaCreacion,
    DateTime? FechaFinalizacion,
    // Minutos entre la creación y la finalización; nulo mientras el ticket siga abierto.
    int? MinutosTranscurridos,
    int IdEmpleado,
    string Empleado,
    string? Region,
    string? Edificio,
    string? Departamento,
    string Detalle,
    int IdTecnico,
    string? Tecnico,
    string Estado,
    string? Observaciones,
    string? Valoracion,
    // APLICATIVO, REDES o HARDWARE; nulo en los tickets creados antes de pedir el tipo.
    string? TipoSoporte);

/// <summary>Usuario con rol de técnico de tickets al que se le puede asignar trabajo.</summary>
public sealed record TicketTechnicianDto(int IdUsuario, string Nombre);

// TipoSoporte: APLICATIVO, REDES o HARDWARE (ver TicketSupportTypes).
public sealed record CreateTicketDto(int IdEmpleado, string Detalle, int IdTecnico, string? TipoSoporte);

/// <summary>Cambios que el administrador puede hacer sobre un ticket abierto.</summary>
public sealed record UpdateTicketDto(int IdEmpleado, string Detalle, int IdTecnico, string? TipoSoporte);

/// <summary>Tipos de soporte que admite el ticket (restricción CK_TICKETS_TIPO_SOPORTE).</summary>
public static class TicketSupportTypes
{
    public static readonly string[] All = ["APLICATIVO", "REDES", "HARDWARE"];
}

public sealed record ReassignTicketDto(int IdTecnico);

/// <summary>Cierre del ticket: el No. de pago confirma que el servicio se dio.</summary>
public sealed record FinishTicketDto(string NoPago, string? Observaciones, string Valoracion);

/// <summary>
/// Minutos a partir de los cuales un ticket pendiente cambia de color en la tabla.
/// Se guardan en TICKETS_CONFIG para poder ajustarlos sin tocar la aplicación.
/// </summary>
public sealed record TicketAlertThresholdsDto(int MinutosVerde, int MinutosAmarillo);
