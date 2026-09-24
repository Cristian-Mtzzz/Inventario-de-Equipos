using System.Data;
using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using SistemaInventario.Api.Data;
using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Capa de persistencia administrativa. Ejecuta SQL Oracle y usa transacciones
// cuando una operación modifica varias tablas relacionadas.
public sealed class AdminService(InventoryDbContext dbContext) : IAdminService
{
    public async Task<IReadOnlyList<DeviceDto>> GetDevices(CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT d.ID_EQUIPO, d.CODIGO_INVENTARIO, d.NO_SERIE, d.MARCA, d.MODELO,
                                         d.ID_TIPO, t.TIPO_DISPOSITIVO AS NOMBRE_TIPO, d.ESTADO,
                                         d.NUMERO_PAGO_ASIGNADO, d.ID_AREA,
                                     a.NOMBRE_AREA,
                                     COALESCE(NULLIF(TRIM(d.NOMBRE_ASIGNADO), ''), e.NOMBRE_COMPLETO) AS ASIGNADO_A
            FROM DISPOSITIVOS d
                 LEFT JOIN TIPOS_DISPOSITIVOS t ON t.ID_TIPO = d.ID_TIPO
            LEFT JOIN AREAS a ON a.ID_AREA = d.ID_AREA
            LEFT JOIN EMPLEADOS e ON e.NO_PAGO = d.NUMERO_PAGO_ASIGNADO
            ORDER BY d.ID_EQUIPO
            """;
        return await ReadList(sql, ReadDevice, cancellationToken);
    }

    public async Task<IReadOnlyList<DeviceTypeDto>> GetDeviceTypes(CancellationToken cancellationToken)
    {
        const string sql = "SELECT ID_TIPO, TIPO_DISPOSITIVO FROM TIPOS_DISPOSITIVOS ORDER BY TIPO_DISPOSITIVO";
        return await ReadList(sql, reader => new DeviceTypeDto(
            reader.GetInt32(reader.GetOrdinal("ID_TIPO")),
            ReadString(reader, "TIPO_DISPOSITIVO")), cancellationToken);
    }

    public async Task<IReadOnlyList<EmployeeDto>> GetEmployees(CancellationToken cancellationToken)
    {
        const string sql = "SELECT NO_PAGO, NOMBRE_COMPLETO, ID_AREA FROM EMPLEADOS ORDER BY NOMBRE_COMPLETO";
        return await ReadList(sql, reader => new EmployeeDto(
            ReadString(reader, "NO_PAGO"),
            ReadString(reader, "NOMBRE_COMPLETO"),
            ReadNullableInt(reader, "ID_AREA")), cancellationToken);
    }

    public async Task<IReadOnlyList<AreaDto>> GetAreas(CancellationToken cancellationToken)
    {
        const string sql = "SELECT ID_AREA, NOMBRE_AREA FROM AREAS ORDER BY NOMBRE_AREA";
        return await ReadList(sql, reader => new AreaDto(
            reader.GetInt32(reader.GetOrdinal("ID_AREA")),
            ReadString(reader, "NOMBRE_AREA")), cancellationToken);
    }

    public async Task CreateDevice(CreateDeviceDto device, CancellationToken cancellationToken)
    {
        var numeroPago = string.IsNullOrWhiteSpace(device.NumeroPagoAsignado) ? null : device.NumeroPagoAsignado;
        var estado = numeroPago is null ? "DISPONIBLE" : device.Estado;
        await Execute("""
                        INSERT INTO DISPOSITIVOS
                                (ID_EQUIPO, CODIGO_INVENTARIO, NO_SERIE, MARCA, MODELO, ID_TIPO,
                                 ESTADO, NUMERO_PAGO_ASIGNADO, NOMBRE_ASIGNADO, ID_AREA)
            SELECT NVL(MAX(ID_EQUIPO), 0) + 1, :codigo, :serie, :marca, :modelo,
                                     :tipo, :estado, :pago, NULL, :area
            FROM DISPOSITIVOS
            """, cancellationToken,
            ("codigo", device.CodigoInventario), ("serie", device.NoSerie),
            ("marca", device.Marca), ("modelo", device.Modelo), ("tipo", device.IdTipo),
            ("estado", estado), ("pago", numeroPago), ("area", numeroPago is null ? null : device.IdArea));
    }

    public Task UpdateDevice(int idEquipo, CreateDeviceDto device, CancellationToken cancellationToken)
    {
        var numeroPago = string.IsNullOrWhiteSpace(device.NumeroPagoAsignado) ? null : device.NumeroPagoAsignado;
        var estado = numeroPago is null ? "DISPONIBLE" : device.Estado;
        return Execute("""
            UPDATE DISPOSITIVOS
            SET CODIGO_INVENTARIO = :codigo,
                NO_SERIE = :serie,
                MARCA = :marca,
                MODELO = :modelo,
                ID_TIPO = :tipo,
                ESTADO = :estado,
                NUMERO_PAGO_ASIGNADO = :pago,
                ID_AREA = :area
            WHERE ID_EQUIPO = :idEquipo
            """, cancellationToken,
            ("codigo", device.CodigoInventario), ("serie", device.NoSerie),
            ("marca", device.Marca), ("modelo", device.Modelo), ("tipo", device.IdTipo),
                ("estado", estado), ("pago", numeroPago),
                ("area", numeroPago is null ? null : device.IdArea), ("idEquipo", idEquipo));
            }

    public async Task DeleteDevice(int idEquipo, CancellationToken cancellationToken)
    {
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        await using var transaction = await dbContext.Database.GetDbConnection().BeginTransactionAsync(cancellationToken);
        try
        {
            var connection = dbContext.Database.GetDbConnection();
            await Execute(connection, transaction,
                "DELETE FROM REASIGNACIONES WHERE ID_EQUIPO = :idEquipo",
                cancellationToken, ("idEquipo", idEquipo));
            await Execute(connection, transaction,
                "DELETE FROM DISPOSITIVOS WHERE ID_EQUIPO = :idEquipo",
                cancellationToken, ("idEquipo", idEquipo));
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
    }

    public async Task<IReadOnlyList<ReassignmentDto>> GetReassignments(CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT ID_REASIGNACION, ID_EQUIPO, NO_PAGO_ANTERIOR, NO_PAGO_NUEVO,
                   FECHA_CAMBIO, MOTIVO
                // Actualiza la copia local para que la tabla de dispositivos refleje la reasignación.
            FROM REASIGNACIONES
            ORDER BY FECHA_CAMBIO DESC
            """;
        return await ReadList(sql, ReadReassignment, cancellationToken);
    }

    public async Task CreateReassignment(CreateReassignmentDto reassignment, CancellationToken cancellationToken)
    {
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        await using var transaction = await dbContext.Database.GetDbConnection().BeginTransactionAsync(cancellationToken);
        try
        {
            var connection = dbContext.Database.GetDbConnection();
            var nuevoPago = string.IsNullOrWhiteSpace(reassignment.NoPagoNuevo)
                ? null
                : reassignment.NoPagoNuevo.Trim();
            var nuevoNombre = string.IsNullOrWhiteSpace(reassignment.NombreNuevo)
                ? null
                : reassignment.NombreNuevo.Trim();
            if (nuevoNombre is not null && nuevoPago is not null)
            {
                await EnsureEmployee(connection, transaction, nuevoPago, nuevoNombre, cancellationToken);
            }
            if (nuevoPago is null && !string.IsNullOrWhiteSpace(reassignment.NombreNuevo))
            {
                nuevoPago = await FindEmployeePayment(connection, transaction, reassignment.NombreNuevo.Trim(), cancellationToken);
            }

            await Execute(connection, transaction, """
                INSERT INTO REASIGNACIONES
                    (ID_EQUIPO, NO_PAGO_ANTERIOR, NO_PAGO_NUEVO, FECHA_CAMBIO, MOTIVO)
                SELECT ID_EQUIPO, NUMERO_PAGO_ASIGNADO, :nuevoPago, SYSDATE, :motivo
                FROM DISPOSITIVOS
                WHERE ID_EQUIPO = :idEquipo
                """, cancellationToken,
                ("nuevoPago", nuevoPago), ("motivo", reassignment.Motivo),
                ("idEquipo", reassignment.IdEquipo));
            await Execute(connection, transaction, """
                UPDATE DISPOSITIVOS
                SET NUMERO_PAGO_ASIGNADO = :nuevoPago,
                    NOMBRE_ASIGNADO = :nuevoNombre
                WHERE ID_EQUIPO = :idEquipo
                """, cancellationToken,
                ("nuevoPago", nuevoPago), ("nuevoNombre", nuevoNombre), ("idEquipo", reassignment.IdEquipo));
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
    }

    public async Task<IReadOnlyList<AdminUserDto>> GetUsers(CancellationToken cancellationToken)
    {
        const string sql = "SELECT ID_USUARIO, USUARIO, ROL FROM USUARIOS ORDER BY ID_USUARIO";
        return await ReadList(sql, reader => new AdminUserDto(
            reader.GetInt32(reader.GetOrdinal("ID_USUARIO")),
            reader.GetString(reader.GetOrdinal("USUARIO")),
            reader.GetString(reader.GetOrdinal("ROL"))), cancellationToken);
    }

    public Task CreateUser(CreateAdminUserDto user, CancellationToken cancellationToken) =>
        Execute("""
            INSERT INTO USUARIOS (ID_USUARIO, USUARIO, PASSWORD_HASH, ROL)
            SELECT NVL(MAX(ID_USUARIO), 0) + 1,
                   :usuario,
                   ORA_HASH(:password, 4294967295) || ORA_HASH(:usuarioHash, 4294967295),
                   :rol
            FROM USUARIOS
            """, cancellationToken,
            ("usuario", user.Usuario), ("password", user.Password),
            ("usuarioHash", user.Usuario), ("rol", user.Rol));

    public Task DeleteUser(int idUsuario, CancellationToken cancellationToken) =>
        Execute("DELETE FROM USUARIOS WHERE ID_USUARIO = :idUsuario", cancellationToken,
            ("idUsuario", idUsuario));

    private async Task<IReadOnlyList<T>> ReadList<T>(
        string sql,
        Func<DbDataReader, T> mapper,
        CancellationToken cancellationToken)
    {
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = CreateCommand(dbContext.Database.GetDbConnection(), null, sql);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var result = new List<T>();
            while (await reader.ReadAsync(cancellationToken)) result.Add(mapper(reader));
            return result;
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
    }

    private async Task Execute(string sql, CancellationToken cancellationToken, params (string Name, object? Value)[] parameters)
    {
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try { await Execute(dbContext.Database.GetDbConnection(), null, sql, cancellationToken, parameters); }
        finally { await dbContext.Database.CloseConnectionAsync(); }
    }

    private static async Task Execute(
        DbConnection connection,
        DbTransaction? transaction,
        string sql,
        CancellationToken cancellationToken,
        params (string Name, object? Value)[] parameters)
    {
        await using var command = CreateCommand(connection, transaction, sql, parameters);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static async Task EnsureEmployee(
        DbConnection connection,
        DbTransaction transaction,
        string? paymentNumber,
        string employeeName,
        CancellationToken cancellationToken)
    {
        await Execute(connection, transaction, """
            INSERT INTO EMPLEADOS (NO_PAGO, NOMBRE_COMPLETO)
            SELECT :noPago, :nombreCompleto
            FROM DUAL
            WHERE NOT EXISTS (
                SELECT 1
                FROM EMPLEADOS
                WHERE UPPER(TRIM(NOMBRE_COMPLETO)) = UPPER(TRIM(:nombreCompletoCheck))
            )
            """, cancellationToken,
            ("noPago", paymentNumber), ("nombreCompleto", employeeName),
            ("nombreCompletoCheck", employeeName));
    }

    private static async Task<string?> FindEmployeePayment(
        DbConnection connection,
        DbTransaction transaction,
        string employeeName,
        CancellationToken cancellationToken)
    {
        await using var command = CreateCommand(connection, transaction, """
            SELECT NO_PAGO
            FROM EMPLEADOS
            WHERE UPPER(TRIM(NOMBRE_COMPLETO)) = UPPER(TRIM(:nombreCompleto))
              AND ROWNUM = 1
            """, ("nombreCompleto", employeeName));
        var result = await command.ExecuteScalarAsync(cancellationToken);
        return result is DBNull or null ? null : Convert.ToString(result);
    }

    private static DbCommand CreateCommand(
        DbConnection connection,
        DbTransaction? transaction,
        string sql,
        params (string Name, object? Value)[] parameters)
    {
        var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Transaction = transaction;
        foreach (var (name, value) in parameters)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = name;
            parameter.DbType = value is int ? DbType.Int32 : DbType.String;
            parameter.Value = value ?? DBNull.Value;
            parameter.Size = 256;
            command.Parameters.Add(parameter);
        }
        return command;
    }

    private static DeviceDto ReadDevice(DbDataReader reader) => new(
        reader.GetInt32(reader.GetOrdinal("ID_EQUIPO")),
        ReadString(reader, "CODIGO_INVENTARIO"),
        ReadString(reader, "NO_SERIE"),
        ReadString(reader, "MARCA"),
        ReadString(reader, "MODELO"),
        ReadNullableInt(reader, "ID_TIPO"),
        ReadNullableString(reader, "NOMBRE_TIPO"),
        ReadString(reader, "ESTADO"),
        ReadNullableString(reader, "NUMERO_PAGO_ASIGNADO"),
        ReadNullableInt(reader, "ID_AREA"),
        ReadNullableString(reader, "NOMBRE_AREA"),
        ReadNullableString(reader, "ASIGNADO_A"));

    private static ReassignmentDto ReadReassignment(DbDataReader reader) => new(
        reader.GetInt32(reader.GetOrdinal("ID_REASIGNACION")),
        reader.GetInt32(reader.GetOrdinal("ID_EQUIPO")),
        ReadNullableString(reader, "NO_PAGO_ANTERIOR"),
        ReadNullableString(reader, "NO_PAGO_NUEVO"),
        reader.GetDateTime(reader.GetOrdinal("FECHA_CAMBIO")),
        ReadString(reader, "MOTIVO"));

    private static string ReadString(DbDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? string.Empty : reader.GetString(ordinal);
    }

    private static int? ReadNullableInt(DbDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : Convert.ToInt32(reader.GetValue(ordinal));
    }

    private static string? ReadNullableString(DbDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : Convert.ToString(reader.GetValue(ordinal));
    }
}