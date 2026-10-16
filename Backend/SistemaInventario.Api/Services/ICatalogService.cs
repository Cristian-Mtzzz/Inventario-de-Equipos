using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Contrato de los catálogos: tipos de dispositivo, regionales, edificios y departamentos.
public interface ICatalogService
{
    Task<IReadOnlyList<DeviceTypeDto>> GetDeviceTypes(CancellationToken cancellationToken);
    Task CreateDeviceType(SaveDeviceTypeDto deviceType, CancellationToken cancellationToken);
    Task<bool> UpdateDeviceType(int idTipo, SaveDeviceTypeDto deviceType, CancellationToken cancellationToken);
    Task<bool> DeleteDeviceType(int idTipo, CancellationToken cancellationToken);
    Task<IReadOnlyList<BuildingDto>> GetBuildings(CancellationToken cancellationToken);
    Task<IReadOnlyList<AreaDto>> GetAreas(int idEdificio, CancellationToken cancellationToken);
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
}
