using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Contrato del directorio de empleados.
public interface IEmployeeService
{
    Task<IReadOnlyList<EmployeeSearchDto>> SearchEmployees(string searchTerm, CancellationToken cancellationToken);
    Task<IReadOnlyList<EmployeeLookupDto>> LookupEmployees(string searchTerm, CancellationToken cancellationToken);
    Task<IReadOnlyList<EmployeeOptionDto>> GetEmployeeOptions(int idArea, CancellationToken cancellationToken);
    Task<IReadOnlyList<DirectoryEmployeeDto>> GetDirectoryEmployees(CancellationToken cancellationToken);
    Task<IReadOnlyList<EmployeeRosterDto>> GetEmployeeRoster(CancellationToken cancellationToken);
    Task<bool> SetEmployeePaymentNumber(string employeeKey, string? noPago, CancellationToken cancellationToken);
    Task<bool> UpdateEmployee(string noPagoActual, UpdateEmployeeDto employee, CancellationToken cancellationToken);
    Task CreateDirectoryEmployee(SaveDirectoryEmployeeDto employee, CancellationToken cancellationToken);
    Task<bool> DeleteDirectoryEmployee(string noPago, CancellationToken cancellationToken);
    Task<bool> UpdateDirectoryEmployeeByKey(string employeeKey, UpdateEmployeeDto employee, CancellationToken cancellationToken);
    Task<bool> DeleteDirectoryEmployeeByKey(string employeeKey, CancellationToken cancellationToken);
}
