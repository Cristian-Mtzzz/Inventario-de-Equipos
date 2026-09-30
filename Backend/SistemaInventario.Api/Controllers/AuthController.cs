using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using SistemaInventario.Api.Models;
using SistemaInventario.Api.Services;

namespace SistemaInventario.Api.Controllers;

[ApiController]
[Route("api/auth")]
// Expone el inicio de sesión y devuelve el token junto con los datos del usuario.
public sealed class AuthController(IAuthService authService, IModulePermissionService modulePermissions) : ControllerBase
{
    [HttpPost("login")]
    [AllowAnonymous]
    // Valida las credenciales contra Oracle; una respuesta nula se convierte en 401.
    public async Task<ActionResult<LoginResponseDto>> AuthenticateUser(
        LoginRequestDto loginRequest,
        CancellationToken cancellationToken)
    {
     
       
        var loginResponse = await authService.AuthenticateUser(loginRequest, cancellationToken);
        return loginResponse is null
            ? Unauthorized(new { Message = "Credenciales invalidas." })
            : Ok(loginResponse);
    }

    [HttpGet("permissions")]
    [Authorize(Policy = "PasswordChange")]
    public async Task<ActionResult<ModuleAccessDto>> GetPermissions(CancellationToken cancellationToken)
    {
        var userIdValue = User.FindFirstValue("sub") ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(userIdValue, out var userId)) return Unauthorized();
        var modules = await modulePermissions.GetModules(userId, cancellationToken);
        var isSuperAdmin = modules.Contains(AppModules.SuperAdmin, StringComparer.OrdinalIgnoreCase);
        return Ok(new ModuleAccessDto(
            modules.Where(module => !string.Equals(module, AppModules.SuperAdmin, StringComparison.OrdinalIgnoreCase)).ToArray(),
            isSuperAdmin));
    }

    [HttpPost("refresh")]
    [Authorize(Policy = "PasswordChange")]
    public ActionResult RefreshSession()
    {
        var userIdValue = User.FindFirstValue("sub") ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        var userName = User.FindFirstValue("unique_name") ?? User.FindFirstValue(ClaimTypes.Name);
        var role = User.FindFirstValue(ClaimTypes.Role);
        if (!int.TryParse(userIdValue, out var userId)
            || string.IsNullOrWhiteSpace(userName)
            || string.IsNullOrWhiteSpace(role))
        {
            return Unauthorized();
        }

        var mustChangePassword = User.FindFirstValue("must_change_password") == "true";
        return Ok(new { Token = authService.RefreshToken(userId, userName, role, mustChangePassword) });
    }

    [HttpPost("change-initial-password")]
    [Authorize(Policy = "PasswordChange")]
    public async Task<IActionResult> ChangeInitialPassword(
        ChangePasswordDto request,
        CancellationToken cancellationToken)
    {
        var userIdValue = User.FindFirstValue("sub")
            ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(userIdValue, out var userId))
        {
            return Unauthorized();
        }

        var changed = await authService.ChangeInitialPassword(userId, request, cancellationToken);
        return changed
            ? NoContent()
            : BadRequest(new { Message = "La contraseña actual no es válida o ya fue actualizada." });
    }
}