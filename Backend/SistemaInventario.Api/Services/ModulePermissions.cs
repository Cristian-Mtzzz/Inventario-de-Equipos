using Microsoft.AspNetCore.Authorization;
using Oracle.ManagedDataAccess.Client;
using SistemaInventario.Api.Data;
using SistemaInventario.Api.Infrastructure;

namespace SistemaInventario.Api.Services;

public static class AppModules
{
    public const string Devices = "DISPOSITIVOS";
    public const string Reassignments = "REASIGNACIONES";
    public const string Workshop = "TALLER";
    public const string Users = "USUARIOS";
    public const string Maintenance = "MANTENIMIENTO";
    public const string Employees = "EMPLEADOS";
    public const string Tickets = "TICKETS";
    public const string Inventory = "INVENTARIO";
    public const string SuperAdmin = "ADMIN_TOTAL";

    public static readonly string[] Assignable =
    [Devices, Reassignments, Workshop, Users, Maintenance, Employees, Tickets, Inventory];

    public static readonly string[] AdminPanel =
    [Devices, Reassignments, Workshop, Users, Maintenance, Employees, Tickets];
}

public static class ModulePolicies
{
    public const string AdminPanel = "ModuleAdminPanel";
    public const string Devices = "ModuleDevices";
    public const string Reassignments = "ModuleReassignments";
    public const string Workshop = "ModuleWorkshop";
    public const string Users = "ModuleUsers";
    public const string Maintenance = "ModuleMaintenance";
    public const string Employees = "ModuleEmployees";
    public const string Tickets = "ModuleTickets";
    public const string Inventory = "ModuleInventory";
    public const string DeviceSupport = "ModuleDeviceSupport";
    public const string AssignmentSupport = "ModuleAssignmentSupport";
    public const string LocationCatalogs = "ModuleLocationCatalogs";
    public const string EmployeeLookup = "ModuleEmployeeLookup";
    public const string SuperAdmin = "ModuleSuperAdmin";
}

public sealed class ModuleAccessRequirement(params string[] modules) : IAuthorizationRequirement
{
    public IReadOnlyList<string> Modules { get; } = modules;
}

public interface IModulePermissionService
{
    Task<IReadOnlyList<string>> GetModules(int userId, CancellationToken cancellationToken);
    Task<bool> HasAnyModule(int userId, IReadOnlyCollection<string> modules, CancellationToken cancellationToken);
    Task<int> GetSuperAdminCount(CancellationToken cancellationToken);
}

public sealed class ModulePermissionService(InventoryDbContext dbContext) : OracleRepository(dbContext), IModulePermissionService
{
    // ORA-00942: la tabla USUARIO_MODULOS todavía no existe; se trata como "sin módulos".
    private const int TableNotFound = 942;

    // El servicio es Scoped: la caché vive solo durante una solicitud HTTP. Evita repetir
    // la consulta cuando un endpoint evalúa varias políticas, sin retrasar cambios de permisos.
    private readonly Dictionary<int, IReadOnlyList<string>> modulesByUser = [];

    public async Task<IReadOnlyList<string>> GetModules(int userId, CancellationToken cancellationToken)
    {
        if (modulesByUser.TryGetValue(userId, out var cachedModules)) return cachedModules;
        var modules = await LoadModules(userId, cancellationToken);
        modulesByUser[userId] = modules;
        return modules;
    }

    private async Task<IReadOnlyList<string>> LoadModules(int userId, CancellationToken cancellationToken)
    {
        try
        {
            // A los módulos guardados se suman los que implica el rol, para que un permiso
            // que depende del rol valga aunque el usuario se haya creado antes de existir
            // ese módulo y nadie lo haya vuelto a guardar.
            var modules = await ReadList("""
                SELECT MODULO FROM USUARIO_MODULOS WHERE ID_USUARIO = :userId
                UNION
                SELECT :impliedModule FROM USUARIOS
                WHERE ID_USUARIO = :userId AND ROL = :impliedRole
                """, reader => ReadNullableString(reader, "MODULO"), cancellationToken,
                ("userId", userId), ("impliedModule", AppModules.Tickets), ("impliedRole", AppRoles.TecnicoTaller));
            return modules.OfType<string>().ToList();
        }
        catch (OracleException ex) when (ex.Number == TableNotFound)
        {
            return [];
        }
    }

    public async Task<bool> HasAnyModule(
        int userId,
        IReadOnlyCollection<string> modules,
        CancellationToken cancellationToken)
    {
        var currentModules = await GetModules(userId, cancellationToken);
        return currentModules.Contains(AppModules.SuperAdmin, StringComparer.OrdinalIgnoreCase)
            || modules.Any(module => currentModules.Contains(module, StringComparer.OrdinalIgnoreCase));
    }

    public async Task<int> GetSuperAdminCount(CancellationToken cancellationToken)
    {
        try
        {
            var counts = await ReadList("SELECT COUNT(*) AS TOTAL FROM USUARIO_MODULOS WHERE MODULO = :module",
                reader => ReadInt(reader, "TOTAL"), cancellationToken, ("module", AppModules.SuperAdmin));
            return counts[0];
        }
        catch (OracleException ex) when (ex.Number == TableNotFound)
        {
            return 0;
        }
    }
}

public sealed class ModuleAccessAuthorizationHandler(IModulePermissionService permissions)
    : AuthorizationHandler<ModuleAccessRequirement>
{
    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        ModuleAccessRequirement requirement)
    {
        if (context.User.GetUserId() is { } userId
            && await permissions.HasAnyModule(userId, requirement.Modules, CancellationToken.None))
        {
            context.Succeed(requirement);
        }
    }
}