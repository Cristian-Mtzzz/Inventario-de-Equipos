using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Contrato del historial y registro de reasignaciones.
public interface IReassignmentService
{
    Task<IReadOnlyList<ReassignmentDto>> GetReassignments(CancellationToken cancellationToken);
    Task CreateReassignment(CreateReassignmentDto reassignment, CancellationToken cancellationToken);
    Task<bool> DeleteReassignment(int idReasignacion, CancellationToken cancellationToken);
}
