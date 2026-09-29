using System.Data;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Oracle.ManagedDataAccess.Client;
using SistemaInventario.Api.Data;

namespace SistemaInventario.Api.Services;

public static class AppModules
{
    public const string Devices = "DISPOSITIVOS";
    public const string Reassignments = "REASIGNACIONES";
    public const string Workshop = "TALLER";
    public const string Users = "USUARIOS";
    public const string Maintenance = "MANTENIMIENTO";
    public const string Inventory = "INVENTARIO";
    public const string SuperAdmin = "ADMIN_TOTAL";

    public static readonly string[] Assignable =
    [Devices, Reassignments, Workshop, Users, Maintenance, Inventory];

    public static readonly string[] AdminPanel =
    [Devices, Reassignments, Workshop, Users, Maintenance];
}

public static class ModulePolicies
{
    public const string AdminPanel = "ModuleAdminPanel";
    public const string Devices = "ModuleDevices";
    public const string Reassignments = "ModuleReassignments";
    public const string Workshop = "ModuleWorkshop";
    public const string Users = "ModuleUsers";
    public const string Maintenance = "ModuleMaintenance";
    public const string Inventory = "ModuleInventory";
    public const string DeviceSupport = "ModuleDeviceSupport";
    public const string AssignmentSupport = "ModuleAssignmentSupport";
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

public sealed class ModulePermissionService(InventoryDbContext dbContext) : IModulePermissionService
{
    public async Task<IReadOnlyList<string>> GetModules(int userId, CancellationToken cancellationToken)
    {
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = dbContext.Database.GetDbConnection().CreateCommand();
            command.CommandText = "SELECT MODULO FROM USUARIO_MODULOS WHERE ID_USUARIO = :userId";
            AddUserId(command, userId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var modules = new List<string>();
            while (await reader.ReadAsync(cancellationToken))
            {
                if (!reader.IsDBNull(0)) modules.Add(reader.GetString(0));
            }
            return modules;
        }
        catch (OracleException ex) when (ex.Number == 942)
        {
            return Array.Empty<string>();
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
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
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = dbContext.Database.GetDbConnection().CreateCommand();
            command.CommandText = "SELECT COUNT(*) FROM USUARIO_MODULOS WHERE MODULO = :module";
            var parameter = command.CreateParameter();
            parameter.ParameterName = "module";
            parameter.DbType = DbType.String;
            parameter.Value = AppModules.SuperAdmin;
            command.Parameters.Add(parameter);
            return Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
        }
        catch (OracleException ex) when (ex.Number == 942)
        {
            return 0;
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
    }

    private static void AddUserId(System.Data.Common.DbCommand command, int userId)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = "userId";
        parameter.DbType = DbType.Int32;
        parameter.Value = userId;
        command.Parameters.Add(parameter);
    }
}

public sealed class ModuleAccessAuthorizationHandler(IModulePermissionService permissions)
    : AuthorizationHandler<ModuleAccessRequirement>
{
    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        ModuleAccessRequirement requirement)
    {
        var userIdValue = context.User.FindFirstValue("sub")
            ?? context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (int.TryParse(userIdValue, out var userId)
            && await permissions.HasAnyModule(userId, requirement.Modules, CancellationToken.None))
        {
            context.Succeed(requirement);
        }
    }
}