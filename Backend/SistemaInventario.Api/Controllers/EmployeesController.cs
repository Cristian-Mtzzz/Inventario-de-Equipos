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

    [HttpPut("employees/{noPagoActual}")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> UpdateEmployee(
        string noPagoActual,
        UpdateEmployeeDto employee,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(noPagoActual)
            || string.IsNullOrWhiteSpace(employee.NombreCompleto)
            || employee.IdArea <= 0)
        {
            return BadRequest(new { Message = "Nombre y departamento son obligatorios." });
        }

        return await employeeService.UpdateEmployee(noPagoActual, employee, cancellationToken)
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

    [HttpDelete("employees/directory/{noPago}")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> DeleteDirectoryEmployee(string noPago, CancellationToken cancellationToken)
    {
        try { return await employeeService.DeleteDirectoryEmployee(noPago, cancellationToken) ? NoContent() : NotFound(); }
        catch (OracleException exception) when (exception.Number == 2292)
        {
            return Conflict(new { Message = EmployeeInUse });
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
