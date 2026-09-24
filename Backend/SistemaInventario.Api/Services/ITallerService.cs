using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Contrato del módulo de taller y recepción.
public interface ITallerService
{
    Task<IReadOnlyList<WorkshopDeviceDto>> GetDevices(CancellationToken cancellationToken);
    Task<IReadOnlyList<MaintenanceDto>> GetMaintenances(CancellationToken cancellationToken);
    Task RegisterReception(CreateReceptionEntryDto reception, CancellationToken cancellationToken);
    Task CreateMaintenance(int idTecnico, CreateMaintenanceEntryDto maintenance, CancellationToken cancellationToken);
    Task UpdateMaintenance(int idMantenimiento, CreateMaintenanceExitDto maintenance, CancellationToken cancellationToken);
    Task EditMaintenance(int idMantenimiento, UpdateMaintenanceDto maintenance, CancellationToken cancellationToken);
    Task DeleteMaintenance(int idMantenimiento, CancellationToken cancellationToken);
}