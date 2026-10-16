using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Contrato del módulo de taller y recepción. Las operaciones sobre una reparación
// existente devuelven false cuando el identificador no existe.
public interface ITallerService
{
    Task<IReadOnlyList<WorkshopDeviceDto>> GetDevices(CancellationToken cancellationToken);
    Task<IReadOnlyList<MaintenanceDto>> GetMaintenances(CancellationToken cancellationToken);
    Task RegisterReception(CreateReceptionEntryDto reception, CancellationToken cancellationToken);
    Task CreateMaintenance(int idTecnico, CreateMaintenanceEntryDto maintenance, CancellationToken cancellationToken);
    Task<bool> UpdateMaintenanceAssessment(int idMantenimiento, UpdateMaintenanceAssessmentDto assessment, CancellationToken cancellationToken);
    Task<bool> RegisterMaintenanceExit(int idMantenimiento, UpdateMaintenanceExitDto exit, CancellationToken cancellationToken);
    Task<bool> EditMaintenance(int idMantenimiento, UpdateMaintenanceDto maintenance, CancellationToken cancellationToken);
    Task<bool> DeleteMaintenance(int idMantenimiento, CancellationToken cancellationToken);
}
