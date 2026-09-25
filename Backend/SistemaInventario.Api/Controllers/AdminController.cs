using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Oracle.ManagedDataAccess.Client;
using SistemaInventario.Api.Models;
using SistemaInventario.Api.Services;

namespace SistemaInventario.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/admin")]
// Fachada HTTP del módulo administrativo: valida solicitudes, aplica roles y
// delega inventario, reasignaciones y usuarios al AdminService.
public sealed class AdminController(IAdminService adminService) : ControllerBase
{
    [HttpGet("devices")]
    [Authorize(Roles = "Admin,UsuarioComun,Taller")]
    // Lista equipos con tipo, área y responsable actual.
    public async Task<ActionResult<IReadOnlyList<DeviceDto>>> GetDevices(CancellationToken cancellationToken) =>
        Ok(await adminService.GetDevices(cancellationToken));

    [HttpGet("device-types")]
    [Authorize(Roles = "Admin,UsuarioComun,Taller")]
    public async Task<ActionResult<IReadOnlyList<DeviceTypeDto>>> GetDeviceTypes(CancellationToken cancellationToken) =>
        Ok(await adminService.GetDeviceTypes(cancellationToken));

    [HttpGet("employees")]
    [Authorize(Roles = "Admin,UsuarioComun")]
    public async Task<ActionResult<IReadOnlyList<EmployeeDto>>> GetEmployees(CancellationToken cancellationToken) =>
        Ok(await adminService.GetEmployees(cancellationToken));

    [HttpGet("buildings")]
    [Authorize(Roles = "Admin,UsuarioComun,Taller")]
    public async Task<ActionResult<IReadOnlyList<BuildingDto>>> GetBuildings(CancellationToken cancellationToken) =>
        Ok(await adminService.GetBuildings(cancellationToken));

    [HttpGet("areas/{idEdificio:int}")]
    [Authorize(Roles = "Admin,UsuarioComun,Taller")]
    public async Task<ActionResult<IReadOnlyList<AreaDto>>> GetAreas(int idEdificio, CancellationToken cancellationToken) =>
        Ok(await adminService.GetAreas(idEdificio, cancellationToken));

    [HttpPost("devices")]
    [Authorize(Roles = "Admin,UsuarioComun")]
    // Valida y registra un equipo nuevo.
    public async Task<IActionResult> CreateDevice(CreateDeviceDto device, CancellationToken cancellationToken)
    {
        var validationMessage = ValidateDevice(device);
        if (validationMessage is not null)
        {
            return BadRequest(new { Message = validationMessage });
        }

        await adminService.CreateDevice(device, cancellationToken);
        return CreatedAtAction(nameof(GetDevices), null);
    }

    [HttpPut("devices/{idEquipo:int}")]
    [Authorize(Roles = "Admin,UsuarioComun")]
    public async Task<IActionResult> UpdateDevice(int idEquipo, CreateDeviceDto device, CancellationToken cancellationToken)
    {
        var validationMessage = ValidateDevice(device);
        if (validationMessage is not null)
        {
            return BadRequest(new { Message = validationMessage });
        }

        await adminService.UpdateDevice(idEquipo, device, cancellationToken);
        return NoContent();
    }

    [HttpPut("devices/by-identifier")]
    [Authorize(Roles = "Admin,UsuarioComun")]
    // Actualiza usando el código o la serie originales, aunque el usuario los modifique.
    public async Task<IActionResult> UpdateDeviceByIdentifier(
        [FromQuery] string? codigoInventario,
        [FromQuery] string? noSerie,
        CreateDeviceDto device,
        CancellationToken cancellationToken)
    {
        var validationMessage = ValidateDevice(device);
        if (validationMessage is not null)
        {
            return BadRequest(new { Message = validationMessage });
        }

        if (string.IsNullOrWhiteSpace(codigoInventario) && string.IsNullOrWhiteSpace(noSerie))
        {
            return BadRequest(new { Message = "Indica el código de inventario o el número de serie original." });
        }

        await adminService.UpdateDeviceByIdentifier(codigoInventario, noSerie, device, cancellationToken);
        return NoContent();
    }

    [HttpDelete("devices/{idEquipo:int}")]
    [Authorize(Roles = "Admin,UsuarioComun")]
    // Elimina el equipo y sus reasignaciones relacionadas.
    public async Task<IActionResult> DeleteDevice(int idEquipo, CancellationToken cancellationToken)
    {
        try
        {
            await adminService.DeleteDevice(idEquipo, cancellationToken);
            return NoContent();
        }
        catch (OracleException exception) when (exception.Number == 2292)
        {
            return Conflict(new { Message = "No se puede quitar el dispositivo porque tiene otros registros relacionados." });
        }
    }

    [HttpGet("reassignments")]
    [Authorize(Roles = "Admin,UsuarioComun")]
    public async Task<ActionResult<IReadOnlyList<ReassignmentDto>>> GetReassignments(CancellationToken cancellationToken) =>
        Ok(await adminService.GetReassignments(cancellationToken));

    [HttpPost("reassignments")]
    [Authorize(Roles = "Admin,UsuarioComun")]
    // Cambia el responsable sin exigir que exista un número de pago.
    public async Task<IActionResult> CreateReassignment(CreateReassignmentDto reassignment, CancellationToken cancellationToken)
    {
        if (reassignment.IdEquipo <= 0 || reassignment.IdEdificio <= 0 || reassignment.IdArea <= 0)
        {
            return BadRequest(new { Message = "Selecciona el equipo, edificio y departamento de la reasignación." });
        }

        await adminService.CreateReassignment(reassignment, cancellationToken);
        return NoContent();
    }

    [HttpDelete("reassignments/{idReasignacion:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> DeleteReassignment(int idReasignacion, CancellationToken cancellationToken)
    {
        await adminService.DeleteReassignment(idReasignacion, cancellationToken);
        return NoContent();
    }

    [HttpGet("users")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<IReadOnlyList<AdminUserDto>>> GetUsers(CancellationToken cancellationToken) =>
        Ok(await adminService.GetUsers(cancellationToken));

    [HttpPost("users")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> CreateUser(CreateAdminUserDto user, CancellationToken cancellationToken)
    {
        await adminService.CreateUser(user, cancellationToken);
        return NoContent();
    }

    [HttpDelete("users/{idUsuario:int}")]
    [Authorize(Roles = "Admin")]
    // Elimina usuarios y traduce conflictos de integridad a una respuesta 409.
    public async Task<IActionResult> DeleteUser(int idUsuario, CancellationToken cancellationToken)
    {
        try
        {
            await adminService.DeleteUser(idUsuario, cancellationToken);
            return NoContent();
        }
        catch (OracleException exception) when (exception.Number == 2292)
        {
            return Conflict(new { Message = "No se puede quitar este usuario porque tiene registros relacionados." });
        }
    }

    private static string? ValidateDevice(CreateDeviceDto device)
    {
        if (string.IsNullOrWhiteSpace(device.CodigoInventario)
            || string.IsNullOrWhiteSpace(device.NoSerie)
            || string.IsNullOrWhiteSpace(device.Marca)
            || string.IsNullOrWhiteSpace(device.Modelo))
        {
            return "Código, número de serie, marca y modelo son obligatorios.";
        }

        return device.IdTipo is null
            ? "Selecciona un tipo de dispositivo."
            : null;
    }
}