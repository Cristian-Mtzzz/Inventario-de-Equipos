using System.Data.Common;
using SistemaInventario.Api.Data;
using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Persistencia del directorio de empleados (EMPLEADOS_IHSS): búsqueda con sus
// equipos asignados, opciones por departamento y mantenimiento del catálogo.
public sealed class EmployeeService(InventoryDbContext dbContext) : OracleRepository(dbContext), IEmployeeService
{
    // Buscador de los formularios (dispositivos, reasignaciones, tickets, empleados): por nombre o No. de
    // pago, cada palabra debe coincidir; máximo 50 resultados, sin los equipos asignados.
    public Task<IReadOnlyList<EmployeeLookupDto>> LookupEmployees(string searchTerm, CancellationToken cancellationToken)
    {
        var tokens = searchTerm.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(6).ToArray();
        if (searchTerm.Trim().Length < 2 || tokens.Length == 0) return Task.FromResult<IReadOnlyList<EmployeeLookupDto>>([]);
        var conditions = tokens.Select((_, index) =>
            $"(UPPER(e.NOMBRE_EMPLEADO) LIKE :name{index} OR UPPER(e.NPAGO) LIKE :payment{index})");
        var parameters = tokens.SelectMany((token, index) => new (string Name, object? Value)[]
        {
            ($"name{index}", $"%{token.ToUpperInvariant()}%"),
            ($"payment{index}", $"%{token.ToUpperInvariant()}%"),
        }).ToArray();

        // ROWNUM y no FETCH FIRST: la base no admite la sintaxis de Oracle 12c (ORA-00933).
        return ReadList($"""
            SELECT * FROM (
            SELECT e.EMPLEADOS_IHSS_ID AS ID_EMPLEADO, ROWIDTOCHAR(e.ROWID) AS EMPLOYEE_KEY,
                   TRIM(e.NPAGO) AS NO_PAGO, e.NOMBRE_EMPLEADO AS NOMBRE_COMPLETO,
                   a.DEPARTAMENTO_IHSS_ID AS ID_AREA, a.DEPARTAMENTO_IHSS_DESC AS NOMBRE_AREA,
                   b.EDIFICIO_ID AS ID_EDIFICIO, b.EDIFICIO_DESCRIPCION AS NOMBRE_EDIFICIO,
                   COALESCE(a.REGIONA_ID, b.REGIONA_ID) AS ID_REGIONAL, r.DESCRIPCION AS NOMBRE_REGIONAL
            FROM EMPLEADOS_IHSS e
            LEFT JOIN DEPARTAMENTO_IHSS a ON a.DEPARTAMENTO_IHSS_ID = e.DEPARTAMENTO_IHSS_ID
            LEFT JOIN EDIFICIO b ON b.EDIFICIO_ID = a.EDIFICIO_ID
            LEFT JOIN REGIONAL r ON r.REGIONA_ID = COALESCE(a.REGIONA_ID, b.REGIONA_ID)
            WHERE {string.Join(" AND ", conditions)}
            ORDER BY UPPER(e.NOMBRE_EMPLEADO), e.NPAGO
            ) WHERE ROWNUM <= 50
            """, reader => new EmployeeLookupDto(
                ReadInt(reader, "ID_EMPLEADO"),
                ReadString(reader, "EMPLOYEE_KEY"),
                ReadString(reader, "NO_PAGO"),
                ReadString(reader, "NOMBRE_COMPLETO"),
                ReadNullableInt(reader, "ID_AREA"),
                ReadNullableString(reader, "NOMBRE_AREA"),
                ReadNullableInt(reader, "ID_EDIFICIO"),
                ReadNullableString(reader, "NOMBRE_EDIFICIO"),
                ReadNullableInt(reader, "ID_REGIONAL"),
                ReadNullableString(reader, "NOMBRE_REGIONAL")),
            cancellationToken, parameters);
    }

    public async Task<IReadOnlyList<EmployeeSearchDto>> SearchEmployees(
        string searchTerm,
        CancellationToken cancellationToken)
    {
        if (searchTerm.Trim().Length < 2) return [];
        var searchTokens = searchTerm.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Select((token, index) => (Token: token, Index: index))
            .ToArray();
        var searchConditions = searchTokens.Select(token =>
            $"(UPPER(e.NOMBRE_EMPLEADO) LIKE :searchName{token.Index} OR UPPER(e.NPAGO) LIKE :searchPayment{token.Index})")
            .ToList();
        var searchParameters = searchTokens.SelectMany(token => new (string Name, object? Value)[]
        {
            ($"searchName{token.Index}", $"%{token.Token.ToUpperInvariant()}%"),
            ($"searchPayment{token.Index}", $"%{token.Token.ToUpperInvariant()}%"),
        }).ToArray();

        // Cada fila combina un empleado con uno de sus equipos; se agrupan por empleado.
        var rows = await ReadList($"""
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
                WHERE {string.Join(" AND ", searchConditions)}
            )
            SELECT e.NO_PAGO, e.NOMBRE_COMPLETO, e.ESTADO_EMPLEADO, e.ID_AREA, e.NOMBRE_AREA,
                   e.ID_EDIFICIO, e.NOMBRE_EDIFICIO, e.ID_REGIONAL, e.NOMBRE_REGIONAL,
                   d.ID_EQUIPO, d.CODIGO_INVENTARIO, d.NO_SERIE, d.MARCA, d.MODELO,
                   t.TIPO_DISPOSITIVO AS NOMBRE_TIPO, d.ESTADO,
                   d.NUMERO_PAGO_ASIGNADO, d.NOMBRE_ASIGNADO, d.ID_TIPO AS DEVICE_ID_TIPO,
                   d.ID_AREA AS DEVICE_ID_AREA,
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
            """, reader => (
                Employee: new EmployeeSearchDto(
                    ReadString(reader, "NO_PAGO"),
                    ReadString(reader, "NOMBRE_COMPLETO"),
                    ReadString(reader, "ESTADO_EMPLEADO"),
                    ReadNullableInt(reader, "ID_AREA"), ReadNullableString(reader, "NOMBRE_AREA"),
                    ReadNullableInt(reader, "ID_EDIFICIO"), ReadNullableString(reader, "NOMBRE_EDIFICIO"),
                    ReadNullableInt(reader, "ID_REGIONAL"), ReadNullableString(reader, "NOMBRE_REGIONAL"),
                    Array.Empty<EmployeeAssignedDeviceDto>()),
                Device: ReadNullableInt(reader, "ID_EQUIPO") is int deviceId
                    ? new EmployeeAssignedDeviceDto(
                        deviceId,
                        ReadString(reader, "CODIGO_INVENTARIO"),
                        ReadString(reader, "NO_SERIE"),
                        ReadString(reader, "MARCA"),
                        ReadString(reader, "MODELO"),
                        ReadNullableInt(reader, "DEVICE_ID_TIPO"),
                        ReadNullableString(reader, "NOMBRE_TIPO"),
                        ReadString(reader, "ESTADO"),
                        ReadNullableString(reader, "NUMERO_PAGO_ASIGNADO"),
                        ReadNullableString(reader, "NOMBRE_ASIGNADO"),
                        ReadNullableInt(reader, "DEVICE_ID_AREA"),
                        ReadNullableString(reader, "DEVICE_NOMBRE_AREA"),
                        ReadNullableInt(reader, "DEVICE_ID_EDIFICIO"),
                        ReadNullableString(reader, "DEVICE_NOMBRE_EDIFICIO"),
                        ReadNullableInt(reader, "DEVICE_ID_REGIONAL"),
                        ReadNullableString(reader, "DEVICE_NOMBRE_REGIONAL"))
                    : null),
            cancellationToken, searchParameters);

        // Agrupa por número de pago (o por nombre cuando no tiene) conservando el orden de la consulta.
        return rows
            .GroupBy(row => string.IsNullOrWhiteSpace(row.Employee.NoPago) ? row.Employee.NombreCompleto : row.Employee.NoPago,
                StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First().Employee with
            {
                AssignedDevices = group
                    .Select(row => row.Device)
                    .OfType<EmployeeAssignedDeviceDto>()
                    .DistinctBy(device => device.IdEquipo)
                    .ToArray(),
            })
            .ToArray();
    }

    public Task<IReadOnlyList<EmployeeOptionDto>> GetEmployeeOptions(int idArea, CancellationToken cancellationToken) =>
        ReadList("""
            SELECT NPAGO AS NO_PAGO, NOMBRE_EMPLEADO AS NOMBRE_COMPLETO,
                   DEPARTAMENTO_IHSS_ID AS ID_AREA
            FROM EMPLEADOS_IHSS
            WHERE DEPARTAMENTO_IHSS_ID = :idArea
            ORDER BY UPPER(NOMBRE_EMPLEADO), NPAGO
            """, reader => new EmployeeOptionDto(
                ReadString(reader, "NO_PAGO"),
                ReadString(reader, "NOMBRE_COMPLETO"),
                ReadNullableInt(reader, "ID_AREA")),
            cancellationToken, ("idArea", idArea));

    public Task<IReadOnlyList<DirectoryEmployeeDto>> GetDirectoryEmployees(CancellationToken cancellationToken) =>
        ReadList("""
            SELECT ROWIDTOCHAR(ROWID) AS EMPLOYEE_KEY, NPAGO AS NO_PAGO,
                   NOMBRE_EMPLEADO AS NOMBRE_COMPLETO, DEPARTAMENTO_IHSS_ID AS ID_AREA
            FROM EMPLEADOS_IHSS
            ORDER BY UPPER(NOMBRE_EMPLEADO), NPAGO
            """, reader => new DirectoryEmployeeDto(
                ReadString(reader, "EMPLOYEE_KEY"),
                ReadString(reader, "NO_PAGO"),
                ReadString(reader, "NOMBRE_COMPLETO"),
                ReadNullableInt(reader, "ID_AREA")),
            cancellationToken);

    // Listado del módulo Empleados, ordenado por ubicación: región, edificio y departamento.
    // El No. de pago llega vacío en la mayoría y es lo que la tabla permite completar.
    public Task<IReadOnlyList<EmployeeRosterDto>> GetEmployeeRoster(CancellationToken cancellationToken) =>
        ReadList("""
            SELECT ROWIDTOCHAR(e.ROWID) AS EMPLOYEE_KEY,
                   r.DESCRIPCION AS REGION,
                   b.EDIFICIO_DESCRIPCION AS EDIFICIO,
                   a.DEPARTAMENTO_IHSS_DESC AS DEPARTAMENTO,
                   e.NOMBRE_EMPLEADO AS NOMBRE_COMPLETO,
                   e.NPAGO AS NO_PAGO
            FROM EMPLEADOS_IHSS e
            LEFT JOIN DEPARTAMENTO_IHSS a ON a.DEPARTAMENTO_IHSS_ID = e.DEPARTAMENTO_IHSS_ID
            LEFT JOIN EDIFICIO b ON b.EDIFICIO_ID = a.EDIFICIO_ID
            LEFT JOIN REGIONAL r ON r.REGIONA_ID = COALESCE(a.REGIONA_ID, b.REGIONA_ID)
            ORDER BY r.DESCRIPCION, b.EDIFICIO_DESCRIPCION,
                     a.DEPARTAMENTO_IHSS_DESC, UPPER(e.NOMBRE_EMPLEADO)
            """, reader => new EmployeeRosterDto(
                ReadString(reader, "EMPLOYEE_KEY"),
                ReadNullableString(reader, "REGION"),
                ReadNullableString(reader, "EDIFICIO"),
                ReadNullableString(reader, "DEPARTAMENTO"),
                ReadString(reader, "NOMBRE_COMPLETO"),
                ReadNullableString(reader, "NO_PAGO")),
            cancellationToken);

    // Asigna (o limpia) el No. de pago de un empleado identificado por su ROWID, porque
    // los que todavía no lo tienen no se pueden identificar por NPAGO.
    public Task<bool> SetEmployeePaymentNumber(
        string employeeKey,
        string? noPago,
        CancellationToken cancellationToken) =>
        // La comprobación y el guardado van juntos para que dos asignaciones simultáneas
        // no terminen dándole el mismo número a dos empleados.
        InTransaction(async (connection, transaction) =>
        {
            var numeroPago = NullIfBlank(noPago);
            await EnsurePaymentNumberIsFree(connection, transaction, numeroPago, employeeKey, cancellationToken);

            return await Execute(connection, transaction, """
                UPDATE EMPLEADOS_IHSS
                SET NPAGO = :noPago
                WHERE ROWID = CHARTOROWID(:employeeKey)
                """, cancellationToken,
                ("noPago", numeroPago), ("employeeKey", employeeKey)) == 1;
        }, cancellationToken);

    // Se edita por No. de pago solo si identifica a un único empleado; con duplicados se
    // cambiarían todos a la vez, así que se pide hacerlo desde el directorio.
    public Task<bool> UpdateEmployee(
        string noPagoActual,
        UpdateEmployeeDto employee,
        CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var employeeKey = await SingleEmployeeKeyByPaymentNumber(connection, transaction, noPagoActual, cancellationToken);
            if (employeeKey is null) return false;
            await EnsurePaymentNumberIsFree(connection, transaction, NullIfBlank(employee.NoPago), employeeKey, cancellationToken);

            return await Execute(connection, transaction, """
                UPDATE EMPLEADOS_IHSS
                SET NPAGO = COALESCE(:noPagoNuevo, NPAGO),
                    NOMBRE_EMPLEADO = :nombreCompleto,
                    DEPARTAMENTO_IHSS_ID = :idArea
                WHERE ROWID = CHARTOROWID(:employeeKey)
                """, cancellationToken,
                ("noPagoNuevo", NullIfBlank(employee.NoPago)),
                ("nombreCompleto", employee.NombreCompleto.Trim()),
                ("idArea", employee.IdArea),
                ("employeeKey", employeeKey)) == 1;
        }, cancellationToken);

    public Task CreateDirectoryEmployee(SaveDirectoryEmployeeDto employee, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            await EnsurePaymentNumberIsFree(connection, transaction, NullIfBlank(employee.NoPago), null, cancellationToken);
            var employeeId = await NextId(connection, transaction, "EMPLEADOS_IHSS", "EMPLEADOS_IHSS_ID", cancellationToken);
            await Execute(connection, transaction, """
                INSERT INTO EMPLEADOS_IHSS
                    (EMPLEADOS_IHSS_ID, NPAGO, NOMBRE_EMPLEADO, ESTADO, DEPARTAMENTO_IHSS_ID)
                VALUES (:employeeId, :noPago, :nombre, 1, :idArea)
                """, cancellationToken,
                ("employeeId", employeeId),
                ("noPago", NullIfBlank(employee.NoPago)),
                ("nombre", employee.NombreCompleto.Trim()),
                ("idArea", employee.IdArea));
        }, cancellationToken);

    // Igual que al editar: con un No. de pago repetido se borrarían todos los que lo comparten.
    public Task<bool> DeleteDirectoryEmployee(string noPago, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var employeeKey = await SingleEmployeeKeyByPaymentNumber(connection, transaction, noPago, cancellationToken);
            return employeeKey is not null && await Execute(connection, transaction,
                "DELETE FROM EMPLEADOS_IHSS WHERE ROWID = CHARTOROWID(:employeeKey)", cancellationToken,
                ("employeeKey", employeeKey)) == 1;
        }, cancellationToken);

    public Task<bool> UpdateDirectoryEmployeeByKey(
        string employeeKey,
        UpdateEmployeeDto employee,
        CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            await EnsurePaymentNumberIsFree(connection, transaction, NullIfBlank(employee.NoPago), employeeKey, cancellationToken);

            return await Execute(connection, transaction, """
                UPDATE EMPLEADOS_IHSS
                SET NPAGO = COALESCE(:noPagoNuevo, NPAGO),
                    NOMBRE_EMPLEADO = :nombreCompleto,
                    DEPARTAMENTO_IHSS_ID = :idArea
                WHERE ROWID = CHARTOROWID(:employeeKey)
                """, cancellationToken,
                ("noPagoNuevo", NullIfBlank(employee.NoPago)),
                ("nombreCompleto", employee.NombreCompleto.Trim()),
                ("idArea", employee.IdArea),
                ("employeeKey", employeeKey)) == 1;
        }, cancellationToken);

    public async Task<bool> DeleteDirectoryEmployeeByKey(string employeeKey, CancellationToken cancellationToken) =>
        await Execute("DELETE FROM EMPLEADOS_IHSS WHERE ROWID = CHARTOROWID(:employeeKey)", cancellationToken,
            ("employeeKey", employeeKey)) == 1;

    // EMPLEADOS_IHSS no tiene restricción única sobre NPAGO, así que se valida aquí antes de
    // guardar. exceptEmployeeKey excluye al propio empleado cuando se está editando.
    private static async Task EnsurePaymentNumberIsFree(
        DbConnection connection,
        DbTransaction transaction,
        string? noPago,
        string? exceptEmployeeKey,
        CancellationToken cancellationToken)
    {
        if (noPago is null) return;
        var takenBy = exceptEmployeeKey is null
            ? await GetScalar<string?>(connection, transaction, """
                SELECT MAX(NOMBRE_EMPLEADO) FROM EMPLEADOS_IHSS
                WHERE TRIM(NPAGO) = TRIM(:noPago)
                """, cancellationToken, ("noPago", noPago))
            : await GetScalar<string?>(connection, transaction, """
                SELECT MAX(NOMBRE_EMPLEADO) FROM EMPLEADOS_IHSS
                WHERE TRIM(NPAGO) = TRIM(:noPago)
                  AND ROWID <> CHARTOROWID(:employeeKey)
                """, cancellationToken, ("noPago", noPago), ("employeeKey", exceptEmployeeKey));
        if (!string.IsNullOrWhiteSpace(takenBy))
        {
            throw new ArgumentException($"El No. de pago {noPago} ya es de {takenBy}.");
        }
    }

    // Clave (ROWID) del único empleado con ese No. de pago; null si no hay ninguno.
    private static async Task<string?> SingleEmployeeKeyByPaymentNumber(
        DbConnection connection,
        DbTransaction transaction,
        string noPago,
        CancellationToken cancellationToken)
    {
        var matches = await GetScalar<int>(connection, transaction,
            "SELECT COUNT(*) FROM EMPLEADOS_IHSS WHERE TRIM(NPAGO) = TRIM(:noPago)", cancellationToken,
            ("noPago", noPago.Trim()));
        if (matches > 1)
        {
            throw new ArgumentException(
                $"Hay {matches} empleados con el No. de pago {noPago.Trim()}. Corrígelo desde la lista de empleados, eligiendo a cada uno.");
        }
        return matches == 0
            ? null
            : await GetScalar<string?>(connection, transaction,
                "SELECT ROWIDTOCHAR(ROWID) FROM EMPLEADOS_IHSS WHERE TRIM(NPAGO) = TRIM(:noPago)", cancellationToken,
                ("noPago", noPago.Trim()));
    }

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
