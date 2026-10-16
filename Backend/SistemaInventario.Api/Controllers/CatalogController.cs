using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Oracle.ManagedDataAccess.Client;
using SistemaInventario.Api.Models;
using SistemaInventario.Api.Services;

namespace SistemaInventario.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/admin")]
// Endpoints de catálogos: tipos de dispositivo, regionales, edificios y departamentos.
// La lectura la usan los formularios de varios módulos; la edición exige MANTENIMIENTO.
public sealed class CatalogController(ICatalogService catalogService) : ControllerBase
{
    [HttpGet("device-types")]
    [Authorize(Policy = ModulePolicies.DeviceSupport)]
    [Authorize(Roles = AppRoles.CatalogViewers)]
    public async Task<ActionResult<IReadOnlyList<DeviceTypeDto>>> GetDeviceTypes(CancellationToken cancellationToken) =>
        Ok(await catalogService.GetDeviceTypes(cancellationToken));

    [HttpGet("catalog/device-types")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<ActionResult<IReadOnlyList<DeviceTypeDto>>> GetCatalogDeviceTypes(CancellationToken cancellationToken) =>
        Ok(await catalogService.GetDeviceTypes(cancellationToken));

    [HttpPost("device-types")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> CreateDeviceType(SaveDeviceTypeDto deviceType, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(deviceType.TipoDispositivo))
            return BadRequest(new { Message = "El nombre del tipo de dispositivo es obligatorio." });
        try
        {
            await catalogService.CreateDeviceType(deviceType, cancellationToken);
            return CreatedAtAction(nameof(GetCatalogDeviceTypes), null);
        }
        catch (OracleException exception) when (exception.Number == 1)
        {
            return Conflict(new { Message = "No se pudo crear el tipo de dispositivo por un identificador duplicado." });
        }
    }

    [HttpPut("device-types/{idTipo:int}")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> UpdateDeviceType(int idTipo, SaveDeviceTypeDto deviceType, CancellationToken cancellationToken)
    {
        if (idTipo <= 0 || string.IsNullOrWhiteSpace(deviceType.TipoDispositivo))
            return BadRequest(new { Message = "El nombre del tipo de dispositivo es obligatorio." });
        return await catalogService.UpdateDeviceType(idTipo, deviceType, cancellationToken) ? NoContent() : NotFound();
    }

    [HttpDelete("device-types/{idTipo:int}")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> DeleteDeviceType(int idTipo, CancellationToken cancellationToken)
    {
        try { return await catalogService.DeleteDeviceType(idTipo, cancellationToken) ? NoContent() : NotFound(); }
        catch (OracleException exception) when (exception.Number == 2292)
        {
            return Conflict(new { Message = "No se puede eliminar el tipo porque hay equipos que lo utilizan." });
        }
    }

    [HttpGet("buildings")]
    [Authorize(Policy = ModulePolicies.LocationCatalogs)]
    [Authorize(Roles = AppRoles.CatalogViewers)]
    public async Task<ActionResult<IReadOnlyList<BuildingDto>>> GetBuildings(CancellationToken cancellationToken) =>
        Ok(await catalogService.GetBuildings(cancellationToken));

    [HttpGet("areas/{idEdificio:int}")]
    [Authorize(Policy = ModulePolicies.LocationCatalogs)]
    [Authorize(Roles = AppRoles.CatalogViewers)]
    public async Task<ActionResult<IReadOnlyList<AreaDto>>> GetAreas(int idEdificio, CancellationToken cancellationToken) =>
        Ok(await catalogService.GetAreas(idEdificio, cancellationToken));

    [HttpGet("regionals")]
    [Authorize(Policy = ModulePolicies.LocationCatalogs)]
    [Authorize(Roles = AppRoles.CatalogViewers)]
    public async Task<ActionResult<IReadOnlyList<RegionalDto>>> GetRegionals(CancellationToken cancellationToken) =>
        Ok(await catalogService.GetRegionals(cancellationToken));

    [HttpGet("catalog/departments")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<ActionResult<IReadOnlyList<CatalogDepartmentDto>>> GetCatalogDepartments(CancellationToken cancellationToken) =>
        Ok(await catalogService.GetCatalogDepartments(cancellationToken));

    [HttpPost("regionals")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> CreateRegional(SaveRegionalDto regional, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(regional.NombreRegional)) return BadRequest(new { Message = "El nombre de la regional es obligatorio." });
        try
        {
            await catalogService.CreateRegional(regional, cancellationToken);
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
        return await catalogService.UpdateRegional(idRegional, regional, cancellationToken) ? NoContent() : NotFound();
    }

    [HttpDelete("regionals/{idRegional:int}")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> DeleteRegional(int idRegional, CancellationToken cancellationToken)
    {
        try { return await catalogService.DeleteRegional(idRegional, cancellationToken) ? NoContent() : NotFound(); }
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
            await catalogService.CreateBuilding(building, cancellationToken);
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
        return await catalogService.UpdateBuilding(idEdificio, building, cancellationToken) ? NoContent() : NotFound();
    }

    [HttpDelete("buildings/{idEdificio:int}")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> DeleteBuilding(int idEdificio, CancellationToken cancellationToken)
    {
        try { return await catalogService.DeleteBuilding(idEdificio, cancellationToken) ? NoContent() : NotFound(); }
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
            await catalogService.CreateDepartment(department, cancellationToken);
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
        return await catalogService.UpdateDepartment(idArea, department, cancellationToken) ? NoContent() : NotFound();
    }

    [HttpDelete("departments/{idArea:int}")]
    [Authorize(Policy = ModulePolicies.Maintenance)]
    public async Task<IActionResult> DeleteDepartment(int idArea, CancellationToken cancellationToken)
    {
        try { return await catalogService.DeleteDepartment(idArea, cancellationToken) ? NoContent() : NotFound(); }
        catch (OracleException exception) when (exception.Number == 2292)
        {
            return Conflict(new { Message = "No se puede eliminar el departamento porque tiene empleados o equipos asociados." });
        }
    }
}
