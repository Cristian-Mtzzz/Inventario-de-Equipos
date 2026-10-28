using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Oracle.ManagedDataAccess.Client;
using SistemaInventario.Api.Models;
using SistemaInventario.Api.Services;

namespace SistemaInventario.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/admin")]
// Endpoints del directorio de empleados: búsqueda para asignaciones y mantenimiento del catálogo.
public sealed class EmployeesController(IEmployeeService employeeService) : ControllerBase
{
    private const string EmployeeNotFound = "No se encontró el empleado indicado.";
    private const string EmployeeInUse = "No se puede eliminar el empleado porque tiene dispositivos o reasignaciones asociadas.";

    [HttpGet("employees/search")]
    [Authorize(Policy = ModulePolicies.AssignmentSupport)]
    public async Task<ActionResult<IReadOnlyList<EmployeeSearchDto>>> SearchEmployees(
        [FromQuery] string? searchTerm,
        CancellationToken cancellationToken) =>
        string.IsNullOrWhiteSpace(searchTerm) || searchTerm.Trim().Length < 2
            ? Ok(Array.Empty<EmployeeSearchDto>())
            : Ok(await employeeService.SearchEmployees(searchTerm, cancellationToken));

    [HttpGet("employees/lookup")]
    [Authorize(Policy = ModulePolicies.EmployeeLookup)]
    // Buscador de empleados de los formularios: al seleccionar uno se completa su ubicación.
    public async Task<ActionResult<IReadOnlyList<EmployeeLookupDto>>> LookupEmployees(
        [FromQuery] string? searchTerm,
        CancellationToken cancellationToken) =>
        Ok(await employeeService.LookupEmployees(searchTerm ?? string.Empty, cancellationToken));

    [HttpGet("employees/options")]
    [Authorize(Policy = ModulePolicies.AssignmentSupport)]
    public async Task<ActionResult<IReadOnlyList<EmployeeOptionDto>>> GetEmployeeOptions(
        [FromQuery] int idArea,
        CancellationToken cancellationToken) =>
        idArea <= 0
            ? BadRequest(new { Message = "El departamento es obligatorio." })
            : Ok(await employeeService.GetEmployeeOptions(idArea, cancellationToken));

    [HttpGet("employees/directory")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<ActionResult<IReadOnlyList<DirectoryEmployeeDto>>> GetDirectoryEmployees(
        CancellationToken cancellationToken) =>
        Ok(await employeeService.GetDirectoryEmployees(cancellationToken));

    [HttpGet("employees/roster")]
    [Authorize(Policy = ModulePolicies.Employees)]
    // Listado del módulo Empleados: ubicación, nombre y No. de pago.
    public async Task<ActionResult<IReadOnlyList<EmployeeRosterDto>>> GetEmployeeRoster(
        CancellationToken cancellationToken) =>
        Ok(await employeeService.GetEmployeeRoster(cancellationToken));

    [HttpPut("employees/roster/no-pago")]
    [Authorize(Policy = ModulePolicies.Employees)]
    // El empleado se identifica por su clave de fila porque todavía puede no tener No. de pago.
    // Mandar el campo vacío borra el número asignado.
    public async Task<IActionResult> SetEmployeePaymentNumber(
        [FromQuery] string employeeKey,
        SetEmployeePaymentNumberDto payment,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(employeeKey)) return BadRequest(new { Message = "No se identificó al empleado." });
        var noPago = payment.NoPago?.Trim();
        if (!string.IsNullOrEmpty(noPago) && !noPago.All(char.IsAsciiDigit))
        {
            return BadRequest(new { Message = "El No. de pago solo puede tener números." });
        }
        if (noPago?.Length > 5) return BadRequest(new { Message = "El No. de pago no puede superar 5 dígitos." });

        return await employeeService.SetEmployeePaymentNumber(employeeKey, noPago, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = EmployeeNotFound });
    }

    [HttpPost("employees/directory")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> CreateDirectoryEmployee(SaveDirectoryEmployeeDto employee, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(employee.NombreCompleto) || employee.IdArea <= 0)
            return BadRequest(new { Message = "Nombre y departamento son obligatorios." });
        try
        {
            await employeeService.CreateDirectoryEmployee(employee, cancellationToken);
            return CreatedAtAction(nameof(GetEmployeeOptions), null);
        }
        catch (OracleException exception) when (exception.Number == 1)
        {
            return Conflict(new { Message = "Ya existe un empleado con ese número de pago." });
        }
    }

    [HttpPut("employees/directory/by-key")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> UpdateDirectoryEmployeeByKey(
        [FromQuery] string employeeKey,
        UpdateEmployeeDto employee,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(employeeKey)
            || string.IsNullOrWhiteSpace(employee.NombreCompleto)
            || employee.IdArea <= 0)
        {
            return BadRequest(new { Message = "Nombre y departamento son obligatorios." });
        }

        return await employeeService.UpdateDirectoryEmployeeByKey(employeeKey, employee, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = EmployeeNotFound });
    }

    [HttpDelete("employees/directory/by-key")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> DeleteDirectoryEmployeeByKey(
        [FromQuery] string employeeKey,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(employeeKey)) return BadRequest();
        try { return await employeeService.DeleteDirectoryEmployeeByKey(employeeKey, cancellationToken) ? NoContent() : NotFound(); }
        catch (OracleException exception) when (exception.Number == 2292)
        {
            return Conflict(new { Message = EmployeeInUse });
        }
    }
}
