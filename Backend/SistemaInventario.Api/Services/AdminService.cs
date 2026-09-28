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
    public async Task<PagedResult<DeviceDto>> GetDevices(
        int requestedPage,
        string? searchTerm,
        string? brand,
        string? model,
        int? typeId,
        int? regionalId,
        int? buildingId,
        int? areaId,
        CancellationToken cancellationToken)
    {
        const int pageSize = 25;
        const string fromSql = """
            FROM DISPOSITIVOS d
            LEFT JOIN TIPOS_DISPOSITIVOS t ON t.ID_TIPO = d.ID_TIPO
            LEFT JOIN DEPARTAMENTO_IHSS a ON a.DEPARTAMENTO_IHSS_ID = d.ID_AREA
            LEFT JOIN EDIFICIO b ON b.EDIFICIO_ID = a.EDIFICIO_ID
            LEFT JOIN REGIONAL r ON r.REGIONA_ID = COALESCE(a.REGIONA_ID, b.REGIONA_ID)
            LEFT JOIN EMPLEADOS_IHSS e ON e.NPAGO = d.NUMERO_PAGO_ASIGNADO
            """;
        var conditions = new List<string>();
        var parameters = new List<(string Name, object? Value)>();

            void AddDeviceFilter(string condition, string parameterName, object? value)
            {
                if (value is null || value is string text && string.IsNullOrWhiteSpace(text)) return;
                conditions.Add(condition);
                parameters.Add((parameterName, value));
            }

        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            var pattern = $"%{searchTerm.Trim().ToUpperInvariant()}%";
            conditions.Add("(UPPER(d.CODIGO_INVENTARIO) LIKE :searchCode OR UPPER(d.NO_SERIE) LIKE :searchSerial OR UPPER(d.MARCA) LIKE :searchBrand OR UPPER(d.MODELO) LIKE :searchModel OR UPPER(d.NUMERO_PAGO_ASIGNADO) LIKE :searchPayment OR UPPER(COALESCE(NULLIF(TRIM(d.NOMBRE_ASIGNADO), ''), e.NOMBRE_EMPLEADO)) LIKE :searchEmployee)");
            parameters.Add(("searchCode", pattern));
            parameters.Add(("searchSerial", pattern));
            parameters.Add(("searchBrand", pattern));
            parameters.Add(("searchModel", pattern));
            parameters.Add(("searchPayment", pattern));
            parameters.Add(("searchEmployee", pattern));
        }

        AddDeviceFilter("UPPER(TRIM(d.MARCA)) = :brand", "brand", brand?.Trim().ToUpperInvariant());
        AddDeviceFilter("UPPER(TRIM(d.MODELO)) = :model", "model", model?.Trim().ToUpperInvariant());
        AddDeviceFilter("d.ID_TIPO = :typeId", "typeId", typeId);
        AddDeviceFilter("COALESCE(a.REGIONA_ID, b.REGIONA_ID) = :regionalId", "regionalId", regionalId);
        AddDeviceFilter("b.EDIFICIO_ID = :buildingId", "buildingId", buildingId);
        AddDeviceFilter("d.ID_AREA = :areaId", "areaId", areaId);

        var whereSql = conditions.Count == 0 ? string.Empty : $"WHERE {string.Join(" AND ", conditions)}";
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            var connection = dbContext.Database.GetDbConnection();
            await using var countCommand = CreateCommand(connection, null,
                $"SELECT COUNT(DISTINCT d.ID_EQUIPO) {fromSql} {whereSql}", parameters.ToArray());
            var totalCount = Convert.ToInt32(await countCommand.ExecuteScalarAsync(cancellationToken));
            var totalPages = Math.Max(1, (int)Math.Ceiling(totalCount / (double)pageSize));
            var page = Math.Clamp(requestedPage, 1, totalPages);
            var startRow = (page - 1) * pageSize;

            var sql = $"""
                SELECT * FROM (
                    SELECT d.ID_EQUIPO, d.CODIGO_INVENTARIO, d.NO_SERIE, d.MARCA, d.MODELO,
                           d.ID_TIPO, t.TIPO_DISPOSITIVO AS NOMBRE_TIPO, d.ESTADO,
                           d.NUMERO_PAGO_ASIGNADO, d.NOMBRE_ASIGNADO, d.ID_AREA,
                           a.DEPARTAMENTO_IHSS_DESC AS NOMBRE_AREA, a.EDIFICIO_ID AS ID_EDIFICIO,
                           b.EDIFICIO_DESCRIPCION AS NOMBRE_EDIFICIO,
                           COALESCE(NULLIF(TRIM(d.NOMBRE_ASIGNADO), ''), e.NOMBRE_EMPLEADO) AS ASIGNADO_A,
                           COALESCE(a.REGIONA_ID, b.REGIONA_ID) AS ID_REGIONAL,
                           r.DESCRIPCION AS NOMBRE_REGIONAL,
                           ROW_NUMBER() OVER (ORDER BY d.ID_EQUIPO) AS ROW_NUM
                    {fromSql}
                    {whereSql}
                )
                WHERE ROW_NUM > :startRow AND ROW_NUM <= :endRow
                ORDER BY ROW_NUM
                """;
            var pageParameters = parameters
                .Append(("startRow", (object?)startRow))
                .Append(("endRow", (object?)(startRow + pageSize)))
                .ToArray();
            await using var command = CreateCommand(connection, null, sql, pageParameters);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var items = new List<DeviceDto>(pageSize);
            while (await reader.ReadAsync(cancellationToken)) items.Add(ReadDevice(reader));
            return new PagedResult<DeviceDto>(items, totalCount, page, pageSize);
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
    }

    public async Task<IReadOnlyList<DeviceOptionDto>> SearchDeviceOptions(
        string searchTerm,
        CancellationToken cancellationToken)
    {
        var pattern = $"%{searchTerm.Trim().ToUpperInvariant()}%";
        return await ReadList("""
            SELECT ID_EQUIPO, CODIGO_INVENTARIO, MARCA, MODELO
            FROM (
                SELECT ID_EQUIPO, CODIGO_INVENTARIO, MARCA, MODELO,
                       ROW_NUMBER() OVER (ORDER BY CODIGO_INVENTARIO) AS ROW_NUM
                FROM DISPOSITIVOS
                WHERE UPPER(CODIGO_INVENTARIO) LIKE :searchCode
                   OR UPPER(NO_SERIE) LIKE :searchSerial
                   OR UPPER(MARCA) LIKE :searchBrand
                   OR UPPER(MODELO) LIKE :searchModel
            )
            WHERE ROW_NUM <= 25
            ORDER BY ROW_NUM
            """, reader => new DeviceOptionDto(
                reader.GetInt32(reader.GetOrdinal("ID_EQUIPO")),
                ReadString(reader, "CODIGO_INVENTARIO"),
                ReadString(reader, "MARCA"),
                ReadString(reader, "MODELO")),
            cancellationToken,
            ("searchCode", pattern), ("searchSerial", pattern),
            ("searchBrand", pattern), ("searchModel", pattern));
    }

    public async Task<IReadOnlyList<EmployeeSearchDto>> SearchEmployees(
        string searchTerm,
        CancellationToken cancellationToken)
    {
        if (searchTerm.Trim().Length < 2) return [];
        var pattern = $"%{searchTerm.Trim().ToUpperInvariant()}%";
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = CreateCommand(dbContext.Database.GetDbConnection(), null, """
                WITH EMPLEADOS_PAGINADOS AS (
                    SELECT e.NPAGO AS NO_PAGO, e.NOMBRE_EMPLEADO AS NOMBRE_COMPLETO, e.ESTADO AS ESTADO_EMPLEADO,
                           a.DEPARTAMENTO_IHSS_ID AS ID_AREA,
                           a.DEPARTAMENTO_IHSS_DESC AS NOMBRE_AREA,
                           b.EDIFICIO_ID AS ID_EDIFICIO,
                           b.EDIFICIO_DESCRIPCION AS NOMBRE_EDIFICIO,
                           COALESCE(a.REGIONA_ID, b.REGIONA_ID) AS ID_REGIONAL,
                           r.DESCRIPCION AS NOMBRE_REGIONAL,
                           ROW_NUMBER() OVER (ORDER BY UPPER(e.NOMBRE_EMPLEADO), e.NPAGO) AS EMPLOYEE_ROW
                    FROM EMPLEADOS_IHSS e
                    LEFT JOIN DEPARTAMENTO_IHSS a ON a.DEPARTAMENTO_IHSS_ID = e.DEPARTAMENTO_IHSS_ID
                    LEFT JOIN EDIFICIO b ON b.EDIFICIO_ID = a.EDIFICIO_ID
                    LEFT JOIN REGIONAL r ON r.REGIONA_ID = COALESCE(a.REGIONA_ID, b.REGIONA_ID)
                    WHERE UPPER(e.NOMBRE_EMPLEADO) LIKE :searchName
                       OR UPPER(e.NPAGO) LIKE :searchPayment
                )
                SELECT e.NO_PAGO, e.NOMBRE_COMPLETO, e.ESTADO_EMPLEADO, e.ID_AREA, e.NOMBRE_AREA,
                       e.ID_EDIFICIO, e.NOMBRE_EDIFICIO, e.ID_REGIONAL, e.NOMBRE_REGIONAL,
                       d.ID_EQUIPO, d.CODIGO_INVENTARIO, d.NO_SERIE, d.MARCA, d.MODELO,
                       t.TIPO_DISPOSITIVO AS NOMBRE_TIPO, d.ESTADO,
                       d.NUMERO_PAGO_ASIGNADO, d.NOMBRE_ASIGNADO, d.ID_AREA AS DEVICE_ID_AREA,
                       da.DEPARTAMENTO_IHSS_DESC AS DEVICE_NOMBRE_AREA,
                       db.EDIFICIO_ID AS DEVICE_ID_EDIFICIO,
                       db.EDIFICIO_DESCRIPCION AS DEVICE_NOMBRE_EDIFICIO,
                       COALESCE(da.REGIONA_ID, db.REGIONA_ID) AS DEVICE_ID_REGIONAL,
                       dr.DESCRIPCION AS DEVICE_NOMBRE_REGIONAL,
                       e.EMPLOYEE_ROW
                FROM EMPLEADOS_PAGINADOS e
                LEFT JOIN DISPOSITIVOS d
                                    ON (e.NO_PAGO IS NOT NULL AND TRIM(d.NUMERO_PAGO_ASIGNADO) = TRIM(e.NO_PAGO))
                                    OR UPPER(TRIM(d.NOMBRE_ASIGNADO)) = UPPER(TRIM(e.NOMBRE_COMPLETO))
                LEFT JOIN TIPOS_DISPOSITIVOS t ON t.ID_TIPO = d.ID_TIPO
                LEFT JOIN DEPARTAMENTO_IHSS da ON da.DEPARTAMENTO_IHSS_ID = d.ID_AREA
                LEFT JOIN EDIFICIO db ON db.EDIFICIO_ID = da.EDIFICIO_ID
                LEFT JOIN REGIONAL dr ON dr.REGIONA_ID = COALESCE(da.REGIONA_ID, db.REGIONA_ID)
                WHERE e.EMPLOYEE_ROW <= 25
                ORDER BY e.EMPLOYEE_ROW, d.ID_EQUIPO
                """,
                ("searchName", pattern), ("searchPayment", pattern));
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            var employees = new Dictionary<string, EmployeeSearchDto>(StringComparer.OrdinalIgnoreCase);
            var devicesByEmployee = new Dictionary<string, List<EmployeeAssignedDeviceDto>>(StringComparer.OrdinalIgnoreCase);
            var seenDevices = new Dictionary<string, HashSet<int>>(StringComparer.OrdinalIgnoreCase);
            while (await reader.ReadAsync(cancellationToken))
            {
                var noPago = ReadString(reader, "NO_PAGO");
                var name = ReadString(reader, "NOMBRE_COMPLETO");
                var key = string.IsNullOrWhiteSpace(noPago) ? name : noPago;
                if (!employees.ContainsKey(key))
                {
                    employees[key] = new EmployeeSearchDto(
                        noPago, name, Convert.ToString(reader.GetValue(reader.GetOrdinal("ESTADO_EMPLEADO"))) ?? string.Empty,
                        ReadNullableInt(reader, "ID_AREA"), ReadNullableString(reader, "NOMBRE_AREA"),
                        ReadNullableInt(reader, "ID_EDIFICIO"), ReadNullableString(reader, "NOMBRE_EDIFICIO"),
                        ReadNullableInt(reader, "ID_REGIONAL"), ReadNullableString(reader, "NOMBRE_REGIONAL"),
                        Array.Empty<EmployeeAssignedDeviceDto>());
                    devicesByEmployee[key] = [];
                    seenDevices[key] = [];
                }

                if (!reader.IsDBNull(reader.GetOrdinal("ID_EQUIPO")))
                {
                    var deviceId = reader.GetInt32(reader.GetOrdinal("ID_EQUIPO"));
                    if (seenDevices[key].Add(deviceId))
                    {
                        devicesByEmployee[key].Add(new EmployeeAssignedDeviceDto(
                            deviceId,
                            ReadString(reader, "CODIGO_INVENTARIO"),
                            ReadString(reader, "NO_SERIE"),
                            ReadString(reader, "MARCA"),
                            ReadString(reader, "MODELO"),
                            ReadNullableString(reader, "NOMBRE_TIPO"),
                            ReadString(reader, "ESTADO"),
                            ReadNullableString(reader, "NUMERO_PAGO_ASIGNADO"),
                            ReadNullableString(reader, "NOMBRE_ASIGNADO"),
                            ReadNullableInt(reader, "DEVICE_ID_AREA"),
                            ReadNullableString(reader, "DEVICE_NOMBRE_AREA"),
                            ReadNullableInt(reader, "DEVICE_ID_EDIFICIO"),
                            ReadNullableString(reader, "DEVICE_NOMBRE_EDIFICIO"),
                            ReadNullableInt(reader, "DEVICE_ID_REGIONAL"),
                            ReadNullableString(reader, "DEVICE_NOMBRE_REGIONAL")));
                    }
                }
            }

            return employees.Select(employee => employee.Value with
            {
                AssignedDevices = devicesByEmployee[employee.Key],
            }).ToArray();
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
    }

    public async Task<IReadOnlyList<DeviceTypeDto>> GetDeviceTypes(CancellationToken cancellationToken)
    {
        const string sql = "SELECT ID_TIPO, TIPO_DISPOSITIVO FROM TIPOS_DISPOSITIVOS ORDER BY TIPO_DISPOSITIVO";
        return await ReadList(sql, reader => new DeviceTypeDto(
            reader.GetInt32(reader.GetOrdinal("ID_TIPO")),
            ReadString(reader, "TIPO_DISPOSITIVO")), cancellationToken);
    }

    public async Task<IReadOnlyList<BuildingDto>> GetBuildings(CancellationToken cancellationToken)
    {
        const string sql = """
            SELECT b.EDIFICIO_ID, b.EDIFICIO_DESCRIPCION,
                   b.REGIONA_ID AS ID_REGIONAL, r.DESCRIPCION AS NOMBRE_REGIONAL
            FROM EDIFICIO b
            LEFT JOIN REGIONAL r ON r.REGIONA_ID = b.REGIONA_ID
            ORDER BY b.EDIFICIO_DESCRIPCION
            """;
        return await ReadList(sql, reader => new BuildingDto(
            reader.GetInt32(reader.GetOrdinal("EDIFICIO_ID")),
            ReadString(reader, "EDIFICIO_DESCRIPCION"),
            ReadNullableInt(reader, "ID_REGIONAL"),
            ReadNullableString(reader, "NOMBRE_REGIONAL")), cancellationToken);
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
                 SELECT r.ID_REASIGNACION, r.ID_EQUIPO, d.CODIGO_INVENTARIO,
                     r.NO_PAGO_ANTERIOR, r.NO_PAGO_NUEVO, r.FECHA_CAMBIO, r.MOTIVO
                 FROM REASIGNACIONES r
                 LEFT JOIN DISPOSITIVOS d ON d.ID_EQUIPO = r.ID_EQUIPO
                 ORDER BY r.FECHA_CAMBIO DESC
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
        const string sql = """
            SELECT ID_USUARIO, USUARIO, NOMBRE_PERSONA, FECHA_EXPIRACION,
                   ESTADO, DOMINIOP, DOMINIO, ROL, CLAVE_SEGURA
            FROM USUARIOS
            ORDER BY ID_USUARIO
            """;
        return await ReadList(sql, reader => new AdminUserDto(
            reader.GetInt32(reader.GetOrdinal("ID_USUARIO")),
            ReadString(reader, "USUARIO"),
            ReadString(reader, "NOMBRE_PERSONA"),
            ReadNullableDate(reader, "FECHA_EXPIRACION"),
            ReadString(reader, "ESTADO"),
            ReadString(reader, "DOMINIOP"),
            Convert.ToInt32(reader.GetValue(reader.GetOrdinal("DOMINIO"))),
            ReadString(reader, "ROL"),
            ReadString(reader, "CLAVE_SEGURA")), cancellationToken);
    }

    public Task CreateUser(CreateAdminUserDto user, CancellationToken cancellationToken) =>
        Execute("""
            INSERT INTO USUARIOS
                (ID_USUARIO, USUARIO, NOMBRE_PERSONA, FECHA_EXPIRACION,
                 ESTADO, PASSWORD_HASH, ROL, DOMINIOP, DOMINIO, CLAVE_SEGURA)
            SELECT NVL(MAX(ID_USUARIO), 0) + 1,
                   :usuario,
                   :nombrePersona,
                   :fechaExpiracion,
                   :estado,
                   ORA_HASH(:password, 4294967295) || ORA_HASH(:usuarioHash, 4294967295),
                   :rol,
                   :dominioP,
                   :dominio,
                         '0'
            FROM USUARIOS
            """, cancellationToken,
            ("usuario", user.Usuario.Trim()), ("nombrePersona", user.NombrePersona.Trim()),
            ("fechaExpiracion", user.FechaExpiracion), ("estado", user.Estado.Trim()),
            ("password", "1234"), ("usuarioHash", user.Usuario.Trim()),
            ("rol", user.Rol.Trim()), ("dominioP", user.DominioP.Trim().ToUpperInvariant()),
            ("dominio", user.Dominio));

    public async Task<bool> UpdateUser(
        int idUsuario,
        UpdateAdminUserDto user,
        CancellationToken cancellationToken)
    {
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = CreateCommand(dbContext.Database.GetDbConnection(), null, """
                UPDATE USUARIOS
                SET NOMBRE_PERSONA = :nombrePersona,
                    FECHA_EXPIRACION = :fechaExpiracion,
                    ESTADO = :estado,
                    DOMINIOP = :dominioP,
                    DOMINIO = :dominio,
                    ROL = :rol
                WHERE ID_USUARIO = :idUsuario
                """,
                ("nombrePersona", user.NombrePersona.Trim()),
                ("fechaExpiracion", user.FechaExpiracion),
                ("estado", user.Estado.Trim().ToUpperInvariant()),
                ("dominioP", user.DominioP.Trim().ToUpperInvariant()),
                ("dominio", user.Dominio),
                ("rol", user.Rol.Trim()),
                ("idUsuario", idUsuario));
            return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
    }

    public Task DeleteUser(int idUsuario, CancellationToken cancellationToken) =>
        Execute("DELETE FROM USUARIOS WHERE ID_USUARIO = :idUsuario", cancellationToken,
            ("idUsuario", idUsuario));

    public async Task<bool> ResetUserPassword(int idUsuario, CancellationToken cancellationToken)
    {
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = CreateCommand(dbContext.Database.GetDbConnection(), null, """
                UPDATE USUARIOS
                SET PASSWORD_HASH = ORA_HASH(:password, 4294967295)
                                      || ORA_HASH(USUARIO, 4294967295),
                    CLAVE_SEGURA = '0'
                WHERE ID_USUARIO = :idUsuario
                  AND DOMINIO = 0
                """,
                ("password", "1234"),
                ("idUsuario", idUsuario));
            return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
    }

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
            parameter.DbType = value switch
            {
                int => DbType.Int32,
                DateTime => DbType.Date,
                null => DbType.String,
                _ => DbType.String,
            };
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
            ReadNullableString(reader, "NOMBRE_EDIFICIO"),
            ReadNullableInt(reader, "ID_REGIONAL"),
            ReadNullableString(reader, "NOMBRE_REGIONAL"));

    private static ReassignmentDto ReadReassignment(DbDataReader reader) => new(
        reader.GetInt32(reader.GetOrdinal("ID_REASIGNACION")),
        reader.GetInt32(reader.GetOrdinal("ID_EQUIPO")),
        ReadString(reader, "CODIGO_INVENTARIO"),
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

    private static DateTime? ReadNullableDate(DbDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : Convert.ToDateTime(reader.GetValue(ordinal));
    }
}