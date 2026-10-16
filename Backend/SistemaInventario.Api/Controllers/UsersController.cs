using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Oracle.ManagedDataAccess.Client;
using SistemaInventario.Api.Models;
using SistemaInventario.Api.Services;

namespace SistemaInventario.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/admin")]
// Endpoints de administración de usuarios del sistema y sus módulos de acceso.
public sealed class UsersController(IUserAdminService userService) : ControllerBase
{
    [HttpGet("users")]
    [Authorize(Policy = ModulePolicies.Users)]
    public async Task<ActionResult<IReadOnlyList<AdminUserDto>>> GetUsers(CancellationToken cancellationToken) =>
        Ok(await userService.GetUsers(cancellationToken));

    [HttpPost("users")]
    [Authorize(Policy = ModulePolicies.Users)]
    public async Task<IActionResult> CreateUser(CreateAdminUserDto user, CancellationToken cancellationToken)
    {
        var validationMessage = ValidateUserFields(user.Usuario, user.NombrePersona, user.Rol, user.DominioP, user.Dominio, user.Estado);
        if (validationMessage is not null)
        {
            return BadRequest(new { Message = validationMessage });
        }

        try
        {
            await userService.CreateUser(user, cancellationToken);
            return NoContent();
        }
        catch (OracleException exception) when (exception.Number == 1)
        {
            return Conflict(new { Message = "Ya existe un usuario con ese nombre." });
        }
    }

    [HttpPut("users/{idUsuario:int}")]
    [Authorize(Policy = ModulePolicies.Users)]
    public async Task<IActionResult> UpdateUser(
        int idUsuario,
        UpdateAdminUserDto user,
        CancellationToken cancellationToken)
    {
        var validationMessage = ValidateUserFields(user.Usuario, user.NombrePersona, user.Rol, user.DominioP, user.Dominio, user.Estado);
        if (validationMessage is not null)
        {
            return BadRequest(new { Message = validationMessage });
        }

        try
        {
            return await userService.UpdateUser(idUsuario, user, cancellationToken)
                ? NoContent()
                : NotFound();
        }
        catch (OracleException exception) when (exception.Number == 1)
        {
            return Conflict(new { Message = "Ya existe un usuario con ese nombre." });
        }
    }

    [HttpPost("users/{idUsuario:int}/reset-password")]
    [Authorize(Policy = ModulePolicies.Users)]
    public async Task<IActionResult> ResetUserPassword(int idUsuario, CancellationToken cancellationToken) =>
        await userService.ResetUserPassword(idUsuario, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "No existe el usuario local indicado." });

    [HttpDelete("users/{idUsuario:int}")]
    [Authorize(Policy = ModulePolicies.Users)]
    // Elimina usuarios y traduce conflictos de integridad a una respuesta 409.
    public async Task<IActionResult> DeleteUser(int idUsuario, CancellationToken cancellationToken)
    {
        try
        {
            return await userService.DeleteUser(idUsuario, cancellationToken)
                ? NoContent()
                : NotFound(new { Message = "No se encontró el usuario indicado." });
        }
        catch (OracleException exception) when (exception.Number == 2292)
        {
            return Conflict(new { Message = "No se puede quitar este usuario porque tiene registros relacionados." });
        }
    }

    private static string? ValidateUserFields(
        string usuario,
        string nombrePersona,
        string rol,
        string dominioP,
        int dominio,
        string estado)
    {
        if (string.IsNullOrWhiteSpace(usuario) || string.IsNullOrWhiteSpace(nombrePersona))
        {
            return "El usuario y el nombre de la persona son obligatorios.";
        }

        if (string.IsNullOrWhiteSpace(rol) || !AppRoles.All.Contains(rol.Trim()))
        {
            return "El rol seleccionado no es válido.";
        }

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
