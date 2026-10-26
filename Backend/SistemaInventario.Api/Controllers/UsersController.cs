using System.Security.Claims;
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
// El acceso total (ADMIN_TOTAL) solo lo administra otro SuperAdmin: quien tiene el módulo
// USUARIOS no puede otorgarlo, ni editar, restablecer la contraseña o quitar a un SuperAdmin.
public sealed class UsersController(
    IUserAdminService userService,
    IModulePermissionService modulePermissions) : ControllerBase
{
    private const string SuperAdminOnly =
        "Solo un usuario con acceso total puede otorgar ese acceso o modificar a otro usuario que lo tenga.";
    private const string LastSuperAdmin =
        "No se puede quitar el acceso total al único usuario que lo tiene.";

    [HttpGet("users")]
    [Authorize(Policy = ModulePolicies.Users)]
    public async Task<ActionResult<IReadOnlyList<AdminUserDto>>> GetUsers(CancellationToken cancellationToken) =>
        Ok(await userService.GetUsers(cancellationToken));

    [HttpPost("users")]
    [Authorize(Policy = ModulePolicies.Users)]
    public async Task<IActionResult> CreateUser(CreateAdminUserDto user, CancellationToken cancellationToken)
    {
        var validationMessage = ValidateUserFields(user.Usuario, user.NombrePersona, user.Rol, user.DominioP, user.Dominio, user.Estado)
            ?? ValidateModules(user.Modules);
        if (validationMessage is not null)
        {
            return BadRequest(new { Message = validationMessage });
        }

        if (WillBeSuperAdmin(user.Rol, user.IsSuperAdmin) && !await CurrentUserIsSuperAdmin(cancellationToken))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { Message = SuperAdminOnly });
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
        var validationMessage = ValidateUserFields(user.Usuario, user.NombrePersona, user.Rol, user.DominioP, user.Dominio, user.Estado)
            ?? ValidateModules(user.Modules);
        if (validationMessage is not null)
        {
            return BadRequest(new { Message = validationMessage });
        }

        var targetIsSuperAdmin = await IsSuperAdmin(idUsuario, cancellationToken);
        var willBeSuperAdmin = WillBeSuperAdmin(user.Rol, user.IsSuperAdmin);
        if ((targetIsSuperAdmin || willBeSuperAdmin) && !await CurrentUserIsSuperAdmin(cancellationToken))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { Message = SuperAdminOnly });
        }

        var losesSuperAdmin = targetIsSuperAdmin
            && (!willBeSuperAdmin || !user.Estado.Trim().Equals("ACTIVO", StringComparison.OrdinalIgnoreCase));
        if (losesSuperAdmin && await modulePermissions.GetSuperAdminCount(cancellationToken) <= 1)
        {
            return Conflict(new { Message = LastSuperAdmin });
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
    public async Task<IActionResult> ResetUserPassword(int idUsuario, CancellationToken cancellationToken)
    {
        if (await IsSuperAdmin(idUsuario, cancellationToken) && !await CurrentUserIsSuperAdmin(cancellationToken))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new { Message = SuperAdminOnly });
        }

        return await userService.ResetUserPassword(idUsuario, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "No existe el usuario local indicado." });
    }

    [HttpDelete("users/{idUsuario:int}")]
    [Authorize(Policy = ModulePolicies.Users)]
    // Elimina usuarios y traduce conflictos de integridad a una respuesta 409.
    public async Task<IActionResult> DeleteUser(int idUsuario, CancellationToken cancellationToken)
    {
        if (await IsSuperAdmin(idUsuario, cancellationToken))
        {
            if (!await CurrentUserIsSuperAdmin(cancellationToken))
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { Message = SuperAdminOnly });
            }
            if (await modulePermissions.GetSuperAdminCount(cancellationToken) <= 1)
            {
                return Conflict(new { Message = LastSuperAdmin });
            }
        }

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

    // Los roles de taller y de tickets tienen módulos fijos: con ellos el acceso total no se guarda.
    private static bool WillBeSuperAdmin(string role, bool isSuperAdmin) =>
        isSuperAdmin
        && !AppRoles.IsRestrictedWorkshopRole(role.Trim())
        && !AppRoles.IsTicketRole(role.Trim());

    private async Task<bool> IsSuperAdmin(int userId, CancellationToken cancellationToken) =>
        (await modulePermissions.GetModules(userId, cancellationToken))
            .Contains(AppModules.SuperAdmin, StringComparer.OrdinalIgnoreCase);

    private async Task<bool> CurrentUserIsSuperAdmin(CancellationToken cancellationToken) =>
        int.TryParse(User.FindFirstValue("sub") ?? User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)
        && await IsSuperAdmin(userId, cancellationToken);

    // Solo se aceptan los módulos asignables; ADMIN_TOTAL se otorga con IsSuperAdmin, no en la lista.
    private static string? ValidateModules(IReadOnlyList<string>? modules) =>
        modules?.Any(module => !AppModules.Assignable.Contains(module, StringComparer.OrdinalIgnoreCase)) == true
            ? "Uno de los módulos seleccionados no es válido."
            : null;

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
