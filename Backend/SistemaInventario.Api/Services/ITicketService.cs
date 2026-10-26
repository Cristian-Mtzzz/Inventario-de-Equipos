using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Contrato del módulo Tickets de soporte.
public interface ITicketService
{
    // Con idTecnico el listado se limita a los tickets de ese técnico; sin él, trae todos.
    Task<IReadOnlyList<TicketDto>> GetTickets(int? idTecnico, CancellationToken cancellationToken);
    Task<IReadOnlyList<TicketEmployeeDto>> GetEmployeesByArea(int idArea, CancellationToken cancellationToken);
    Task<IReadOnlyList<TicketTechnicianDto>> GetTechnicians(CancellationToken cancellationToken);
    Task<TicketAlertThresholdsDto> GetAlertThresholds(CancellationToken cancellationToken);
    Task CreateTicket(CreateTicketDto ticket, int createdByUserId, CancellationToken cancellationToken);
    Task<bool> UpdateTicket(int idTicket, UpdateTicketDto ticket, CancellationToken cancellationToken);
    Task<bool> ReassignTicket(int idTicket, int idTecnico, CancellationToken cancellationToken);
    // Verifica el No. de pago contra EMPLEADOS_IHSS antes de cerrar; si no coincide, falla.
    Task<bool> FinishTicket(int idTicket, FinishTicketDto finish, int idTecnico, bool isManager, CancellationToken cancellationToken);
}
