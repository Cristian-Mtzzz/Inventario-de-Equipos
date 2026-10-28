using System.Security.Claims;

namespace SistemaInventario.Api.Infrastructure;

public static class ClaimsPrincipalExtensions
{
    // ID del usuario autenticado: claim "sub" del JWT, o NameIdentifier si el mapeo de claims lo renombró.
    public static int? GetUserId(this ClaimsPrincipal user) =>
        int.TryParse(user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier), out var userId)
            ? userId
            : null;
}
