using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
using SistemaInventario.Api.Models;
using SistemaInventario.Api.Services;

namespace SistemaInventario.Api.Controllers;

[ApiController]
[Authorize(Policy = ModulePolicies.Workshop)]
[Route("api/taller")]
// Los roles del taller se limitan por operación; la política del módulo sigue
// comprobando que el usuario tenga acceso al taller.
public sealed class TallerController(ITallerService tallerService) : ControllerBase
{
    [HttpGet("devices")]
    [Authorize(Roles = AppRoles.WorkshopManagers)]
    public async Task<ActionResult<IReadOnlyList<WorkshopDeviceDto>>> GetDevices(CancellationToken cancellationToken) =>
        Ok(await tallerService.GetDevices(cancellationToken));

    [HttpGet("maintenances")]
    [Authorize(Roles = AppRoles.WorkshopTechnicians)]
    public async Task<ActionResult<IReadOnlyList<MaintenanceDto>>> GetMaintenances(CancellationToken cancellationToken) =>
        Ok(await tallerService.GetMaintenances(cancellationToken));

    [HttpPost("reception")]
    [Authorize(Roles = AppRoles.WorkshopReception)]
    // Registra la recepción y valida los datos mínimos antes de tocar Oracle.
    public async Task<IActionResult> RegisterReception(CreateReceptionEntryDto reception, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(reception.CodigoInventario)) return BadRequest(new { Message = "Ingresa el número de inventario." });
        if (Exceeds(reception.CodigoInventario, 7)) return BadRequest(new { Message = "El número de inventario no puede superar 7 caracteres." });
        if (string.IsNullOrWhiteSpace(reception.NoSerie)) return BadRequest(new { Message = "Ingresa el número de serie." });
        if (Exceeds(reception.NoSerie, 100)) return BadRequest(new { Message = "El número de serie no puede superar 100 caracteres." });
        if (string.IsNullOrWhiteSpace(reception.Marca)) return BadRequest(new { Message = "Ingresa la marca del equipo." });
        if (Exceeds(reception.Marca, 100)) return BadRequest(new { Message = "La marca no puede superar 100 caracteres." });
        if (string.IsNullOrWhiteSpace(reception.Modelo)) return BadRequest(new { Message = "Ingresa el modelo del equipo." });
        if (Exceeds(reception.Modelo, 100)) return BadRequest(new { Message = "El modelo no puede superar 100 caracteres." });
        if (string.IsNullOrWhiteSpace(reception.TipoDispositivo)) return BadRequest(new { Message = "Indica el tipo de dispositivo." });
        if (Exceeds(reception.MemoNumero, 100)) return BadRequest(new { Message = "El memo no puede superar 100 caracteres." });
        if (string.IsNullOrWhiteSpace(reception.DescripcionEquipo)) return BadRequest(new { Message = "Describe el equipo." });
        if (Exceeds(reception.DescripcionEquipo, 2000)) return BadRequest(new { Message = "La descripción no puede superar 2000 caracteres." });
        if (reception.EquipoEnGarantia is not ("SI" or "NO")) return BadRequest(new { Message = "Indica si el equipo está en garantía." });
        if (string.IsNullOrWhiteSpace(reception.Recibe)
            || string.IsNullOrWhiteSpace(reception.Tecnico))
        {
            return BadRequest(new { Message = "Completa los datos de recepción y técnico." });
        }
        if (new[] { reception.Recibe, reception.Tecnico }.Any(value => Exceeds(value, 200)))
        {
            return BadRequest(new { Message = "Los nombres no pueden superar 200 caracteres." });
        }
        if (reception.IdEdificio <= 0) return BadRequest(new { Message = "Selecciona el centro o regional de origen." });
        if (reception.FechaIngreso == default) return BadRequest(new { Message = "La fecha de ingreso es obligatoria." });

        try
        {
            await tallerService.RegisterReception(reception, cancellationToken);
            return NoContent();
        }
        catch (InvalidOperationException exception)
        {
            return BadRequest(new { Message = exception.Message });
        }
    }

    [HttpPost("maintenances")]
    [Authorize(Roles = AppRoles.WorkshopManagers)]
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
    [Authorize(Roles = AppRoles.WorkshopManagers)]
    public async Task<IActionResult> RegisterMaintenanceExit(
        int idMantenimiento,
        UpdateMaintenanceExitDto exit,
        CancellationToken cancellationToken)
    {
        if (idMantenimiento <= 0) return BadRequest(new { Message = "El mantenimiento no es válido." });
        if (exit.EquipoFuncional is not ("SI" or "NO")) return BadRequest(new { Message = "Indica si el equipo quedó funcional." });
        if (string.IsNullOrWhiteSpace(exit.TecnicoEntrega) || string.IsNullOrWhiteSpace(exit.ClienteRecibe))
        {
            return BadRequest(new { Message = "Indica quién entrega y quién recibe el equipo." });
        }
        if (Exceeds(exit.TecnicoEntrega, 200) || Exceeds(exit.ClienteRecibe, 200))
        {
            return BadRequest(new { Message = "Los nombres de entrega no pueden superar 200 caracteres." });
        }
        if (exit.FechaEntrega == default) return BadRequest(new { Message = "Indica la fecha de entrega." });
        return await tallerService.RegisterMaintenanceExit(idMantenimiento, exit, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = MaintenanceNotFound });
    }

    [HttpPut("maintenances/{idMantenimiento:int}/assessment")]
    [Authorize(Roles = AppRoles.WorkshopTechnicians)]
    public async Task<IActionResult> UpdateMaintenanceAssessment(
        int idMantenimiento,
        UpdateMaintenanceAssessmentDto assessment,
        CancellationToken cancellationToken)
    {
        if (idMantenimiento <= 0) return BadRequest(new { Message = "El mantenimiento no es válido." });
        if (string.IsNullOrWhiteSpace(assessment.Dictamen)) return BadRequest(new { Message = "Ingresa el diagnóstico del equipo." });
        if (Exceeds(assessment.Dictamen, 2000) || Exceeds(assessment.PiezasSustituidas, 2000)
            || Exceeds(assessment.Observaciones, 2000))
        {
            return BadRequest(new { Message = "El diagnóstico, las piezas y las observaciones no pueden superar 2000 caracteres." });
        }
        return await tallerService.UpdateMaintenanceAssessment(idMantenimiento, assessment, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = MaintenanceNotFound });
    }

    [HttpPut("maintenances/{idMantenimiento:int}/edit")]
    [Authorize(Roles = AppRoles.WorkshopManagers)]
    public async Task<IActionResult> EditMaintenance(int idMantenimiento, UpdateMaintenanceDto maintenance, CancellationToken cancellationToken)
    {
        if (idMantenimiento <= 0 || maintenance.IdEquipo <= 0) return BadRequest(new { Message = "Los datos de la reparación no son válidos." });
        if (maintenance.FechaIngreso == default) return BadRequest(new { Message = "Indica la fecha de ingreso." });
        return await tallerService.EditMaintenance(idMantenimiento, maintenance, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = MaintenanceNotFound });
    }

    [HttpDelete("maintenances/{idMantenimiento:int}")]
    [Authorize(Roles = AppRoles.WorkshopManagers)]
    // El acceso completo al módulo Taller permite borrar una reparación existente.
    public async Task<IActionResult> DeleteMaintenance(int idMantenimiento, CancellationToken cancellationToken)
    {
        if (idMantenimiento <= 0) return BadRequest(new { Message = "La reparación no es válida." });
        return await tallerService.DeleteMaintenance(idMantenimiento, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = MaintenanceNotFound });
    }

    private const string MaintenanceNotFound = "No se encontró la reparación indicada.";

    private static bool Exceeds(string? value, int maxLength) => value?.Length > maxLength;
}