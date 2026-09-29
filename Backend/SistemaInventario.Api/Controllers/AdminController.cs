using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Oracle.ManagedDataAccess.Client;
using System.Security.Claims;
using SistemaInventario.Api.Models;
using SistemaInventario.Api.Services;

namespace SistemaInventario.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/admin")]
// Fachada HTTP del módulo administrativo: valida solicitudes, aplica roles y
// delega inventario, reasignaciones y usuarios al AdminService.
public sealed class AdminController(IAdminService adminService, IModulePermissionService modulePermissions) : ControllerBase
{
    [HttpGet("devices")]
    [Authorize(Policy = ModulePolicies.Devices)]
    // Lista equipos con tipo, área y responsable actual.
    public async Task<ActionResult<PagedResult<DeviceDto>>> GetDevices(
        [FromQuery] int page,
        [FromQuery] int? pageSize,
        [FromQuery] string? searchTerm,
        [FromQuery] string? brand,
        [FromQuery] string? model,
        [FromQuery] int? typeId,
        [FromQuery] int? regionalId,
        [FromQuery] int? buildingId,
        [FromQuery] int? areaId,
        CancellationToken cancellationToken) =>
        Ok(await adminService.GetDevices(
            page, pageSize ?? 25, searchTerm, brand, model, typeId, regionalId, buildingId, areaId, cancellationToken));

    [HttpGet("device-options")]
    [Authorize(Policy = ModulePolicies.AssignmentSupport)]
    public async Task<ActionResult<IReadOnlyList<DeviceOptionDto>>> SearchDeviceOptions(
        [FromQuery] string? searchTerm,
        CancellationToken cancellationToken) =>
        string.IsNullOrWhiteSpace(searchTerm) || searchTerm.Trim().Length < 2
            ? Ok(Array.Empty<DeviceOptionDto>())
            : Ok(await adminService.SearchDeviceOptions(searchTerm, cancellationToken));

    [HttpGet("device-types")]
    [Authorize(Policy = ModulePolicies.DeviceSupport)]
    public async Task<ActionResult<IReadOnlyList<DeviceTypeDto>>> GetDeviceTypes(CancellationToken cancellationToken) =>
        Ok(await adminService.GetDeviceTypes(cancellationToken));

    [HttpGet("employees/search")]
    [Authorize(Policy = ModulePolicies.DeviceSupport)]
    public async Task<ActionResult<IReadOnlyList<EmployeeSearchDto>>> SearchEmployees(
        [FromQuery] string? searchTerm,
        CancellationToken cancellationToken) =>
        string.IsNullOrWhiteSpace(searchTerm) || searchTerm.Trim().Length < 2
            ? Ok(Array.Empty<EmployeeSearchDto>())
            : Ok(await adminService.SearchEmployees(searchTerm, cancellationToken));

    [HttpGet("employees/options")]
    [Authorize(Policy = ModulePolicies.AssignmentSupport)]
    public async Task<ActionResult<IReadOnlyList<EmployeeOptionDto>>> GetEmployeeOptions(
        CancellationToken cancellationToken) =>
        Ok(await adminService.GetEmployeeOptions(cancellationToken));

    [HttpGet("employees/directory")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<ActionResult<IReadOnlyList<DirectoryEmployeeDto>>> GetDirectoryEmployees(
        CancellationToken cancellationToken) =>
        Ok(await adminService.GetDirectoryEmployees(cancellationToken));

    [HttpPut("employees/{noPagoActual}")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> UpdateEmployee(
        string noPagoActual,
        UpdateEmployeeDto employee,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(noPagoActual)
            || string.IsNullOrWhiteSpace(employee.NombreCompleto)
            || string.IsNullOrWhiteSpace(employee.NoPago)
            || employee.IdArea <= 0)
        {
            return BadRequest(new { Message = "Nombre, número de pago y departamento son obligatorios." });
        }

        return await adminService.UpdateEmployee(noPagoActual, employee, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "No se encontró el empleado indicado." });
    }

    [HttpGet("buildings")]
    [Authorize(Policy = ModulePolicies.DeviceSupport)]
    public async Task<ActionResult<IReadOnlyList<BuildingDto>>> GetBuildings(CancellationToken cancellationToken) =>
        Ok(await adminService.GetBuildings(cancellationToken));

    [HttpGet("regionals")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<ActionResult<IReadOnlyList<RegionalDto>>> GetRegionals(CancellationToken cancellationToken) =>
        Ok(await adminService.GetRegionals(cancellationToken));

    [HttpGet("catalog/departments")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<ActionResult<IReadOnlyList<CatalogDepartmentDto>>> GetCatalogDepartments(CancellationToken cancellationToken) =>
        Ok(await adminService.GetCatalogDepartments(cancellationToken));

    [HttpPost("regionals")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> CreateRegional(SaveRegionalDto regional, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(regional.NombreRegional)) return BadRequest(new { Message = "El nombre de la regional es obligatorio." });
        try
        {
            await adminService.CreateRegional(regional, cancellationToken);
            return CreatedAtAction(nameof(GetRegionals), null);
        }
        catch (OracleException exception) when (exception.Number == 1)
        {
            return Conflict(new { Message = "Ya existe una regional con ese identificador." });
        }
    }

    [HttpPut("regionals/{idRegional:int}")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> UpdateRegional(int idRegional, SaveRegionalDto regional, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(regional.NombreRegional)) return BadRequest(new { Message = "El nombre de la regional es obligatorio." });
        return await adminService.UpdateRegional(idRegional, regional, cancellationToken) ? NoContent() : NotFound();
    }

    [HttpDelete("regionals/{idRegional:int}")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> DeleteRegional(int idRegional, CancellationToken cancellationToken)
    {
        try { return await adminService.DeleteRegional(idRegional, cancellationToken) ? NoContent() : NotFound(); }
        catch (OracleException exception) when (exception.Number == 2292)
        {
            return Conflict(new { Message = "No se puede eliminar la regional porque tiene edificios asociados." });
        }
    }

    [HttpPost("buildings")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> CreateBuilding(SaveBuildingDto building, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(building.NombreEdificio) || building.IdRegional <= 0)
            return BadRequest(new { Message = "Nombre y regional del edificio son obligatorios." });
        try
        {
            await adminService.CreateBuilding(building, cancellationToken);
            return CreatedAtAction(nameof(GetBuildings), null);
        }
        catch (OracleException exception) when (exception.Number == 1)
        {
            return Conflict(new { Message = "No se pudo crear el edificio por un identificador duplicado." });
        }
    }

    [HttpPut("buildings/{idEdificio:int}")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> UpdateBuilding(int idEdificio, SaveBuildingDto building, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(building.NombreEdificio) || building.IdRegional <= 0)
            return BadRequest(new { Message = "Nombre y regional del edificio son obligatorios." });
        return await adminService.UpdateBuilding(idEdificio, building, cancellationToken) ? NoContent() : NotFound();
    }

    [HttpDelete("buildings/{idEdificio:int}")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> DeleteBuilding(int idEdificio, CancellationToken cancellationToken)
    {
        try { return await adminService.DeleteBuilding(idEdificio, cancellationToken) ? NoContent() : NotFound(); }
        catch (OracleException exception) when (exception.Number == 2292)
        {
            return Conflict(new { Message = "No se puede eliminar el edificio porque tiene departamentos asociados." });
        }
    }

    [HttpPost("departments")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> CreateDepartment(SaveDepartmentDto department, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(department.NombreArea) || department.IdEdificio <= 0)
            return BadRequest(new { Message = "Nombre y edificio del departamento son obligatorios." });
        try
        {
            await adminService.CreateDepartment(department, cancellationToken);
            return CreatedAtAction(nameof(GetCatalogDepartments), null);
        }
        catch (OracleException exception) when (exception.Number == 1)
        {
            return Conflict(new { Message = "No se pudo crear el departamento por un identificador duplicado." });
        }
    }

    [HttpPut("departments/{idArea:int}")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> UpdateDepartment(int idArea, SaveDepartmentDto department, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(department.NombreArea) || department.IdEdificio <= 0)
            return BadRequest(new { Message = "Nombre y edificio del departamento son obligatorios." });
        return await adminService.UpdateDepartment(idArea, department, cancellationToken) ? NoContent() : NotFound();
    }

    [HttpDelete("departments/{idArea:int}")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> DeleteDepartment(int idArea, CancellationToken cancellationToken)
    {
        try { return await adminService.DeleteDepartment(idArea, cancellationToken) ? NoContent() : NotFound(); }
        catch (OracleException exception) when (exception.Number == 2292)
        {
            return Conflict(new { Message = "No se puede eliminar el departamento porque tiene empleados o equipos asociados." });
        }
    }

    [HttpPost("employees/directory")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> CreateDirectoryEmployee(SaveDirectoryEmployeeDto employee, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(employee.NoPago) || string.IsNullOrWhiteSpace(employee.NombreCompleto) || employee.IdArea <= 0)
            return BadRequest(new { Message = "Número de pago, nombre y departamento son obligatorios." });
        try
        {
            await adminService.CreateDirectoryEmployee(employee, cancellationToken);
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
        try { return await adminService.DeleteDirectoryEmployee(noPago, cancellationToken) ? NoContent() : NotFound(); }
        catch (OracleException exception) when (exception.Number == 2292)
        {
            return Conflict(new { Message = "No se puede eliminar el empleado porque tiene dispositivos o reasignaciones asociadas." });
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
            || string.IsNullOrWhiteSpace(employee.NoPago)
            || employee.IdArea <= 0)
        {
            return BadRequest(new { Message = "Nombre, número de pago y departamento son obligatorios." });
        }

        return await adminService.UpdateDirectoryEmployeeByKey(employeeKey, employee, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "No se encontró el empleado indicado." });
    }

    [HttpDelete("employees/directory/by-key")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> DeleteDirectoryEmployeeByKey(
        [FromQuery] string employeeKey,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(employeeKey)) return BadRequest();
        try { return await adminService.DeleteDirectoryEmployeeByKey(employeeKey, cancellationToken) ? NoContent() : NotFound(); }
        catch (OracleException exception) when (exception.Number == 2292)
        {
            return Conflict(new { Message = "No se puede eliminar el empleado porque tiene dispositivos o reasignaciones asociadas." });
        }
    }

    [HttpGet("areas/{idEdificio:int}")]
    [Authorize(Policy = ModulePolicies.DeviceSupport)]
    public async Task<ActionResult<IReadOnlyList<AreaDto>>> GetAreas(int idEdificio, CancellationToken cancellationToken) =>
        Ok(await adminService.GetAreas(idEdificio, cancellationToken));

    [HttpPost("devices")]
    [Authorize(Policy = ModulePolicies.Devices)]
    // Valida y registra un equipo nuevo.
    public async Task<IActionResult> CreateDevice(CreateDeviceDto device, CancellationToken cancellationToken)
    {
        var validationMessage = ValidateDevice(device);
        if (validationMessage is not null)
        {
            return BadRequest(new { Message = validationMessage });
        }

        await adminService.CreateDevice(device, cancellationToken);
        return CreatedAtAction(nameof(GetDevices), null);
    }

    [HttpPut("devices/{idEquipo:int}")]
    [Authorize(Policy = ModulePolicies.Devices)]
    public async Task<IActionResult> UpdateDevice(int idEquipo, CreateDeviceDto device, CancellationToken cancellationToken)
    {
        var validationMessage = ValidateDevice(device);
        if (validationMessage is not null)
        {
            return BadRequest(new { Message = validationMessage });
        }

        await adminService.UpdateDevice(idEquipo, device, cancellationToken);
        return NoContent();
    }

    [HttpPut("devices/by-identifier")]
    [Authorize(Policy = ModulePolicies.Devices)]
    // Actualiza usando el código o la serie originales, aunque el usuario los modifique.
    public async Task<IActionResult> UpdateDeviceByIdentifier(
        [FromQuery] string? codigoInventario,
        [FromQuery] string? noSerie,
        CreateDeviceDto device,
        CancellationToken cancellationToken)
    {
        var validationMessage = ValidateDevice(device);
        if (validationMessage is not null)
        {
            return BadRequest(new { Message = validationMessage });
        }

        if (string.IsNullOrWhiteSpace(codigoInventario) && string.IsNullOrWhiteSpace(noSerie))
        {
            return BadRequest(new { Message = "Indica el código de inventario o el número de serie original." });
        }

        await adminService.UpdateDeviceByIdentifier(codigoInventario, noSerie, device, cancellationToken);
        return NoContent();
    }

    [HttpDelete("devices/{idEquipo:int}")]
    [Authorize(Policy = ModulePolicies.Devices)]
    // Elimina el equipo y sus reasignaciones relacionadas.
    public async Task<IActionResult> DeleteDevice(int idEquipo, CancellationToken cancellationToken)
    {
        try
        {
            await adminService.DeleteDevice(idEquipo, cancellationToken);
            return NoContent();
        }
        catch (OracleException exception) when (exception.Number == 2292)
        {
            return Conflict(new { Message = "No se puede quitar el dispositivo porque tiene otros registros relacionados." });
        }
    }

    [HttpGet("reassignments")]
    [Authorize(Policy = ModulePolicies.Reassignments)]
    public async Task<ActionResult<IReadOnlyList<ReassignmentDto>>> GetReassignments(CancellationToken cancellationToken) =>
        Ok(await adminService.GetReassignments(cancellationToken));

    [HttpPost("reassignments")]
    [Authorize(Policy = ModulePolicies.Reassignments)]
    // Cambia el responsable sin exigir que exista un número de pago.
    public async Task<IActionResult> CreateReassignment(CreateReassignmentDto reassignment, CancellationToken cancellationToken)
    {
        if (reassignment.IdEquipo <= 0 || reassignment.IdEdificio <= 0 || reassignment.IdArea <= 0)
        {
            return BadRequest(new { Message = "Selecciona el equipo, edificio y departamento de la reasignación." });
        }

        try
        {
            await adminService.CreateReassignment(reassignment, cancellationToken);
            return NoContent();
        }
        catch (InvalidOperationException exception)
        {
            return BadRequest(new { Message = exception.Message });
        }
    }

    [HttpDelete("reassignments/{idReasignacion:int}")]
    [Authorize(Policy = ModulePolicies.Reassignments)]
    public async Task<IActionResult> DeleteReassignment(int idReasignacion, CancellationToken cancellationToken)
    {
        await adminService.DeleteReassignment(idReasignacion, cancellationToken);
        return NoContent();
    }

    [HttpGet("users")]
    [Authorize(Policy = ModulePolicies.Users)]
    public async Task<ActionResult<IReadOnlyList<AdminUserDto>>> GetUsers(CancellationToken cancellationToken) =>
        Ok(await adminService.GetUsers(cancellationToken));

    [HttpPost("users")]
    [Authorize(Policy = ModulePolicies.Users)]
    public async Task<IActionResult> CreateUser(CreateAdminUserDto user, CancellationToken cancellationToken)
    {
        var validationMessage = ValidateUser(user);
        validationMessage ??= ValidateModules(user.Modules);
        if (validationMessage is not null)
        {
            return BadRequest(new { Message = validationMessage });
        }
        if (user.IsSuperAdmin && !await CurrentUserIsSuperAdmin(cancellationToken)) return Forbid();

        try
        {
            await adminService.CreateUser(user, cancellationToken);
            return NoContent();
        }
        catch (OracleException exception) when (exception.Number == 1)
        {
            return Conflict(new { Message = "Ya existe un usuario con ese nombre." });
        }
    }

    [HttpPut("users/{idUsuario:int}")]
    [Authorize(Policy = ModulePolicies.Users)]
    public async Task<IActionResult> UpdateUser(
        int idUsuario,
        UpdateAdminUserDto user,
        CancellationToken cancellationToken)
    {
        var validationMessage = ValidateUser(user);
        validationMessage ??= ValidateModules(user.Modules);
        if (validationMessage is not null)
        {
            return BadRequest(new { Message = validationMessage });
        }

        var actorIsSuperAdmin = await CurrentUserIsSuperAdmin(cancellationToken);
        var targetIsSuperAdmin = await modulePermissions.HasAnyModule(idUsuario, [AppModules.SuperAdmin], cancellationToken);
        if ((user.IsSuperAdmin || targetIsSuperAdmin) && !actorIsSuperAdmin) return Forbid();
        if (targetIsSuperAdmin && !user.IsSuperAdmin && await modulePermissions.GetSuperAdminCount(cancellationToken) <= 1)
        {
            return Conflict(new { Message = "Debe permanecer al menos un administrador total." });
        }

        return await adminService.UpdateUser(idUsuario, user, cancellationToken)
            ? NoContent()
            : NotFound();
    }

    [HttpPost("users/{idUsuario:int}/reset-password")]
    [Authorize(Policy = ModulePolicies.Users)]
    public async Task<IActionResult> ResetUserPassword(int idUsuario, CancellationToken cancellationToken) =>
        await adminService.ResetUserPassword(idUsuario, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = "No existe el usuario local indicado." });

    [HttpDelete("users/{idUsuario:int}")]
    [Authorize(Policy = ModulePolicies.Users)]
    // Elimina usuarios y traduce conflictos de integridad a una respuesta 409.
    public async Task<IActionResult> DeleteUser(int idUsuario, CancellationToken cancellationToken)
    {
        var actorIsSuperAdmin = await CurrentUserIsSuperAdmin(cancellationToken);
        var targetIsSuperAdmin = await modulePermissions.HasAnyModule(idUsuario, [AppModules.SuperAdmin], cancellationToken);
        if (targetIsSuperAdmin && !actorIsSuperAdmin) return Forbid();
        if (targetIsSuperAdmin && await modulePermissions.GetSuperAdminCount(cancellationToken) <= 1)
        {
            return Conflict(new { Message = "Debe permanecer al menos un administrador total." });
        }
        try
        {
            await adminService.DeleteUser(idUsuario, cancellationToken);
            return NoContent();
        }
        catch (OracleException exception) when (exception.Number == 2292)
        {
            return Conflict(new { Message = "No se puede quitar este usuario porque tiene registros relacionados." });
        }
    }

    private static string? ValidateDevice(CreateDeviceDto device)
    {
        if (string.IsNullOrWhiteSpace(device.CodigoInventario)
            || string.IsNullOrWhiteSpace(device.NoSerie)
            || string.IsNullOrWhiteSpace(device.Marca)
            || string.IsNullOrWhiteSpace(device.Modelo))
        {
            return "Código, número de serie, marca y modelo son obligatorios.";
        }

        return device.IdTipo is null
            ? "Selecciona un tipo de dispositivo."
            : null;
    }

    private static string? ValidateUser(CreateAdminUserDto user)
    {
        if (string.IsNullOrWhiteSpace(user.Usuario) || string.IsNullOrWhiteSpace(user.NombrePersona))
        {
            return "El usuario y el nombre de la persona son obligatorios.";
        }

        return ValidateUserFields(user.DominioP, user.Dominio, user.Estado);
    }

    private static string? ValidateUser(UpdateAdminUserDto user)
    {
        if (string.IsNullOrWhiteSpace(user.NombrePersona))
        {
            return "El nombre de la persona es obligatorio.";
        }

        return ValidateUserFields(user.DominioP, user.Dominio, user.Estado);
    }

    private static string? ValidateUserFields(string dominioP, int dominio, string estado)
    {
        if (dominio is not 0 and not 1)
        {
            return "El tipo de autenticación debe ser local o Active Directory.";
        }

        if (dominioP.Trim().ToUpperInvariant() is not ("BA" or "HE" or "HRN" or "IVM"))
        {
            return "El dominio debe ser BA, HE, HRN o IVM.";
        }

        return estado.Trim().ToUpperInvariant() is "ACTIVO" or "INACTIVO"
            ? null
            : "El estado debe ser ACTIVO o INACTIVO.";
    }

    private static string? ValidateModules(IReadOnlyList<string>? modules)
    {
        if (modules is null) return "Selecciona los módulos del usuario.";
        if (modules.Any(module => !AppModules.Assignable.Contains(module, StringComparer.OrdinalIgnoreCase)))
        {
            return "La selección contiene un módulo no válido.";
        }
        return null;
    }

    private async Task<bool> CurrentUserIsSuperAdmin(CancellationToken cancellationToken)
    {
        var userIdValue = User.FindFirstValue("sub") ?? User.FindFirstValue(System.Security.Claims.ClaimTypes.NameIdentifier);
        return int.TryParse(userIdValue, out var userId)
            && await modulePermissions.HasAnyModule(userId, [AppModules.SuperAdmin], cancellationToken);
    }
}