using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Contrato de la administración de usuarios del sistema.
public interface IUserAdminService
{
    Task<IReadOnlyList<AdminUserDto>> GetUsers(CancellationToken cancellationToken);
    Task CreateUser(CreateAdminUserDto user, CancellationToken cancellationToken);
    Task<bool> UpdateUser(int idUsuario, UpdateAdminUserDto user, CancellationToken cancellationToken);
    Task<bool> ResetUserPassword(int idUsuario, CancellationToken cancellationToken);
    Task<bool> DeleteUser(int idUsuario, CancellationToken cancellationToken);
}
