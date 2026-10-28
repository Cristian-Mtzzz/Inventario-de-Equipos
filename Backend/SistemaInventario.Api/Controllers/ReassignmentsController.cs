using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SistemaInventario.Api.Models;
using SistemaInventario.Api.Services;

namespace SistemaInventario.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/admin")]
// Endpoints del historial de reasignaciones y del cambio de responsable de un equipo.
public sealed class ReassignmentsController(IReassignmentService reassignmentService) : ControllerBase
{
    [HttpGet("reassignments")]
    [Authorize(Policy = ModulePolicies.Reassignments)]
    public async Task<ActionResult<IReadOnlyList<ReassignmentDto>>> GetReassignments(CancellationToken cancellationToken) =>
        Ok(await reassignmentService.GetReassignments(cancellationToken));

    [HttpPost("reassignments")]
    [Authorize(Policy = ModulePolicies.Reassignments)]
    // Cambia el responsable sin exigir que exista un número de pago.
    public async Task<IActionResult> CreateReassignment(CreateReassignmentDto reassignment, CancellationToken cancellationToken)
    {
        if (reassignment.IdEquipo <= 0 || reassignment.IdEdificio <= 0 || reassignment.IdArea <= 0)
        {
            return BadRequest(new { Message = "Selecciona el equipo, edificio y departamento de la reasignación." });
        }

        if (!string.IsNullOrWhiteSpace(reassignment.NoPagoNuevo))
        {
            var pago = reassignment.NoPagoNuevo.Trim();
            if (pago.Length > 5 || !pago.All(char.IsDigit))
            {
                return BadRequest(new { Message = "El No. PAGO debe ser numérico y tener un máximo de 5 dígitos." });
            }
        }

        try
        {
            await reassignmentService.CreateReassignment(reassignment, cancellationToken);
            return NoContent();
        }
        catch (InvalidOperationException exception)
        {
            return BadRequest(new { Message = exception.Message });
        }
    }
}
