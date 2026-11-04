using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Contrato del módulo de taller y recepción. Las operaciones sobre una reparación
// existente devuelven false cuando el identificador no existe.
public interface ITallerService
{
    Task<IReadOnlyList<WorkshopDeviceDto>> GetDevices(CancellationToken cancellationToken);
    // Con idTecnico, solo las reparaciones asignadas a ese técnico.
    Task<IReadOnlyList<MaintenanceDto>> GetMaintenances(int? idTecnico, CancellationToken cancellationToken);
    Task RegisterReception(CreateReceptionEntryDto reception, int userId, CancellationToken cancellationToken);
    Task<ReceptionDefaultsDto> GetReceptionDefaults(int userId, CancellationToken cancellationToken);
    Task CreateMaintenance(int idTecnico, CreateMaintenanceEntryDto maintenance, CancellationToken cancellationToken);
    // Con idTecnico, solo actualiza si la reparación está asignada a ese técnico.
    Task<bool> UpdateMaintenanceAssessment(int idMantenimiento, UpdateMaintenanceAssessmentDto assessment, int? idTecnico, CancellationToken cancellationToken);
    Task<bool> RegisterMaintenanceExit(int idMantenimiento, UpdateMaintenanceExitDto exit, CancellationToken cancellationToken);
    Task<bool> DeleteMaintenance(int idMantenimiento, CancellationToken cancellationToken);
    Task<IReadOnlyList<WorkshopTechnicianDto>> GetTechnicians(CancellationToken cancellationToken);
    Task<bool> AssignTechnician(int idMantenimiento, int idUsuario, CancellationToken cancellationToken);
}
