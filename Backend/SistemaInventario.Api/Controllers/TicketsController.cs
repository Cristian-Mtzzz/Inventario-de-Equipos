using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SistemaInventario.Api.Infrastructure;
using SistemaInventario.Api.Models;
using SistemaInventario.Api.Services;

namespace SistemaInventario.Api.Controllers;

[ApiController]
[Authorize(Policy = ModulePolicies.Tickets)]
[Route("api/tickets")]
// Módulo Tickets de soporte. El administrador crea, edita y reasigna; el técnico solo
// finaliza los tickets que tiene asignados, confirmando el No. de pago del empleado.
public sealed class TicketsController(ITicketService ticketService) : ControllerBase
{
    private const string TicketNotFound = "No se encontró el ticket indicado.";

    [HttpGet]
    [Authorize(Roles = AppRoles.TicketUsers)]
    // El técnico ve solo lo suyo; el administrador ve todos los tickets.
    public async Task<ActionResult<IReadOnlyList<TicketDto>>> GetTickets(CancellationToken cancellationToken)
    {
        if (IsManager) return Ok(await ticketService.GetTickets(null, cancellationToken));
        if (User.GetUserId() is not { } userId) return BadRequest(new { Message = "No se pudo identificar al técnico." });
        return Ok(await ticketService.GetTickets(userId, cancellationToken));
    }

    [HttpGet("technicians")]
    [Authorize(Roles = AppRoles.TicketManagers)]
    public async Task<ActionResult<IReadOnlyList<TicketTechnicianDto>>> GetTechnicians(CancellationToken cancellationToken) =>
        Ok(await ticketService.GetTechnicians(cancellationToken));

    [HttpGet("alert-thresholds")]
    [Authorize(Roles = AppRoles.TicketUsers)]
    // Minutos en que el ticket pendiente pasa de verde a amarillo y de amarillo a rojo.
    // Salen de TICKETS_CONFIG para poder ajustarlos sin volver a publicar la aplicación.
    public async Task<ActionResult<TicketAlertThresholdsDto>> GetAlertThresholds(CancellationToken cancellationToken) =>
        Ok(await ticketService.GetAlertThresholds(cancellationToken));

    [HttpPost]
    [Authorize(Roles = AppRoles.TicketManagers)]
    // La fecha y hora las pone el servidor; el formulario no las manda.
    public async Task<IActionResult> CreateTicket(CreateTicketDto ticket, CancellationToken cancellationToken)
    {
        if (Validate(ticket.IdEmpleado, ticket.Detalle, ticket.IdTecnico, ticket.TipoSoporte) is { } message)
        {
            return BadRequest(new { Message = message });
        }
        if (User.GetUserId() is not { } userId) return BadRequest(new { Message = "No se pudo identificar al usuario." });

        await ticketService.CreateTicket(ticket, userId, cancellationToken);
        return NoContent();
    }

    [HttpPut("{idTicket:int}")]
    [Authorize(Roles = AppRoles.TicketManagers)]
    public async Task<IActionResult> UpdateTicket(int idTicket, UpdateTicketDto ticket, CancellationToken cancellationToken)
    {
        if (idTicket <= 0) return BadRequest(new { Message = "El ticket no es válido." });
        if (Validate(ticket.IdEmpleado, ticket.Detalle, ticket.IdTecnico, ticket.TipoSoporte) is { } message)
        {
            return BadRequest(new { Message = message });
        }

        return await ticketService.UpdateTicket(idTicket, ticket, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "No se encontró un ticket abierto con ese número." });
    }

    [HttpPut("{idTicket:int}/technician")]
    [Authorize(Roles = AppRoles.TicketManagers)]
    public async Task<IActionResult> ReassignTicket(
        int idTicket,
        ReassignTicketDto reassignment,
        CancellationToken cancellationToken)
    {
        if (idTicket <= 0 || reassignment.IdTecnico <= 0) return BadRequest(new { Message = "Selecciona un técnico." });
        return await ticketService.ReassignTicket(idTicket, reassignment.IdTecnico, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "No se encontró un ticket abierto con ese número." });
    }

    [HttpPut("{idTicket:int}/finish")]
    [Authorize(Roles = AppRoles.TicketUsers)]
    // La hora de finalización la pone el servidor al cerrar.
    public async Task<IActionResult> FinishTicket(int idTicket, FinishTicketDto finish, CancellationToken cancellationToken)
    {
        if (idTicket <= 0) return BadRequest(new { Message = "El ticket no es válido." });
        if (string.IsNullOrWhiteSpace(finish.NoPago))
        {
            return BadRequest(new { Message = "Ingresa el No. de pago del empleado para confirmar el servicio." });
        }
        if (finish.Valoracion is not ("BUENO" or "MALO"))
        {
            return BadRequest(new { Message = "Indica si la ayuda fue buena o mala." });
        }
        if (finish.Observaciones?.Length > 2000)
        {
            return BadRequest(new { Message = "Las observaciones no pueden superar 2000 caracteres." });
        }
        if (User.GetUserId() is not { } userId) return BadRequest(new { Message = "No se pudo identificar al técnico." });

        return await ticketService.FinishTicket(idTicket, finish, userId, IsManager, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = TicketNotFound });
    }

    private bool IsManager =>
        User.IsInRole(AppRoles.Admin) || User.IsInRole(AppRoles.AdminTicket);

    private static string? Validate(int idEmpleado, string detalle, int idTecnico, string? tipoSoporte)
    {
        if (idEmpleado <= 0) return "Selecciona al empleado que solicita el soporte.";
        if (!TicketSupportTypes.All.Contains(tipoSoporte?.Trim().ToUpperInvariant()))
        {
            return "Selecciona el tipo de soporte: aplicativo, redes o hardware.";
        }
        if (string.IsNullOrWhiteSpace(detalle)) return "Describe la solicitud.";
        if (detalle.Length > 2000) return "El detalle no puede superar 2000 caracteres.";
        if (idTecnico <= 0) return "Selecciona el técnico que atenderá la solicitud.";
        return null;
    }
}
