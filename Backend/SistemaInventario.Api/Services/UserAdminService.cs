using System.Data.Common;
using SistemaInventario.Api.Data;
using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Persistencia de la administración de usuarios del sistema y sus módulos de acceso.
public sealed class UserAdminService(InventoryDbContext dbContext) : OracleRepository(dbContext), IUserAdminService
{
    // Contraseña con la que se crean o restablecen los usuarios locales; se pide cambiarla al entrar.
    private const string InitialPassword = "1234";

    public async Task<IReadOnlyList<AdminUserDto>> GetUsers(CancellationToken cancellationToken)
    {
        var rows = await ReadList("""
            SELECT u.ID_USUARIO, u.USUARIO, u.NOMBRE_PERSONA, u.FECHA_EXPIRACION,
                   u.ESTADO, u.DOMINIOP, u.DOMINIO, u.ROL, u.CLAVE_SEGURA, p.MODULO
            FROM USUARIOS u
            LEFT JOIN USUARIO_MODULOS p ON p.ID_USUARIO = u.ID_USUARIO
            ORDER BY u.ID_USUARIO, p.MODULO
            """, reader => (
                IdUsuario: ReadInt(reader, "ID_USUARIO"),
                Usuario: ReadString(reader, "USUARIO"),
                NombrePersona: ReadString(reader, "NOMBRE_PERSONA"),
                FechaExpiracion: ReadNullableDate(reader, "FECHA_EXPIRACION"),
                Estado: ReadString(reader, "ESTADO"),
                DominioP: ReadString(reader, "DOMINIOP"),
                Dominio: ReadInt(reader, "DOMINIO"),
                Rol: ReadString(reader, "ROL"),
                ClaveSegura: ReadString(reader, "CLAVE_SEGURA"),
                Modulo: ReadNullableString(reader, "MODULO")), cancellationToken);

        return rows.GroupBy(row => row.IdUsuario).Select(group =>
        {
            var user = group.First();
            var assigned = group.Select(row => row.Modulo).OfType<string>().Where(module => !string.IsNullOrWhiteSpace(module)).ToArray();
            var isSuperAdmin = assigned.Contains(AppModules.SuperAdmin, StringComparer.OrdinalIgnoreCase);
            return new AdminUserDto(user.IdUsuario, user.Usuario, user.NombrePersona, user.FechaExpiracion,
                user.Estado, user.DominioP, user.Dominio, user.Rol, user.ClaveSegura,
                assigned.Where(module => !string.Equals(module, AppModules.SuperAdmin, StringComparison.OrdinalIgnoreCase))
                    .ToArray(), isSuperAdmin);
        }).ToArray();
    }

    public Task CreateUser(CreateAdminUserDto user, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var userId = await NextId(connection, transaction, "USUARIOS", "ID_USUARIO", cancellationToken);
            await Execute(connection, transaction, """
                INSERT INTO USUARIOS
                    (ID_USUARIO, USUARIO, NOMBRE_PERSONA, FECHA_EXPIRACION,
                     ESTADO, PASSWORD_HASH, ROL, DOMINIOP, DOMINIO, CLAVE_SEGURA)
                VALUES
                    (:idUsuario, :usuario, :nombrePersona, :fechaExpiracion,
                     :estado, :passwordHash,
                     :rol, :dominioP, :dominio, '0')
                """, cancellationToken,
                ("idUsuario", userId), ("usuario", user.Usuario.Trim()),
                ("nombrePersona", user.NombrePersona.Trim()), ("fechaExpiracion", user.FechaExpiracion),
                ("estado", user.Estado.Trim()), ("passwordHash", PasswordHashing.Hash(InitialPassword)),
                ("rol", user.Rol.Trim()),
                ("dominioP", user.DominioP.Trim().ToUpperInvariant()), ("dominio", user.Dominio));
            await ReplaceUserModules(connection, transaction, userId, user.Modules, user.Rol, user.IsSuperAdmin, cancellationToken);
        }, cancellationToken);

    public Task<bool> UpdateUser(
        int idUsuario,
        UpdateAdminUserDto user,
        CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var updated = await Execute(connection, transaction, """
                UPDATE USUARIOS
                SET USUARIO = :usuario,
                    NOMBRE_PERSONA = :nombrePersona,
                    FECHA_EXPIRACION = :fechaExpiracion,
                    ESTADO = :estado,
                    DOMINIOP = :dominioP,
                    DOMINIO = :dominio,
                    ROL = :rol
                WHERE ID_USUARIO = :idUsuario
                """, cancellationToken,
                ("usuario", user.Usuario.Trim()),
                ("nombrePersona", user.NombrePersona.Trim()),
                ("fechaExpiracion", user.FechaExpiracion),
                ("estado", user.Estado.Trim().ToUpperInvariant()),
                ("dominioP", user.DominioP.Trim().ToUpperInvariant()),
                ("dominio", user.Dominio),
                ("rol", user.Rol.Trim()),
                ("idUsuario", idUsuario));
            if (updated != 1) return false;

            await ReplaceUserModules(connection, transaction, idUsuario, user.Modules, user.Rol, user.IsSuperAdmin, cancellationToken);
            return true;
        }, cancellationToken);

    public async Task<bool> DeleteUser(int idUsuario, CancellationToken cancellationToken) =>
        await Execute("DELETE FROM USUARIOS WHERE ID_USUARIO = :idUsuario", cancellationToken,
            ("idUsuario", idUsuario)) > 0;

    public async Task<bool> ResetUserPassword(int idUsuario, CancellationToken cancellationToken) =>
        await Execute("""
            UPDATE USUARIOS
            SET PASSWORD_HASH = :passwordHash,
                CLAVE_SEGURA = '0'
            WHERE ID_USUARIO = :idUsuario
              AND DOMINIO = 0
            """, cancellationToken,
            ("passwordHash", PasswordHashing.Hash(InitialPassword)),
            ("idUsuario", idUsuario)) == 1;

    private static async Task ReplaceUserModules(
        DbConnection connection,
        DbTransaction transaction,
        int userId,
        IReadOnlyList<string> modules,
        string role,
        bool isSuperAdmin,
        CancellationToken cancellationToken)
    {
        await Execute(connection, transaction,
            "DELETE FROM USUARIO_MODULOS WHERE ID_USUARIO = :userId", cancellationToken,
            ("userId", userId));

        string[] assignedModules;
        if (AppRoles.IsRestrictedWorkshopRole(role))
        {
            // El técnico de taller, además del taller, atiende los tickets de soporte.
            assignedModules = role.Equals(AppRoles.TecnicoTaller, StringComparison.OrdinalIgnoreCase)
                ? [AppModules.Workshop, AppModules.Tickets]
                : [AppModules.Workshop];
        }
        else if (AppRoles.IsTicketRole(role))
        {
            assignedModules = [AppModules.Tickets];
        }
        else if (AppRoles.IsTicketRole(role))
        {
            assignedModules = [AppModules.Tickets];
        }
        else if (isSuperAdmin)
        {
            assignedModules = [AppModules.SuperAdmin];
        }
        else
        {
            assignedModules = modules
                .Concat(AppRoles.IsWorkshopRole(role) ? [AppModules.Workshop] : Array.Empty<string>())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }

        foreach (var module in assignedModules)
        {
            await Execute(connection, transaction, """
                INSERT INTO USUARIO_MODULOS (ID_USUARIO, MODULO) VALUES (:userId, :module)
                """, cancellationToken, ("userId", userId), ("module", module));
        }
    }
}
