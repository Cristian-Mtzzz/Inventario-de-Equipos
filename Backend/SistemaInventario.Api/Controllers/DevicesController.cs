using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Oracle.ManagedDataAccess.Client;
using SistemaInventario.Api.Models;
using SistemaInventario.Api.Services;

namespace SistemaInventario.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/admin")]
// Endpoints de inventario de dispositivos: consulta paginada, alta, combos, edición y baja.
public sealed partial class DevicesController(IDeviceService deviceService) : ControllerBase
{
    private const string DeviceNotFound = "No se encontró el dispositivo indicado.";

    [HttpGet("devices")]
    [Authorize(Policy = ModulePolicies.DeviceSupport)]
    [Authorize(Roles = AppRoles.DeviceViewers)]
    // Lista equipos con tipo, área y responsable actual.
    public async Task<ActionResult<PagedResult<DeviceDto>>> GetDevices(
        [FromQuery] int page,
        [FromQuery] int pageSize,
        [FromQuery] string? searchTerm,
        [FromQuery] string? brand,
        [FromQuery] string? model,
        [FromQuery] int? typeId,
        [FromQuery] int? regionalId,
        [FromQuery] int? buildingId,
        [FromQuery] int? areaId,
        [FromQuery] string? state,
        [FromQuery] bool comboOnly,
        CancellationToken cancellationToken) =>
        Ok(await deviceService.GetDevices(
            page, pageSize, searchTerm, brand, model, typeId, regionalId, buildingId, areaId, state, comboOnly, cancellationToken));

    [HttpGet("device-options")]
    [Authorize(Policy = ModulePolicies.AssignmentSupport)]
    public async Task<ActionResult<IReadOnlyList<DeviceOptionDto>>> SearchDeviceOptions(
        [FromQuery] string? searchTerm,
        CancellationToken cancellationToken) =>
        string.IsNullOrWhiteSpace(searchTerm) || searchTerm.Trim().Length < 2
            ? Ok(Array.Empty<DeviceOptionDto>())
            : Ok(await deviceService.SearchDeviceOptions(searchTerm, cancellationToken));

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

        try
        {
            await deviceService.CreateDevice(device, cancellationToken);
            return CreatedAtAction(nameof(GetDevices), null);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict(new { Message = exception.Message });
        }
    }

    [HttpPost("devices/desktop-combos")]
    [Authorize(Policy = ModulePolicies.Devices)]
    public async Task<IActionResult> CreateDesktopCombo(
        CreateDesktopComboDto combo,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(combo.NCombo) || combo.NCombo.Trim().Length > 50)
        {
            return BadRequest(new { Message = "Ingresa un número de combo válido (máximo 50 caracteres)." });
        }

        if (combo.IdTipo <= 0)
        {
            return BadRequest(new { Message = "Selecciona el tipo COMPUTADORA ESCRITORIO." });
        }

        if (combo.Estado is not ("DISPONIBLE" or "ASIGNADO"))
        {
            return BadRequest(new { Message = "Selecciona un estado válido." });
        }

        var componentesEsperados = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "CPU",
            "MONITOR",
            "TECLADO"
        };
        if (combo.Componentes is null
            || combo.Componentes.Any(component => component is null)
            || combo.Componentes.Count != componentesEsperados.Count
            || !componentesEsperados.SetEquals(combo.Componentes.Select(component => component.Componente)))
        {
            return BadRequest(new { Message = "El combo debe incluir CPU, monitor y teclado, una vez cada uno." });
        }

        var inventoryCodes = new HashSet<string>(StringComparer.Ordinal);
        foreach (var component in combo.Componentes)
        {
            if (string.IsNullOrWhiteSpace(component.CodigoInventario)
                || string.IsNullOrWhiteSpace(component.NoSerie)
                || string.IsNullOrWhiteSpace(component.Marca)
                || string.IsNullOrWhiteSpace(component.Modelo))
            {
                return BadRequest(new { Message = $"Completa inventario, serie, marca y modelo del componente {component.Componente}." });
            }

            var codigo = component.CodigoInventario.Trim();
            if (codigo.Length > 7 || !codigo.All(char.IsDigit))
            {
                return BadRequest(new { Message = $"El inventario de {component.Componente} debe ser numérico y tener un máximo de 7 dígitos." });
            }

            if (!inventoryCodes.Add(codigo))
            {
                return BadRequest(new { Message = "Cada componente del combo debe tener un número de inventario distinto." });
            }
        }

        if (combo.Estado == "ASIGNADO"
            && string.IsNullOrWhiteSpace(combo.NumeroPagoAsignado)
            && string.IsNullOrWhiteSpace(combo.NombreAsignado))
        {
            return BadRequest(new { Message = "Indica el empleado asignado para los tres componentes." });
        }

        try
        {
            await deviceService.CreateDesktopCombo(combo, cancellationToken);
            return CreatedAtAction(nameof(GetDevices), null);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict(new { Message = exception.Message });
        }
    }

    [HttpPut("devices/{idEquipo:int}")]
    [Authorize(Policy = ModulePolicies.Devices)]
    // applyToCombo=true reasigna las tres piezas de un combo; sin él solo cambia este equipo
    // (y el combo se separa si cambia su asignación).
    public async Task<IActionResult> UpdateDevice(
        int idEquipo,
        CreateDeviceDto device,
        [FromQuery] bool applyToCombo,
        CancellationToken cancellationToken)
    {
        var validationMessage = ValidateDevice(device);
        if (validationMessage is not null)
        {
            return BadRequest(new { Message = validationMessage });
        }

        return await deviceService.UpdateDevice(idEquipo, device, applyToCombo, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = DeviceNotFound });
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

        return await deviceService.UpdateDeviceByIdentifier(codigoInventario, noSerie, device, cancellationToken)
            ? NoContent()
            : NotFound(new { Message = DeviceNotFound });
    }

    [HttpDelete("devices/{idEquipo:int}")]
    [Authorize(Policy = ModulePolicies.Devices)]
    // Elimina el equipo y sus reasignaciones relacionadas.
    public async Task<IActionResult> DeleteDevice(int idEquipo, CancellationToken cancellationToken)
    {
        try
        {
            return await deviceService.DeleteDevice(idEquipo, cancellationToken)
                ? NoContent()
                : NotFound(new { Message = DeviceNotFound });
        }
        catch (OracleException exception) when (exception.Number == 2292)
        {
            return Conflict(new { Message = "No se puede quitar el dispositivo porque tiene otros registros relacionados." });
        }
    }

    private static string? ValidateDevice(CreateDeviceDto device)
    {
        if (device.IdTipo is null || device.IdTipo <= 0)
        {
            return "Selecciona un tipo de dispositivo.";
        }

        if (string.IsNullOrWhiteSpace(device.CodigoInventario)
            || string.IsNullOrWhiteSpace(device.NoSerie)
            || string.IsNullOrWhiteSpace(device.Marca)
            || string.IsNullOrWhiteSpace(device.Modelo))
        {
            return "INVENTARIO, SERIE, marca y modelo son obligatorios.";
        }

        var codigo = device.CodigoInventario.Trim();
        if (codigo.Length > 7 || !codigo.All(char.IsDigit))
        {
            return "El número de INVENTARIO debe ser numérico y tener un máximo de 7 dígitos.";
        }

        if (!string.IsNullOrWhiteSpace(device.NumeroPagoAsignado))
        {
            var pago = device.NumeroPagoAsignado.Trim();
            if (pago.Length > 5 || !pago.All(char.IsDigit))
            {
                return "El No. PAGO debe ser numérico y tener un máximo de 5 dígitos.";
            }
        }

        if (!string.IsNullOrWhiteSpace(device.NumeroIngreso)
            && !NumeroIngresoFormat().IsMatch(device.NumeroIngreso.Trim()))
        {
            return "El número de ingreso debe tener el formato 00001-01-2026 (número-mes-año).";
        }

        return null;
    }

    // NNNNN-MM-AAAA: número del equipo en el Excel, mes (01-12) y año de ingreso.
    [GeneratedRegex(@"^\d{5}-(0[1-9]|1[0-2])-\d{4}$")]
    private static partial Regex NumeroIngresoFormat();
}
