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
    public async Task<ActionResult<PagedResult<DeviceDto>>> GetDevices(
        [FromQuery] int page,
        [FromQuery] string? searchTerm,
        [FromQuery] string? brand,
        [FromQuery] string? model,
        [FromQuery] int? typeId,
        [FromQuery] int? regionalId,
        [FromQuery] int? buildingId,
        [FromQuery] int? areaId,
        CancellationToken cancellationToken) =>
        Ok(await adminService.GetDevices(
            page, searchTerm, brand, model, typeId, regionalId, buildingId, areaId, cancellationToken));

    [HttpGet("device-options")]
    [Authorize(Roles = "Admin,UsuarioComun")]
    public async Task<ActionResult<IReadOnlyList<DeviceOptionDto>>> SearchDeviceOptions(
        [FromQuery] string? searchTerm,
        CancellationToken cancellationToken) =>
        string.IsNullOrWhiteSpace(searchTerm) || searchTerm.Trim().Length < 2
            ? Ok(Array.Empty<DeviceOptionDto>())
            : Ok(await adminService.SearchDeviceOptions(searchTerm, cancellationToken));

    [HttpGet("device-types")]
    [Authorize(Roles = "Admin,UsuarioComun,Taller")]
    public async Task<ActionResult<IReadOnlyList<DeviceTypeDto>>> GetDeviceTypes(CancellationToken cancellationToken) =>
        Ok(await adminService.GetDeviceTypes(cancellationToken));

    [HttpGet("employees/search")]
    [Authorize(Roles = "Admin,UsuarioComun")]
    public async Task<ActionResult<IReadOnlyList<EmployeeSearchDto>>> SearchEmployees(
        [FromQuery] string? searchTerm,
        CancellationToken cancellationToken) =>
        string.IsNullOrWhiteSpace(searchTerm) || searchTerm.Trim().Length < 2
            ? Ok(Array.Empty<EmployeeSearchDto>())
            : Ok(await adminService.SearchEmployees(searchTerm, cancellationToken));

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
        var validationMessage = ValidateUser(user);
        if (validationMessage is not null)
        {
            return BadRequest(new { Message = validationMessage });
        }

        try
        {
            await adminService.CreateUser(user, cancellationToken);
            return NoContent();
        }
        catch (OracleException exception) when (exception.Number == 1)
        {
            return Conflict(new { Message = "Ya existe un usuario con ese nombre." });
        }
    }

    [HttpPut("users/{idUsuario:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> UpdateUser(
        int idUsuario,
        UpdateAdminUserDto user,
        CancellationToken cancellationToken)
    {
        var validationMessage = ValidateUser(user);
        if (validationMessage is not null)
        {
            return BadRequest(new { Message = validationMessage });
        }

        return await adminService.UpdateUser(idUsuario, user, cancellationToken)
            ? NoContent()
            : NotFound();
    }

    [HttpPost("users/{idUsuario:int}/reset-password")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> ResetUserPassword(int idUsuario, CancellationToken cancellationToken) =>
        await adminService.ResetUserPassword(idUsuario, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "No existe el usuario local indicado." });

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

    private static string? ValidateUser(CreateAdminUserDto user)
    {
        if (string.IsNullOrWhiteSpace(user.Usuario) || string.IsNullOrWhiteSpace(user.NombrePersona))
        {
            return "El usuario y el nombre de la persona son obligatorios.";
        }

        return ValidateUserFields(user.DominioP, user.Dominio, user.Estado);
    }

    private static string? ValidateUser(UpdateAdminUserDto user)
    {
        if (string.IsNullOrWhiteSpace(user.NombrePersona))
        {
            return "El nombre de la persona es obligatorio.";
        }

        return ValidateUserFields(user.DominioP, user.Dominio, user.Estado);
    }

    private static string? ValidateUserFields(string dominioP, int dominio, string estado)
    {
        if (dominio is not 0 and not 1)
        {
            return "El tipo de autenticación debe ser local o Active Directory.";
        }

        if (dominioP.Trim().ToUpperInvariant() is not ("BA" or "HE" or "HRN" or "IVM"))
        {
            return "El dominio debe ser BA, HE, HRN o IVM.";
        }

        return estado.Trim().ToUpperInvariant() is "ACTIVO" or "INACTIVO"
            ? null
            : "El estado debe ser ACTIVO o INACTIVO.";
    }
}