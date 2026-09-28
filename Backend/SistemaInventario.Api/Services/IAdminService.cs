using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Contrato de operaciones administrativas desacoplado del controlador HTTP.
public interface IAdminService
{
    Task<PagedResult<DeviceDto>> GetDevices(
        int page,
        string? searchTerm,
        string? brand,
        string? model,
        int? typeId,
        int? regionalId,
        int? buildingId,
        int? areaId,
        CancellationToken cancellationToken);
    Task<IReadOnlyList<DeviceOptionDto>> SearchDeviceOptions(string searchTerm, CancellationToken cancellationToken);
    Task<IReadOnlyList<EmployeeSearchDto>> SearchEmployees(string searchTerm, CancellationToken cancellationToken);
    Task<IReadOnlyList<DeviceTypeDto>> GetDeviceTypes(CancellationToken cancellationToken);
    Task<IReadOnlyList<BuildingDto>> GetBuildings(CancellationToken cancellationToken);
    Task<IReadOnlyList<AreaDto>> GetAreas(int idEdificio, CancellationToken cancellationToken);
    Task CreateDevice(CreateDeviceDto device, CancellationToken cancellationToken);
    Task UpdateDevice(int idEquipo, CreateDeviceDto device, CancellationToken cancellationToken);
    Task UpdateDeviceByIdentifier(string? codigoInventario, string? noSerie, CreateDeviceDto device, CancellationToken cancellationToken);
    Task DeleteDevice(int idEquipo, CancellationToken cancellationToken);
    Task<IReadOnlyList<ReassignmentDto>> GetReassignments(CancellationToken cancellationToken);
    Task CreateReassignment(CreateReassignmentDto reassignment, CancellationToken cancellationToken);
    Task DeleteReassignment(int idReasignacion, CancellationToken cancellationToken);
    Task<IReadOnlyList<AdminUserDto>> GetUsers(CancellationToken cancellationToken);
    Task CreateUser(CreateAdminUserDto user, CancellationToken cancellationToken);
    Task<bool> UpdateUser(int idUsuario, UpdateAdminUserDto user, CancellationToken cancellationToken);
    Task<bool> ResetUserPassword(int idUsuario, CancellationToken cancellationToken);
    Task DeleteUser(int idUsuario, CancellationToken cancellationToken);
}