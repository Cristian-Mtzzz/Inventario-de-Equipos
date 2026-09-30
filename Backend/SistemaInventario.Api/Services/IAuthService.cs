using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Contrato de autenticación para facilitar la inyección y las pruebas.
public interface IAuthService
{
    Task<LoginResponseDto?> AuthenticateUser(LoginRequestDto loginRequest, CancellationToken cancellationToken);
    string RefreshToken(int userId, string userName, string role, bool mustChangePassword);
    Task<bool> ChangeInitialPassword(int userId, ChangePasswordDto request, CancellationToken cancellationToken);
}