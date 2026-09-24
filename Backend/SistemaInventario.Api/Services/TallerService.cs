using System.Data;
using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using SistemaInventario.Api.Data;
using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Capa de persistencia del taller. Coordina recepción, reparaciones, historial y
// transacciones que deben guardarse completas o revertirse juntas.
public sealed class TallerService(InventoryDbContext dbContext) : ITallerService
{
    public async Task<IReadOnlyList<WorkshopDeviceDto>> GetDevices(CancellationToken cancellationToken) =>
        await ReadList("""
            SELECT ID_EQUIPO, CODIGO_INVENTARIO, NO_SERIE, MARCA, MODELO
            FROM DISPOSITIVOS
            ORDER BY CODIGO_INVENTARIO
            """, reader => new WorkshopDeviceDto(
            reader.GetInt32(reader.GetOrdinal("ID_EQUIPO")),
            ReadString(reader, "CODIGO_INVENTARIO"),
            ReadString(reader, "NO_SERIE"),
            ReadString(reader, "MARCA"),
            ReadString(reader, "MODELO")), cancellationToken);

    public async Task<IReadOnlyList<MaintenanceDto>> GetMaintenances(CancellationToken cancellationToken) =>
        await ReadList("""
            SELECT r.ID_REPARACION, r.ID_EQUIPO, d.CODIGO_INVENTARIO, d.NO_SERIE,
                   d.MARCA, d.MODELO, r.ID_TECNICO, r.DICTAMEN,
                   r.TIPO_REPARACION, r.DETALLE_REPARACION,
                   r.FECHA_INGRESO, r.FECHA_SALIDA
            FROM REPARACION r
            INNER JOIN DISPOSITIVOS d ON d.ID_EQUIPO = r.ID_EQUIPO
            ORDER BY r.FECHA_INGRESO DESC
            """, ReadMaintenance, cancellationToken);

    public async Task RegisterReception(CreateReceptionEntryDto reception, CancellationToken cancellationToken)
    {
        // La recepción crea o reutiliza catálogos y registra el equipo dentro de una transacción.
        if (string.IsNullOrWhiteSpace(reception.CodigoInventario)
            || string.IsNullOrWhiteSpace(reception.TipoDispositivo)
            || string.IsNullOrWhiteSpace(reception.AreaOrigen))
        {
            throw new InvalidOperationException("El equipo, tipo y área de origen son obligatorios.");
        }

        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        await using var transaction = await dbContext.Database.GetDbConnection().BeginTransactionAsync(cancellationToken);
        try
        {
            var connection = dbContext.Database.GetDbConnection();
            var codigo = reception.CodigoInventario.Trim();
            var tipo = reception.TipoDispositivo.Trim();
            var area = reception.AreaOrigen.Trim();

            var areaId = await GetOrCreateArea(connection, transaction, area, cancellationToken);
            var tipoId = await GetOrCreateDeviceType(connection, transaction, tipo, cancellationToken);
            var idEquipo = await GetDeviceIdByCode(connection, transaction, codigo, cancellationToken);

            if (idEquipo is null)
            {
                await Execute(connection, transaction, """
                    INSERT INTO DISPOSITIVOS
                        (ID_EQUIPO, CODIGO_INVENTARIO, NO_SERIE, MARCA, MODELO, ID_TIPO,
                                ESTADO, NUMERO_PAGO_ASIGNADO, NOMBRE_ASIGNADO, ID_AREA)
                    SELECT NVL(MAX(ID_EQUIPO), 0) + 1, :codigo, 'PENDIENTE', 'PENDIENTE', 'PENDIENTE',
                                    :tipo, 'DISPONIBLE', NULL, NULL, :area
                    FROM DISPOSITIVOS
                    """, cancellationToken,
                    ("codigo", codigo), ("tipo", tipoId), ("area", areaId));
                idEquipo = await GetDeviceIdByCode(connection, transaction, codigo, cancellationToken);
            }
            else
            {
                await Execute(connection, transaction, """
                    UPDATE DISPOSITIVOS
                    SET ID_TIPO = :tipo,
                        ID_AREA = :area,
                        ESTADO = 'DISPONIBLE'
                    WHERE ID_EQUIPO = :idEquipo
                    """, cancellationToken,
                    ("tipo", tipoId), ("area", areaId), ("idEquipo", idEquipo.Value));
            }

            var fechaIngreso = reception.FechaIngreso == default ? DateTime.Now : reception.FechaIngreso;
            await Execute(connection, transaction, """
                INSERT INTO REPARACION
                    (ID_REPARACION, ID_EQUIPO, ID_TECNICO, FECHA_INGRESO,
                     DICTAMEN, TIPO_REPARACION, DETALLE_REPARACION)
                SELECT NVL(MAX(ID_REPARACION), 0) + 1, :idEquipo, 0,
                       :fechaIngreso, :dictamen, :tipoReparacion, 'PENDIENTE'
                FROM REPARACION
                """, cancellationToken,
                ("idEquipo", idEquipo!.Value), ("fechaIngreso", fechaIngreso),
                ("dictamen", "INGRESO POR RECEPCIÓN"), ("tipoReparacion", tipo));

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

    public Task CreateMaintenance(int idTecnico, CreateMaintenanceEntryDto maintenance, CancellationToken cancellationToken) =>
        // Abre una reparación y deja el detalle inicial como pendiente.
        Execute("""
            INSERT INTO REPARACION
                (ID_REPARACION, ID_EQUIPO, ID_TECNICO, FECHA_INGRESO,
                  DICTAMEN, TIPO_REPARACION, DETALLE_REPARACION)
            SELECT NVL(MAX(ID_REPARACION), 0) + 1, :idEquipo, :idTecnico,
                 :fechaIngreso, :dictamen, :tipoReparacion, 'PENDIENTE'
            FROM REPARACION
            """, cancellationToken,
                 ("idEquipo", maintenance.IdEquipo), ("idTecnico", idTecnico),
                 ("fechaIngreso", maintenance.FechaIngreso), ("dictamen", maintenance.Dictamen),
                 ("tipoReparacion", maintenance.TipoReparacion));

    public Task UpdateMaintenance(int idMantenimiento, CreateMaintenanceExitDto maintenance, CancellationToken cancellationToken) =>
        // Completa la salida y conserva la descripción del trabajo realizado.
        Execute("""
            UPDATE REPARACION
            SET DETALLE_REPARACION = :detalleReparacion,
                FECHA_SALIDA = :fechaSalida
            WHERE ID_REPARACION = :idReparacion
            """, cancellationToken,
            ("detalleReparacion", maintenance.DetalleReparacion),
            ("fechaSalida", maintenance.FechaSalida), ("idReparacion", idMantenimiento));

    public Task EditMaintenance(int idMantenimiento, UpdateMaintenanceDto maintenance, CancellationToken cancellationToken) =>
        Execute("""
            UPDATE REPARACION
            SET ID_EQUIPO = :idEquipo,
                DICTAMEN = :dictamen,
                TIPO_REPARACION = :tipoReparacion,
                FECHA_INGRESO = :fechaIngreso,
                DETALLE_REPARACION = :detalleReparacion,
                FECHA_SALIDA = :fechaSalida
            WHERE ID_REPARACION = :idReparacion
            """, cancellationToken,
            ("idEquipo", maintenance.IdEquipo), ("dictamen", maintenance.Dictamen),
            ("tipoReparacion", maintenance.TipoReparacion), ("fechaIngreso", maintenance.FechaIngreso),
            ("detalleReparacion", maintenance.DetalleReparacion ?? "PENDIENTE"),
            ("fechaSalida", maintenance.FechaSalida), ("idReparacion", idMantenimiento));

    public Task DeleteMaintenance(int idMantenimiento, CancellationToken cancellationToken) =>
        Execute("""
            DELETE FROM REPARACION
            WHERE ID_REPARACION = :idReparacion
            """, cancellationToken, ("idReparacion", idMantenimiento));

    private async Task<IReadOnlyList<T>> ReadList<T>(string sql, Func<DbDataReader, T> mapper, CancellationToken cancellationToken)
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
        finally { await dbContext.Database.CloseConnectionAsync(); }
    }

    private async Task Execute(string sql, CancellationToken cancellationToken, params (string Name, object? Value)[] parameters)
    {
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = CreateCommand(dbContext.Database.GetDbConnection(), null, sql, parameters);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
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

    private static DbCommand CreateCommand(DbConnection connection, DbTransaction? transaction, string sql, params (string Name, object? Value)[] parameters)
    {
        var command = connection.CreateCommand();
        command.CommandText = sql;
        command.Transaction = transaction;
        foreach (var (name, value) in parameters)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = name;
            parameter.Value = value ?? DBNull.Value;

            switch (value)
            {
                case int:
                    parameter.DbType = DbType.Int32;
                    break;
                case long:
                    parameter.DbType = DbType.Int64;
                    break;
                case DateTime:
                    parameter.DbType = DbType.DateTime;
                    break;
                case bool:
                    parameter.DbType = DbType.Boolean;
                    break;
                case decimal:
                    parameter.DbType = DbType.Decimal;
                    break;
                case double:
                    parameter.DbType = DbType.Double;
                    break;
                case string:
                    parameter.DbType = DbType.String;
                    parameter.Size = 256;
                    break;
                case null:
                    parameter.DbType = DbType.String;
                    parameter.Size = 256;
                    break;
                default:
                    parameter.DbType = DbType.String;
                    parameter.Size = 256;
                    break;
            }

            command.Parameters.Add(parameter);
        }
        return command;
    }

    private async Task<int> GetOrCreateArea(DbConnection connection, DbTransaction? transaction, string nombreArea, CancellationToken cancellationToken)
    {
        var existingId = await GetScalar<int?>(connection, transaction, """
            SELECT ID_AREA
            FROM AREAS
            WHERE UPPER(TRIM(NOMBRE_AREA)) = UPPER(TRIM(:nombreArea))
            """, cancellationToken, ("nombreArea", nombreArea));

        if (existingId is > 0) return existingId.Value;

        await Execute(connection, transaction, """
            INSERT INTO AREAS (ID_AREA, NOMBRE_AREA)
            SELECT NVL(MAX(ID_AREA), 0) + 1, :nombreArea
            FROM AREAS
            """, cancellationToken, ("nombreArea", nombreArea));

        return await GetScalar<int>(connection, transaction, """
            SELECT ID_AREA
            FROM AREAS
            WHERE UPPER(TRIM(NOMBRE_AREA)) = UPPER(TRIM(:nombreArea))
            """, cancellationToken, ("nombreArea", nombreArea));
    }

    private async Task<int> GetOrCreateDeviceType(DbConnection connection, DbTransaction? transaction, string tipoDispositivo, CancellationToken cancellationToken)
    {
        var existingId = await GetScalar<int?>(connection, transaction, """
            SELECT ID_TIPO
            FROM TIPOS_DISPOSITIVOS
            WHERE UPPER(TRIM(TIPO_DISPOSITIVO)) = UPPER(TRIM(:tipoDispositivo))
            """, cancellationToken, ("tipoDispositivo", tipoDispositivo));

        if (existingId is > 0) return existingId.Value;

        await Execute(connection, transaction, """
            INSERT INTO TIPOS_DISPOSITIVOS (ID_TIPO, TIPO_DISPOSITIVO)
            SELECT NVL(MAX(ID_TIPO), 0) + 1, :tipoDispositivo
            FROM TIPOS_DISPOSITIVOS
            """, cancellationToken, ("tipoDispositivo", tipoDispositivo));

        return await GetScalar<int>(connection, transaction, """
            SELECT ID_TIPO
            FROM TIPOS_DISPOSITIVOS
            WHERE UPPER(TRIM(TIPO_DISPOSITIVO)) = UPPER(TRIM(:tipoDispositivo))
            """, cancellationToken, ("tipoDispositivo", tipoDispositivo));
    }

    private async Task<int?> GetDeviceIdByCode(DbConnection connection, DbTransaction? transaction, string codigoInventario, CancellationToken cancellationToken)
    {
        return await GetScalar<int?>(connection, transaction, """
            SELECT ID_EQUIPO
            FROM DISPOSITIVOS
            WHERE UPPER(TRIM(CODIGO_INVENTARIO)) = UPPER(TRIM(:codigoInventario))
            """, cancellationToken, ("codigoInventario", codigoInventario));
    }

    private static async Task<T> GetScalar<T>(DbConnection connection, DbTransaction? transaction, string sql, CancellationToken cancellationToken, params (string Name, object? Value)[] parameters)
    {
        await using var command = CreateCommand(connection, transaction, sql, parameters);
        var result = await command.ExecuteScalarAsync(cancellationToken);
        return result is DBNull or null ? default! : (T)result;
    }

    private static MaintenanceDto ReadMaintenance(DbDataReader reader) => new(
        reader.GetInt32(reader.GetOrdinal("ID_REPARACION")),
        reader.GetInt32(reader.GetOrdinal("ID_EQUIPO")),
        ReadString(reader, "CODIGO_INVENTARIO"),
        ReadString(reader, "NO_SERIE"),
        ReadString(reader, "MARCA"),
        ReadString(reader, "MODELO"),
        reader.GetInt32(reader.GetOrdinal("ID_TECNICO")),
        ReadNullableString(reader, "DICTAMEN"),
        ReadNullableString(reader, "TIPO_REPARACION"),
        ReadNullableString(reader, "DETALLE_REPARACION"),
        reader.GetDateTime(reader.GetOrdinal("FECHA_INGRESO")),
        reader.IsDBNull(reader.GetOrdinal("FECHA_SALIDA")) ? null : reader.GetDateTime(reader.GetOrdinal("FECHA_SALIDA")));

    private static string ReadString(DbDataReader reader, string column) =>
        reader.IsDBNull(reader.GetOrdinal(column)) ? string.Empty : reader.GetString(reader.GetOrdinal(column));

    private static string? ReadNullableString(DbDataReader reader, string column) =>
        reader.IsDBNull(reader.GetOrdinal(column)) ? null : reader.GetString(reader.GetOrdinal(column));
}