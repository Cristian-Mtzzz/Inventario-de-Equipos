namespace SistemaInventario.Api.Models;

// Respuesta pública del login: token JWT y perfil básico del usuario.
public sealed record LoginResponseDto(string Token, UserResponseDto User, bool MustChangePassword);

public sealed record UserResponseDto(
    int UserId,
    string UserName,
    string FullName,
    string Role,
    string Estado,
    string DominioP,
    int Dominio);