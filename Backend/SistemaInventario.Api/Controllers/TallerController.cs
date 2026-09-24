using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
using SistemaInventario.Api.Models;
using SistemaInventario.Api.Services;

namespace SistemaInventario.Api.Controllers;

[ApiController]
[Authorize(Roles = "Taller,Admin")]
[Route("api/taller")]
// Fachada HTTP del taller: protege recepción y reparaciones con roles Taller/Admin
// y traduce las acciones de la interfaz a operaciones del TallerService.
public sealed class TallerController(ITallerService tallerService) : ControllerBase
{
    [HttpGet("devices")]
    public async Task<ActionResult<IReadOnlyList<WorkshopDeviceDto>>> GetDevices(CancellationToken cancellationToken) =>
        Ok(await tallerService.GetDevices(cancellationToken));

    [HttpGet("maintenances")]
    public async Task<ActionResult<IReadOnlyList<MaintenanceDto>>> GetMaintenances(CancellationToken cancellationToken) =>
        Ok(await tallerService.GetMaintenances(cancellationToken));

    [HttpPost("reception")]
    // Registra la recepción y valida los datos mínimos antes de tocar Oracle.
    public async Task<IActionResult> RegisterReception(CreateReceptionEntryDto reception, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(reception.CodigoInventario)) return BadRequest(new { Message = "Ingresa el número de inventario." });
        if (string.IsNullOrWhiteSpace(reception.TipoDispositivo)) return BadRequest(new { Message = "Indica el tipo de dispositivo." });
        if (string.IsNullOrWhiteSpace(reception.AreaOrigen)) return BadRequest(new { Message = "Indica el área de origen o envío del equipo." });
        if (reception.FechaIngreso == default) return BadRequest(new { Message = "La fecha de ingreso es obligatoria." });

        await tallerService.RegisterReception(reception, cancellationToken);
        return NoContent();
    }

    [HttpPost("maintenances")]
    // Crea una reparación usando el usuario autenticado como técnico.
    public async Task<IActionResult> CreateMaintenance(CreateMaintenanceEntryDto maintenance, CancellationToken cancellationToken)
    {
        if (maintenance.IdEquipo <= 0) return BadRequest(new { Message = "Selecciona un equipo." });
        if (maintenance.FechaIngreso == default) return BadRequest(new { Message = "Indica la fecha de ingreso." });
        if (!int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"), out var idTecnico))
        {
            return BadRequest(new { Message = "No se pudo identificar al técnico." });
        }
        await tallerService.CreateMaintenance(idTecnico, maintenance, cancellationToken);
        return NoContent();
    }

    [HttpPut("maintenances/{idMantenimiento:int}")]
    public async Task<IActionResult> UpdateMaintenance(int idMantenimiento, CreateMaintenanceExitDto maintenance, CancellationToken cancellationToken)
    {
        if (idMantenimiento <= 0) return BadRequest(new { Message = "El mantenimiento no es válido." });
        if (maintenance.FechaSalida == default) return BadRequest(new { Message = "Indica la fecha de salida." });
        await tallerService.UpdateMaintenance(idMantenimiento, maintenance, cancellationToken);
        return NoContent();
    }

    [Authorize(Roles = "Admin")]
    [HttpPut("maintenances/{idMantenimiento:int}/edit")]
    public async Task<IActionResult> EditMaintenance(int idMantenimiento, UpdateMaintenanceDto maintenance, CancellationToken cancellationToken)
    {
        if (idMantenimiento <= 0 || maintenance.IdEquipo <= 0) return BadRequest(new { Message = "Los datos de la reparación no son válidos." });
        if (maintenance.FechaIngreso == default) return BadRequest(new { Message = "Indica la fecha de ingreso." });
        await tallerService.EditMaintenance(idMantenimiento, maintenance, cancellationToken);
        return NoContent();
    }

    [Authorize(Roles = "Admin")]
    [HttpDelete("maintenances/{idMantenimiento:int}")]
    // Solo Admin puede borrar una reparación existente.
    public async Task<IActionResult> DeleteMaintenance(int idMantenimiento, CancellationToken cancellationToken)
    {
        if (idMantenimiento <= 0) return BadRequest(new { Message = "La reparación no es válida." });
        await tallerService.DeleteMaintenance(idMantenimiento, cancellationToken);
        return NoContent();
    }
}