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
                                         d.NUMERO_PAGO_ASIGNADO, d.NOMBRE_ASIGNADO, d.ID_AREA,
                                      a.DEPARTAMENTO_IHSS_DESC AS NOMBRE_AREA, a.EDIFICIO_ID AS ID_EDIFICIO,
                                     b.EDIFICIO_DESCRIPCION AS NOMBRE_EDIFICIO,
                                     COALESCE(NULLIF(TRIM(d.NOMBRE_ASIGNADO), ''), e.NOMBRE_EMPLEADO) AS ASIGNADO_A
            FROM DISPOSITIVOS d
                 LEFT JOIN TIPOS_DISPOSITIVOS t ON t.ID_TIPO = d.ID_TIPO
                  LEFT JOIN DEPARTAMENTO_IHSS a ON a.DEPARTAMENTO_IHSS_ID = d.ID_AREA
                  LEFT JOIN EDIFICIO b ON b.EDIFICIO_ID = a.EDIFICIO_ID
                  LEFT JOIN EMPLEADOS_IHSS e ON e.NPAGO = d.NUMERO_PAGO_ASIGNADO
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
        const string sql = "SELECT NPAGO AS NO_PAGO, NOMBRE_EMPLEADO AS NOMBRE_COMPLETO, DEPARTAMENTO_IHSS_ID AS ID_AREA FROM EMPLEADOS_IHSS ORDER BY NOMBRE_EMPLEADO";
        return await ReadList(sql, reader => new EmployeeDto(
            ReadString(reader, "NO_PAGO"),
            ReadString(reader, "NOMBRE_COMPLETO"),
            ReadNullableInt(reader, "ID_AREA")), cancellationToken);
    }

    public async Task<IReadOnlyList<BuildingDto>> GetBuildings(CancellationToken cancellationToken)
    {
        const string sql = "SELECT EDIFICIO_ID, EDIFICIO_DESCRIPCION FROM EDIFICIO ORDER BY EDIFICIO_DESCRIPCION";
        return await ReadList(sql, reader => new BuildingDto(
            reader.GetInt32(reader.GetOrdinal("EDIFICIO_ID")),
            ReadString(reader, "EDIFICIO_DESCRIPCION")), cancellationToken);
    }

    public async Task<IReadOnlyList<AreaDto>> GetAreas(int idEdificio, CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT DEPARTAMENTO_IHSS_ID AS ID_AREA, DEPARTAMENTO_IHSS_DESC AS NOMBRE_AREA
            FROM DEPARTAMENTO_IHSS
            WHERE EDIFICIO_ID = :idEdificio
            ORDER BY DEPARTAMENTO_IHSS_DESC
            """;
        return await ReadList(sql, reader => new AreaDto(
            reader.GetInt32(reader.GetOrdinal("ID_AREA")),
            ReadString(reader, "NOMBRE_AREA")), cancellationToken, ("idEdificio", idEdificio));
    }

    public async Task CreateDevice(CreateDeviceDto device, CancellationToken cancellationToken)
    {
        var isAvailable = string.Equals(device.Estado, "DISPONIBLE", StringComparison.OrdinalIgnoreCase);
        var numeroPago = isAvailable || string.IsNullOrWhiteSpace(device.NumeroPagoAsignado) ? null : device.NumeroPagoAsignado;
        var nombreAsignado = isAvailable || string.IsNullOrWhiteSpace(device.NombreAsignado) ? null : device.NombreAsignado;
        var estado = isAvailable ? "DISPONIBLE" : device.Estado;
        await Execute("""
                        INSERT INTO DISPOSITIVOS
                                (ID_EQUIPO, CODIGO_INVENTARIO, NO_SERIE, MARCA, MODELO, ID_TIPO,
                                 ESTADO, NUMERO_PAGO_ASIGNADO, NOMBRE_ASIGNADO, ID_AREA)
            SELECT NVL(MAX(ID_EQUIPO), 0) + 1, :codigo, :serie, :marca, :modelo,
                         :tipo, :estado, :pago, :nombre, :area
            FROM DISPOSITIVOS
            """, cancellationToken,
            ("codigo", device.CodigoInventario), ("serie", device.NoSerie),
            ("marca", device.Marca), ("modelo", device.Modelo), ("tipo", device.IdTipo),
                ("estado", estado), ("pago", numeroPago), ("nombre", nombreAsignado),
                ("area", isAvailable ? null : device.IdArea));
    }

    public Task UpdateDevice(int idEquipo, CreateDeviceDto device, CancellationToken cancellationToken)
    {
        var isAvailable = string.Equals(device.Estado, "DISPONIBLE", StringComparison.OrdinalIgnoreCase);
        var numeroPago = isAvailable || string.IsNullOrWhiteSpace(device.NumeroPagoAsignado) ? null : device.NumeroPagoAsignado;
        var nombreAsignado = isAvailable || string.IsNullOrWhiteSpace(device.NombreAsignado) ? null : device.NombreAsignado;
        var estado = isAvailable ? "DISPONIBLE" : device.Estado;
        return Execute("""
            UPDATE DISPOSITIVOS
            SET CODIGO_INVENTARIO = :codigo,
                NO_SERIE = :serie,
                MARCA = :marca,
                MODELO = :modelo,
                ID_TIPO = :tipo,
                ESTADO = :estado,
                NUMERO_PAGO_ASIGNADO = :pago,
                NOMBRE_ASIGNADO = :nombre,
                ID_AREA = :area
            WHERE ID_EQUIPO = :idEquipo
            """, cancellationToken,
            ("codigo", device.CodigoInventario), ("serie", device.NoSerie),
            ("marca", device.Marca), ("modelo", device.Modelo), ("tipo", device.IdTipo),
                ("estado", estado), ("pago", numeroPago), ("nombre", nombreAsignado),
                ("area", isAvailable ? null : device.IdArea),
                ("idEquipo", idEquipo));
            }

    public Task UpdateDeviceByIdentifier(string? codigoInventario, string? noSerie, CreateDeviceDto device, CancellationToken cancellationToken)
    {
        var identifier = !string.IsNullOrWhiteSpace(codigoInventario) ? codigoInventario.Trim() : noSerie?.Trim();
        var identifierColumn = !string.IsNullOrWhiteSpace(codigoInventario) ? "CODIGO_INVENTARIO" : "NO_SERIE";
        if (string.IsNullOrWhiteSpace(identifier))
        {
            throw new ArgumentException("Debe indicar el código de inventario o el número de serie.");
        }

        var isAvailable = string.Equals(device.Estado, "DISPONIBLE", StringComparison.OrdinalIgnoreCase);
        var numeroPago = isAvailable || string.IsNullOrWhiteSpace(device.NumeroPagoAsignado) ? null : device.NumeroPagoAsignado;
        var nombreAsignado = isAvailable || string.IsNullOrWhiteSpace(device.NombreAsignado) ? null : device.NombreAsignado;
        var estado = isAvailable ? "DISPONIBLE" : device.Estado;
        return Execute($"""
            UPDATE DISPOSITIVOS
            SET CODIGO_INVENTARIO = :codigo,
                NO_SERIE = :serie,
                MARCA = :marca,
                MODELO = :modelo,
                ID_TIPO = :tipo,
                ESTADO = :estado,
                NUMERO_PAGO_ASIGNADO = :pago,
                NOMBRE_ASIGNADO = :nombre,
                ID_AREA = :area
            WHERE {identifierColumn} = :identifier
            """, cancellationToken,
            ("codigo", device.CodigoInventario), ("serie", device.NoSerie),
            ("marca", device.Marca), ("modelo", device.Modelo), ("tipo", device.IdTipo),
            ("estado", estado), ("pago", numeroPago), ("nombre", nombreAsignado),
            ("area", isAvailable ? null : device.IdArea),
            ("identifier", identifier));
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
                "DELETE FROM REPARACION WHERE ID_EQUIPO = :idEquipo",
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
        // Consulta el historial ordenado para que la interfaz muestre primero los cambios recientes.
        const string sql = """
            SELECT ID_REASIGNACION, ID_EQUIPO, NO_PAGO_ANTERIOR, NO_PAGO_NUEVO,
                   FECHA_CAMBIO, MOTIVO
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
            var areaBelongsToBuilding = await Exists(connection, transaction, """
                SELECT 1
                FROM DEPARTAMENTO_IHSS
                WHERE DEPARTAMENTO_IHSS_ID = :idArea
                  AND EDIFICIO_ID = :idEdificio
                """, cancellationToken,
                ("idArea", reassignment.IdArea), ("idEdificio", reassignment.IdEdificio));
            if (!areaBelongsToBuilding)
            {
                throw new InvalidOperationException("El departamento seleccionado no pertenece al edificio indicado.");
            }

            var nuevoPago = string.IsNullOrWhiteSpace(reassignment.NoPagoNuevo)
                ? null
                : reassignment.NoPagoNuevo.Trim();
            var nuevoNombre = string.IsNullOrWhiteSpace(reassignment.NombreNuevo)
                ? null
                : reassignment.NombreNuevo.Trim();
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
                    NOMBRE_ASIGNADO = :nuevoNombre,
                    ID_AREA = :idArea
                WHERE ID_EQUIPO = :idEquipo
                """, cancellationToken,
                ("nuevoPago", nuevoPago), ("nuevoNombre", nuevoNombre),
                ("idArea", reassignment.IdArea), ("idEquipo", reassignment.IdEquipo));
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

    public Task DeleteReassignment(int idReasignacion, CancellationToken cancellationToken) =>
        Execute("DELETE FROM REASIGNACIONES WHERE ID_REASIGNACION = :idReasignacion", cancellationToken,
            ("idReasignacion", idReasignacion));

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
        CancellationToken cancellationToken,
        params (string Name, object? Value)[] parameters)
    {
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = CreateCommand(dbContext.Database.GetDbConnection(), null, sql, parameters);
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

    private static async Task<bool> Exists(
        DbConnection connection,
        DbTransaction transaction,
        string sql,
        CancellationToken cancellationToken,
        params (string Name, object? Value)[] parameters)
    {
        await using var command = CreateCommand(connection, transaction, sql, parameters);
        return await command.ExecuteScalarAsync(cancellationToken) is not null;
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

    private static async Task<string?> FindEmployeePayment(
        DbConnection connection,
        DbTransaction transaction,
        string employeeName,
        CancellationToken cancellationToken)
    {
        await using var command = CreateCommand(connection, transaction, """
            SELECT NO_PAGO
            FROM EMPLEADOS_IHSS
            WHERE UPPER(TRIM(NOMBRE_EMPLEADO)) = UPPER(TRIM(:nombreCompleto))
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
            ReadNullableString(reader, "ASIGNADO_A"),
            ReadNullableString(reader, "NOMBRE_ASIGNADO"),
            ReadNullableInt(reader, "ID_EDIFICIO"),
            ReadNullableString(reader, "NOMBRE_EDIFICIO"));

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