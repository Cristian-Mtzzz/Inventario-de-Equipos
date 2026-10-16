using SistemaInventario.Api.Data;
using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Persistencia del directorio de empleados (EMPLEADOS_IHSS): búsqueda con sus
// equipos asignados, opciones por departamento y mantenimiento del catálogo.
public sealed class EmployeeService(InventoryDbContext dbContext) : OracleRepository(dbContext), IEmployeeService
{
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

    public async Task<bool> UpdateEmployee(
        string noPagoActual,
        UpdateEmployeeDto employee,
        CancellationToken cancellationToken) =>
        await Execute("""
            UPDATE EMPLEADOS_IHSS
            SET NPAGO = COALESCE(:noPagoNuevo, NPAGO),
                NOMBRE_EMPLEADO = :nombreCompleto,
                DEPARTAMENTO_IHSS_ID = :idArea
            WHERE TRIM(NPAGO) = TRIM(:noPagoActual)
            """, cancellationToken,
            ("noPagoNuevo", NullIfBlank(employee.NoPago)),
            ("nombreCompleto", employee.NombreCompleto.Trim()),
            ("idArea", employee.IdArea),
            ("noPagoActual", noPagoActual.Trim())) > 0;

    public Task CreateDirectoryEmployee(SaveDirectoryEmployeeDto employee, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
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

    public async Task<bool> DeleteDirectoryEmployee(string noPago, CancellationToken cancellationToken) =>
        await Execute("DELETE FROM EMPLEADOS_IHSS WHERE TRIM(NPAGO) = TRIM(:noPago)", cancellationToken,
            ("noPago", noPago.Trim())) == 1;

    public async Task<bool> UpdateDirectoryEmployeeByKey(
        string employeeKey,
        UpdateEmployeeDto employee,
        CancellationToken cancellationToken) =>
        await Execute("""
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

    public async Task<bool> DeleteDirectoryEmployeeByKey(string employeeKey, CancellationToken cancellationToken) =>
        await Execute("DELETE FROM EMPLEADOS_IHSS WHERE ROWID = CHARTOROWID(:employeeKey)", cancellationToken,
            ("employeeKey", employeeKey)) == 1;

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
