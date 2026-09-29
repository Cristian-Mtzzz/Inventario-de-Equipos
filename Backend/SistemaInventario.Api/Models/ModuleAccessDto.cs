namespace SistemaInventario.Api.Models;

/// <summary>Current module access for the authenticated account.</summary>
public sealed record ModuleAccessDto(IReadOnlyList<string> Modules, bool IsSuperAdmin);