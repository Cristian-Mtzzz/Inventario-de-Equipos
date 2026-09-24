using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Contrato de autenticación para facilitar la inyección y las pruebas.
public interface IAuthService
{
    Task<LoginResponseDto?> AuthenticateUser(LoginRequestDto loginRequest, CancellationToken cancellationToken);
}