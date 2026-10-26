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
    // El administrador de taller ve todas las reparaciones; el técnico, solo las que tiene asignadas.
    public async Task<ActionResult<IReadOnlyList<MaintenanceDto>>> GetMaintenances(CancellationToken cancellationToken)
    {
        if (IsWorkshopManager) return Ok(await tallerService.GetMaintenances(null, cancellationToken));
        if (CurrentUserId() is not { } userId) return BadRequest(new { Message = "No se pudo identificar al técnico." });
        return Ok(await tallerService.GetMaintenances(userId, cancellationToken));
    }

    [HttpGet("reception-defaults")]
    [Authorize(Roles = AppRoles.WorkshopReception)]
    // Nombre del usuario que recibe y técnico asignado por defecto; el formulario los muestra bloqueados.
    public async Task<ActionResult<ReceptionDefaultsDto>> GetReceptionDefaults(CancellationToken cancellationToken) =>
        CurrentUserId() is { } userId
            ? Ok(await tallerService.GetReceptionDefaults(userId, cancellationToken))
            : BadRequest(new { Message = "No se pudo identificar al usuario." });

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
        if (!string.IsNullOrWhiteSpace(reception.EquipoEnGarantia) && reception.EquipoEnGarantia.Trim().ToUpperInvariant() is not ("SI" or "NO"))
        {
            return BadRequest(new { Message = "La garantía debe ser SI o NO." });
        }
        if (reception.IdEdificio <= 0) return BadRequest(new { Message = "Selecciona el centro o regional de origen." });
        if (reception.FechaIngreso == default) return BadRequest(new { Message = "La fecha de ingreso es obligatoria." });

        try
        {
            if (CurrentUserId() is not { } userId) return BadRequest(new { Message = "No se pudo identificar al usuario que recibe." });
            await tallerService.RegisterReception(reception, userId, cancellationToken);
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
        if (CurrentUserId() is not { } idTecnico)
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
        // Quien entrega no se pide: es el técnico asignado a la reparación.
        if (string.IsNullOrWhiteSpace(exit.ClienteRecibe))
        {
            return BadRequest(new { Message = "Indica quién recibe el equipo." });
        }
        if (Exceeds(exit.ClienteRecibe, 200))
        {
            return BadRequest(new { Message = "El nombre de quien recibe no puede superar 200 caracteres." });
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
        // La garantía la indica quien hace el dictamen: el técnico asignado o el admin de taller.
        var garantia = assessment.EquipoEnGarantia?.Trim().ToUpperInvariant();
        if (!string.IsNullOrEmpty(garantia) && garantia is not ("SI" or "NO"))
        {
            return BadRequest(new { Message = "La garantía debe ser SI o NO." });
        }
        // El administrador de taller puede dictaminar cualquier reparación; el técnico, solo las que tiene asignadas.
        int? assignedTechnician = null;
        if (!IsWorkshopManager)
        {
            if (CurrentUserId() is not { } userId) return BadRequest(new { Message = "No se pudo identificar al técnico." });
            assignedTechnician = userId;
        }

        return await tallerService.UpdateMaintenanceAssessment(
                idMantenimiento, assessment with { EquipoEnGarantia = garantia }, assignedTechnician, cancellationToken)
            ? NoContent()
            : NotFound(new
            {
                Message = assignedTechnician is null
                    ? MaintenanceNotFound
                    : "No se encontró una reparación asignada a ti con ese número.",
            });
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

    private bool IsWorkshopManager =>
        User.IsInRole(AppRoles.Admin) || User.IsInRole(AppRoles.AdminTaller) || User.IsInRole(AppRoles.Taller);

    // ID del usuario autenticado (claim "sub" del JWT).
    private int? CurrentUserId() =>
        int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"), out var userId) ? userId : null;

    [HttpGet("technicians")]
    [Authorize(Roles = AppRoles.WorkshopManagers)]
    // Técnicos que se pueden asignar a una reparación (usuarios activos con rol TecnicoTaller).
    public async Task<ActionResult<IReadOnlyList<WorkshopTechnicianDto>>> GetTechnicians(CancellationToken cancellationToken) =>
        Ok(await tallerService.GetTechnicians(cancellationToken));

    [HttpPut("maintenances/{idMantenimiento:int}/technician")]
    [Authorize(Roles = AppRoles.WorkshopManagers)]
    public async Task<IActionResult> AssignTechnician(
        int idMantenimiento,
        AssignTechnicianDto assignment,
        CancellationToken cancellationToken)
    {
        if (idMantenimiento <= 0) return BadRequest(new { Message = "La reparación no es válida." });
        var technicians = await tallerService.GetTechnicians(cancellationToken);
        if (!technicians.Any(technician => technician.IdUsuario == assignment.IdUsuario))
        {
            return BadRequest(new { Message = "Selecciona un técnico activo." });
        }
        return await tallerService.AssignTechnician(idMantenimiento, assignment.IdUsuario, cancellationToken)
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