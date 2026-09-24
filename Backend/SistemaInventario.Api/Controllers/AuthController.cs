using Microsoft.AspNetCore.Mvc;
using SistemaInventario.Api.Models;
using SistemaInventario.Api.Services;

namespace SistemaInventario.Api.Controllers;

[ApiController]
[Route("api/auth")]
// Expone el inicio de sesión y devuelve el token junto con los datos del usuario.
public sealed class AuthController(IAuthService authService) : ControllerBase
{
    [HttpPost("login")]
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
}