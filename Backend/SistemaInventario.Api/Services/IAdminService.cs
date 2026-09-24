using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Contrato de operaciones administrativas desacoplado del controlador HTTP.
public interface IAdminService
{
    Task<IReadOnlyList<DeviceDto>> GetDevices(CancellationToken cancellationToken);
    Task<IReadOnlyList<DeviceTypeDto>> GetDeviceTypes(CancellationToken cancellationToken);
    Task<IReadOnlyList<EmployeeDto>> GetEmployees(CancellationToken cancellationToken);
    Task<IReadOnlyList<AreaDto>> GetAreas(CancellationToken cancellationToken);
    Task CreateDevice(CreateDeviceDto device, CancellationToken cancellationToken);
    Task UpdateDevice(int idEquipo, CreateDeviceDto device, CancellationToken cancellationToken);
    Task DeleteDevice(int idEquipo, CancellationToken cancellationToken);
    Task<IReadOnlyList<ReassignmentDto>> GetReassignments(CancellationToken cancellationToken);
    Task CreateReassignment(CreateReassignmentDto reassignment, CancellationToken cancellationToken);
    Task<IReadOnlyList<AdminUserDto>> GetUsers(CancellationToken cancellationToken);
    Task CreateUser(CreateAdminUserDto user, CancellationToken cancellationToken);
    Task DeleteUser(int idUsuario, CancellationToken cancellationToken);
}