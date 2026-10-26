using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using SistemaInventario.Api.Infrastructure;
using Microsoft.Extensions.Logging;
using Oracle.ManagedDataAccess.Client;
using SistemaInventario.Api.Models;
using SistemaInventario.Api.Services;

namespace SistemaInventario.Api.Controllers;

[ApiController]
[Route("api/auth")]
// Expone el inicio de sesión y devuelve el token junto con los datos del usuario.
public sealed class AuthController(
    IAuthService authService,
    IModulePermissionService modulePermissions,
    LoginAttemptLimiter loginAttempts,
    ILogger<AuthController> logger) : ControllerBase
{
    [HttpPost("login")]
    [AllowAnonymous]
    [EnableRateLimiting(LoginRateLimit.Policy)]
    // Valida las credenciales contra Oracle; una respuesta nula se convierte en 401.
    // Tras varios fallos seguidos el usuario queda bloqueado unos minutos (429) y ni
    // siquiera se consulta Active Directory, para no bloquear también su cuenta de dominio.
    public async Task<ActionResult<LoginResponseDto>> AuthenticateUser(
        LoginRequestDto loginRequest,
        CancellationToken cancellationToken)
    {
        if (loginAttempts.GetRemainingLockout(loginRequest.UserName) is { } remaining)
        {
            logger.LogWarning("Login bloqueado temporalmente para {UserName} por intentos fallidos.", loginRequest.UserName);
            return LoginRateLimit.TooManyAttempts(remaining);
        }

        try
        {
            var loginResponse = await authService.AuthenticateUser(loginRequest, cancellationToken);
            if (loginResponse is null)
            {
                loginAttempts.RegisterFailure(loginRequest.UserName);
                return Unauthorized(new { Message = "Credenciales invalidas." });
            }

            loginAttempts.Reset(loginRequest.UserName);
            return Ok(loginResponse);
        }
        catch (OracleException exception)
        {
            logger.LogError(exception, "No se pudo consultar Oracle durante el inicio de sesión.");
            return StatusCode(
                StatusCodes.Status503ServiceUnavailable,
                new { Message = "El servicio de autenticación no está disponible temporalmente." });
        }
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
    // El token nuevo se arma con los datos actuales de USUARIOS, no con los del token anterior.
    public async Task<ActionResult> RefreshSession(CancellationToken cancellationToken)
    {
        var userIdValue = User.FindFirstValue("sub") ?? User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!int.TryParse(userIdValue, out var userId)) return Unauthorized();

        var token = await authService.RefreshToken(userId, cancellationToken);
        return token is null
            ? Unauthorized(new { Message = "Tu usuario ya no está activo. Vuelve a iniciar sesión." })
            : Ok(new { Token = token });
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