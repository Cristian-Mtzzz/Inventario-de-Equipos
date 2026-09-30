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
    Task<IReadOnlyList<EmployeeOptionDto>> GetEmployeeOptions(CancellationToken cancellationToken);
    Task<IReadOnlyList<DirectoryEmployeeDto>> GetDirectoryEmployees(CancellationToken cancellationToken);
    Task<IReadOnlyList<RegionalDto>> GetRegionals(CancellationToken cancellationToken);
    Task<IReadOnlyList<CatalogDepartmentDto>> GetCatalogDepartments(CancellationToken cancellationToken);
    Task CreateRegional(SaveRegionalDto regional, CancellationToken cancellationToken);
    Task<bool> UpdateRegional(int idRegional, SaveRegionalDto regional, CancellationToken cancellationToken);
    Task<bool> DeleteRegional(int idRegional, CancellationToken cancellationToken);
    Task CreateBuilding(SaveBuildingDto building, CancellationToken cancellationToken);
    Task<bool> UpdateBuilding(int idEdificio, SaveBuildingDto building, CancellationToken cancellationToken);
    Task<bool> DeleteBuilding(int idEdificio, CancellationToken cancellationToken);
    Task CreateDepartment(SaveDepartmentDto department, CancellationToken cancellationToken);
    Task<bool> UpdateDepartment(int idArea, SaveDepartmentDto department, CancellationToken cancellationToken);
    Task<bool> DeleteDepartment(int idArea, CancellationToken cancellationToken);
    Task CreateDirectoryEmployee(SaveDirectoryEmployeeDto employee, CancellationToken cancellationToken);
    Task<bool> DeleteDirectoryEmployee(string noPago, CancellationToken cancellationToken);
    Task<bool> UpdateDirectoryEmployeeByKey(string employeeKey, UpdateEmployeeDto employee, CancellationToken cancellationToken);
    Task<bool> DeleteDirectoryEmployeeByKey(string employeeKey, CancellationToken cancellationToken);
    Task<bool> UpdateEmployee(string noPagoActual, UpdateEmployeeDto employee, CancellationToken cancellationToken);
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