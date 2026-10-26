using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Contrato de autenticación para facilitar la inyección y las pruebas.
public interface IAuthService
{
    Task<LoginResponseDto?> AuthenticateUser(LoginRequestDto loginRequest, CancellationToken cancellationToken);
    // Devuelve null si el usuario ya no está activo o vigente.
    Task<string?> RefreshToken(int userId, CancellationToken cancellationToken);
    Task<bool> ChangeInitialPassword(int userId, ChangePasswordDto request, CancellationToken cancellationToken);
}