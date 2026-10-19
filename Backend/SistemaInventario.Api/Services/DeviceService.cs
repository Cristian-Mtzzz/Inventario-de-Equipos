using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using SistemaInventario.Api.Data;
using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Persistencia de dispositivos: consulta paginada, alta individual o en combo,
// edición con historial de asignaciones y eliminación con sus relaciones.
public sealed class DeviceService(InventoryDbContext dbContext) : AssignmentRepository(dbContext), IDeviceService
{
    public async Task<PagedResult<DeviceDto>> GetDevices(
        int requestedPage,
        int requestedPageSize,
        string? searchTerm,
        string? brand,
        string? model,
        int? typeId,
        int? regionalId,
        int? buildingId,
        int? areaId,
        string? state,
        bool comboOnly,
        CancellationToken cancellationToken)
    {
        var pageSize = Math.Clamp(requestedPageSize, 10, 500);
        const string fromSql = """
            FROM DISPOSITIVOS d
            LEFT JOIN TIPOS_DISPOSITIVOS t ON t.ID_TIPO = d.ID_TIPO
            LEFT JOIN DEPARTAMENTO_IHSS a ON a.DEPARTAMENTO_IHSS_ID = d.ID_AREA
            LEFT JOIN EDIFICIO b ON b.EDIFICIO_ID = a.EDIFICIO_ID
            LEFT JOIN REGIONAL r ON r.REGIONA_ID = COALESCE(a.REGIONA_ID, b.REGIONA_ID)
            """;
        var conditions = new List<string>();

        // Agrega condiciones de filtro dinámicamente según los parámetros proporcionados
        var parameters = new List<(string Name, object? Value)>();

        void AddDeviceFilter(string condition, string parameterName, object? value)
        {
            if (value is null || value is string text && string.IsNullOrWhiteSpace(text)) return;
            conditions.Add(condition);
            parameters.Add((parameterName, value));
        }

        // Filtro de búsqueda en varios campos, incluyendo código de inventario, número de serie, marca, modelo, número de pago asignado y nombre asignado.
        if (!string.IsNullOrWhiteSpace(searchTerm))
        {
            var pattern = $"%{searchTerm.Trim().ToUpperInvariant()}%";
            var deviceSearch = "(UPPER(d.CODIGO_INVENTARIO) LIKE :searchCode OR UPPER(d.NO_SERIE) LIKE :searchSerial OR UPPER(d.MARCA) LIKE :searchBrand OR UPPER(d.MODELO) LIKE :searchModel OR UPPER(d.COMPONENTE) LIKE :searchComponent OR UPPER(d.NUMERO_INGRESO) LIKE :searchIngreso)";
            if (comboOnly)
            {
                deviceSearch = $"({deviceSearch} OR EXISTS (SELECT 1 FROM DISPOSITIVOS sibling WHERE sibling.NCOMBO = d.NCOMBO AND (UPPER(sibling.CODIGO_INVENTARIO) LIKE :siblingCode OR UPPER(sibling.NO_SERIE) LIKE :siblingSerial OR UPPER(sibling.MARCA) LIKE :siblingBrand OR UPPER(sibling.MODELO) LIKE :siblingModel OR UPPER(sibling.COMPONENTE) LIKE :siblingComponent)))";
                parameters.Add(("siblingCode", pattern));
                parameters.Add(("siblingSerial", pattern));
                parameters.Add(("siblingBrand", pattern));
                parameters.Add(("siblingModel", pattern));
                parameters.Add(("siblingComponent", pattern));
            }
            conditions.Add($"({deviceSearch} OR UPPER(d.NUMERO_PAGO_ASIGNADO) LIKE :searchPayment OR UPPER(NULLIF(TRIM(d.NOMBRE_ASIGNADO), '')) LIKE :searchAssignedName OR (NULLIF(TRIM(d.NOMBRE_ASIGNADO), '') IS NULL AND EXISTS (SELECT 1 FROM EMPLEADOS_IHSS e WHERE TRIM(e.NPAGO) = TRIM(d.NUMERO_PAGO_ASIGNADO) AND UPPER(e.NOMBRE_EMPLEADO) LIKE :searchEmployee)))");
            parameters.Add(("searchCode", pattern));
            parameters.Add(("searchSerial", pattern));
            parameters.Add(("searchBrand", pattern));
            parameters.Add(("searchModel", pattern));
            parameters.Add(("searchComponent", pattern));
            parameters.Add(("searchIngreso", pattern));
            parameters.Add(("searchPayment", pattern));
            parameters.Add(("searchAssignedName", pattern));
            parameters.Add(("searchEmployee", pattern));
        }
        // Filtros adicionales para marca, modelo, tipo de dispositivo, regional, edificio, área y estado.
        AddDeviceFilter("UPPER(TRIM(d.MARCA)) = :brand", "brand", brand?.Trim().ToUpperInvariant());
        AddDeviceFilter("UPPER(TRIM(d.MODELO)) = :model", "model", model?.Trim().ToUpperInvariant());
        // Las piezas de un combo tienen tipo COMPUTADORA ESCRITORIO y guardan en COMPONENTE si son
        // CPU, MONITOR o TECLADO; al filtrar por esos tipos también se incluyen.
        AddDeviceFilter("""
            (d.ID_TIPO = :typeId OR (d.COMPONENTE IS NOT NULL AND UPPER(TRIM(d.COMPONENTE)) =
                (SELECT UPPER(TRIM(ft.TIPO_DISPOSITIVO)) FROM TIPOS_DISPOSITIVOS ft WHERE ft.ID_TIPO = :typeId)))
            """, "typeId", typeId);
        AddDeviceFilter("COALESCE(a.REGIONA_ID, b.REGIONA_ID) = :regionalId", "regionalId", regionalId);
        AddDeviceFilter("b.EDIFICIO_ID = :buildingId", "buildingId", buildingId);
        AddDeviceFilter("d.ID_AREA = :areaId", "areaId", areaId);
        AddDeviceFilter("UPPER(TRIM(d.ESTADO)) = :state", "state", state?.Trim().ToUpperInvariant());
        if (comboOnly) conditions.Add("d.NCOMBO IS NOT NULL");

        // Construye el WHERE según las condiciones acumuladas.
        var whereSql = conditions.Count == 0 ? string.Empty : $"WHERE {string.Join(" AND ", conditions)}";
        var orderSql = comboOnly
            ? "d.NCOMBO, CASE UPPER(d.COMPONENTE) WHEN 'CPU' THEN 1 WHEN 'TECLADO' THEN 2 WHEN 'MONITOR' THEN 3 ELSE 4 END, d.ID_EQUIPO"
            : "d.ID_EQUIPO";
        var sql = $"""
            SELECT paged_devices.*,
                   COALESCE(NULLIF(TRIM(paged_devices.NOMBRE_ASIGNADO), ''),
                       (SELECT MAX(e.NOMBRE_EMPLEADO)
                        FROM EMPLEADOS_IHSS e
                        WHERE TRIM(e.NPAGO) = TRIM(paged_devices.NUMERO_PAGO_ASIGNADO))) AS ASIGNADO_A,
                   CASE WHEN paged_devices.ESTADO = 'ASIGNADO' THEN
                       (SELECT MAX(r.FECHA_CAMBIO)
                        FROM REASIGNACIONES r
                        WHERE r.ID_EQUIPO = paged_devices.ID_EQUIPO)
                   ELSE NULL END AS FECHA_ASIGNACION
            FROM (
                SELECT * FROM (
                    SELECT d.ID_EQUIPO, d.CODIGO_INVENTARIO, d.NO_SERIE, d.MARCA, d.MODELO,
                           d.ID_TIPO, t.TIPO_DISPOSITIVO AS NOMBRE_TIPO, d.ESTADO,
                           d.NUMERO_PAGO_ASIGNADO, d.NOMBRE_ASIGNADO, d.ID_AREA,
                           d.NCOMBO, d.COMPONENTE, d.NUMERO_INGRESO,
                           a.DEPARTAMENTO_IHSS_DESC AS NOMBRE_AREA, a.EDIFICIO_ID AS ID_EDIFICIO,
                           b.EDIFICIO_DESCRIPCION AS NOMBRE_EDIFICIO,
                           COALESCE(a.REGIONA_ID, b.REGIONA_ID) AS ID_REGIONAL,
                           r.DESCRIPCION AS NOMBRE_REGIONAL,
                           COUNT(*) OVER() AS TOTAL_COUNT,
                           ROW_NUMBER() OVER (ORDER BY {orderSql}) AS ROW_NUM
                    {fromSql}
                    {whereSql}
                )
                WHERE ROW_NUM > :startRow AND ROW_NUM <= :endRow
            )
            paged_devices
            ORDER BY paged_devices.ROW_NUM
            """;

        await DbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            var connection = DbContext.Database.GetDbConnection();

            // Lee una página y devuelve los dispositivos junto con el total de registros encontrados.
            async Task<(List<DeviceDto> Items, int TotalCount)> ReadPage(int page)
            {
                var startRow = (page - 1) * pageSize;
                var pageParameters = parameters
                    .Append(("startRow", (object?)startRow))
                    .Append(("endRow", (object?)(startRow + pageSize)))
                    .ToArray();
                await using var command = CreateCommand(connection, null, sql, pageParameters);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                var items = new List<DeviceDto>(pageSize);
                var totalCount = 0;
                while (await reader.ReadAsync(cancellationToken))
                {
                    if (items.Count == 0)
                    {
                        totalCount = ReadInt(reader, "TOTAL_COUNT");
                    }
                    items.Add(ReadDevice(reader));
                }
                return (items, totalCount);
            }

            // Si la página solicitada quedó fuera de rango, se ajusta a la última disponible.
            var page = Math.Max(1, requestedPage);
            var (items, totalCount) = await ReadPage(page);
            if (items.Count == 0 && requestedPage > 1)
            {
                totalCount = await GetScalar<int>(connection, null,
                    $"SELECT COUNT(DISTINCT d.ID_EQUIPO) {fromSql} {whereSql}", cancellationToken, parameters.ToArray());
                var lastPage = Math.Max(1, (int)Math.Ceiling(totalCount / (double)pageSize));
                page = Math.Clamp(requestedPage, 1, lastPage);
                if (page != requestedPage)
                {
                    (items, _) = await ReadPage(page);
                }
            }
            return new PagedResult<DeviceDto>(items, totalCount, page, pageSize);
        }
        finally
        {
            await DbContext.Database.CloseConnectionAsync();
        }
    }

    public Task<IReadOnlyList<DeviceOptionDto>> SearchDeviceOptions(
        string searchTerm,
        CancellationToken cancellationToken)
    {
        var pattern = $"%{searchTerm.Trim().ToUpperInvariant()}%";
        return ReadList("""
            SELECT ID_EQUIPO, CODIGO_INVENTARIO, NO_SERIE, MARCA, MODELO, NOMBRE_TIPO
            FROM (
                SELECT d.ID_EQUIPO, d.CODIGO_INVENTARIO, d.NO_SERIE, d.MARCA, d.MODELO,
                       t.TIPO_DISPOSITIVO || CASE WHEN d.COMPONENTE IS NOT NULL THEN ' · ' || d.COMPONENTE END AS NOMBRE_TIPO,
                       ROW_NUMBER() OVER (ORDER BY d.CODIGO_INVENTARIO) AS ROW_NUM
                FROM DISPOSITIVOS d
                LEFT JOIN TIPOS_DISPOSITIVOS t ON t.ID_TIPO = d.ID_TIPO
                WHERE UPPER(d.CODIGO_INVENTARIO) LIKE :searchCode
                   OR UPPER(d.NO_SERIE) LIKE :searchSerial
                   OR UPPER(d.MARCA) LIKE :searchBrand
                   OR UPPER(d.MODELO) LIKE :searchModel
            )
            WHERE ROW_NUM <= 25
            ORDER BY ROW_NUM
            """, reader => new DeviceOptionDto(
                ReadInt(reader, "ID_EQUIPO"),
                ReadString(reader, "CODIGO_INVENTARIO"),
                ReadString(reader, "NO_SERIE"),
                ReadString(reader, "MARCA"),
                ReadString(reader, "MODELO"),
                ReadNullableString(reader, "NOMBRE_TIPO")),
            cancellationToken,
            ("searchCode", pattern), ("searchSerial", pattern),
            ("searchBrand", pattern), ("searchModel", pattern));
    }

    public Task CreateDevice(CreateDeviceDto device, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var assignment = await ResolveAssignment(connection, transaction, device, cancellationToken);
            var idEquipo = await NextId(connection, transaction, "DISPOSITIVOS", "ID_EQUIPO", cancellationToken);
            await EnsureInventoryCodesAreNew(connection, transaction, [device.CodigoInventario], cancellationToken);
            if (!string.IsNullOrWhiteSpace(device.NumeroIngreso))
            {
                await EnsureIngresoNumberIsNew(connection, transaction, device.IdTipo, device.NumeroIngreso.Trim(), cancellationToken);
            }

            await Execute(connection, transaction, """
                INSERT INTO DISPOSITIVOS
                    (ID_EQUIPO, CODIGO_INVENTARIO, NO_SERIE, MARCA, MODELO, ID_TIPO,
                     ESTADO, NUMERO_PAGO_ASIGNADO, NOMBRE_ASIGNADO, ID_AREA, NUMERO_INGRESO)
                VALUES
                    (:idEquipo, :codigo, :serie, :marca, :modelo,
                     :tipo, :estado, :pago, :nombre, :area, :numeroIngreso)
                """, cancellationToken,
                ("idEquipo", idEquipo),
                ("codigo", device.CodigoInventario), ("serie", device.NoSerie),
                ("marca", device.Marca), ("modelo", device.Modelo), ("tipo", device.IdTipo),
                ("estado", assignment.Estado), ("pago", assignment.NumeroPago), ("nombre", assignment.NombreAsignado),
                ("area", assignment.IsAvailable ? null : device.IdArea),
                ("numeroIngreso", string.IsNullOrWhiteSpace(device.NumeroIngreso) ? null : device.NumeroIngreso.Trim()));

            if (!assignment.IsAvailable)
            {
                await InsertInitialAssignment(connection, transaction, idEquipo,
                    assignment.NumeroPago, assignment.NombreAsignado, cancellationToken);
            }
        }, cancellationToken);

    public Task CreateDesktopCombo(CreateDesktopComboDto combo, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var isAvailable = string.Equals(combo.Estado, "DISPONIBLE", StringComparison.OrdinalIgnoreCase);
            var estado = isAvailable ? "DISPONIBLE" : "ASIGNADO";
            var numeroPago = isAvailable || string.IsNullOrWhiteSpace(combo.NumeroPagoAsignado)
                ? null
                : combo.NumeroPagoAsignado.Trim();
            var nombreAsignado = isAvailable || string.IsNullOrWhiteSpace(combo.NombreAsignado)
                ? null
                : combo.NombreAsignado.Trim();

            if (!isAvailable)
            {
                (numeroPago, nombreAsignado) = await EnsureEmployeeExistsAndResolvePayment(
                    connection, transaction, numeroPago, nombreAsignado, combo.IdArea, cancellationToken);
            }

            // El bloqueo de DISPOSITIVOS también evita que dos solicitudes creen el mismo NCombo a la vez.
            var nextId = await NextId(connection, transaction, "DISPOSITIVOS", "ID_EQUIPO", cancellationToken);
            if (await Exists(connection, transaction, """
                SELECT 1
                FROM DISPOSITIVOS
                WHERE UPPER(TRIM(NCOMBO)) = UPPER(TRIM(:ncombo))
                """, cancellationToken, ("ncombo", combo.NCombo.Trim())))
            {
                throw new InvalidOperationException("Ya existe un combo con ese número NCombo.");
            }
            await EnsureInventoryCodesAreNew(connection, transaction,
                combo.Componentes.Select(component => component.CodigoInventario), cancellationToken);

            foreach (var component in combo.Componentes)
            {
                var idEquipo = nextId++;
                await Execute(connection, transaction, """
                    INSERT INTO DISPOSITIVOS
                        (ID_EQUIPO, CODIGO_INVENTARIO, NO_SERIE, MARCA, MODELO, ID_TIPO,
                         ESTADO, NUMERO_PAGO_ASIGNADO, NOMBRE_ASIGNADO, ID_AREA, NCOMBO, COMPONENTE, NUMERO_INGRESO)
                    VALUES
                        (:idEquipo, :codigo, :serie, :marca, :modelo,
                         :tipo, :estado, :pago, :nombre, :area, :ncombo, :componente, :ncombo)
                    """, cancellationToken,
                    ("idEquipo", idEquipo),
                    ("codigo", component.CodigoInventario.Trim()),
                    ("serie", component.NoSerie.Trim()),
                    ("marca", component.Marca.Trim()),
                    ("modelo", component.Modelo.Trim()),
                    ("tipo", combo.IdTipo),
                    ("estado", estado),
                    ("pago", numeroPago),
                    ("nombre", nombreAsignado),
                    ("area", isAvailable ? null : combo.IdArea),
                    ("ncombo", combo.NCombo.Trim()),
                    ("componente", component.Componente.Trim().ToUpperInvariant()));

                if (!isAvailable)
                {
                    await InsertInitialAssignment(connection, transaction, idEquipo,
                        numeroPago, nombreAsignado, cancellationToken);
                }
            }
        }, cancellationToken);

    // applyToCombo: si el equipo es pieza de un combo, la asignación se aplica a las tres piezas.
    // Si no, solo cambia este equipo y, cuando su asignación cambia, el combo se separa en
    // dispositivos individuales (cada pieza conserva su propia asignación).
    public Task<bool> UpdateDevice(int idEquipo, CreateDeviceDto device, bool applyToCombo, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var assignment = await ResolveAssignment(connection, transaction, device, cancellationToken);
            var newArea = assignment.IsAvailable ? null : device.IdArea;

            var comboNumber = await GetScalar<string?>(connection, transaction,
                "SELECT NCOMBO FROM DISPOSITIVOS WHERE ID_EQUIPO = :idEquipo", cancellationToken,
                ("idEquipo", idEquipo));
            var isComboPart = !string.IsNullOrWhiteSpace(comboNumber);
            var wholeCombo = isComboPart && applyToCombo;

            // Registra en el historial cada equipo (o cada componente del combo) cuya asignación cambia.
            var previousAssignments = await ReadPreviousAssignments(
                connection, transaction, idEquipo, wholeCombo ? comboNumber : null, cancellationToken);
            var current = previousAssignments.FirstOrDefault(previous => previous.IdEquipo == idEquipo);
            foreach (var previous in previousAssignments)
            {
                var wasAssigned = string.Equals(previous.Estado, "ASIGNADO", StringComparison.OrdinalIgnoreCase);
                if (!assignment.IsAvailable
                    && (!wasAssigned
                        || previous.Pago != assignment.NumeroPago
                        || previous.Nombre != assignment.NombreAsignado))
                {
                    await Execute(connection, transaction, """
                        INSERT INTO REASIGNACIONES
                            (ID_EQUIPO, NO_PAGO_ANTERIOR, NOMBRE_ANTERIOR, NO_PAGO_NUEVO, NOMBRE_NUEVO, FECHA_CAMBIO, MOTIVO)
                        VALUES
                            (:idEquipo, :pagoAnterior, :nombreAnterior, :pagoNuevo, :nombreNuevo, SYSDATE, :motivo)
                        """, cancellationToken,
                        ("idEquipo", previous.IdEquipo),
                        ("pagoAnterior", previous.Pago),
                        ("nombreAnterior", previous.Nombre),
                        ("pagoNuevo", assignment.NumeroPago),
                        ("nombreNuevo", assignment.NombreAsignado),
                        ("motivo", wasAssigned ? "CAMBIO DE ASIGNACIÓN" : "ASIGNACIÓN INICIAL"));
                }
            }

            var updated = await Execute(connection, transaction, """
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
                ("estado", assignment.Estado), ("pago", assignment.NumeroPago), ("nombre", assignment.NombreAsignado),
                ("area", newArea),
                ("idEquipo", idEquipo));

            if (wholeCombo)
            {
                // Las tres piezas del combo comparten estado, responsable y ubicación.
                await Execute(connection, transaction, """
                    UPDATE DISPOSITIVOS
                    SET ESTADO = :estado,
                        NUMERO_PAGO_ASIGNADO = :pago,
                        NOMBRE_ASIGNADO = :nombre,
                        ID_AREA = :area
                    WHERE NCOMBO = :ncombo
                    """, cancellationToken,
                    ("estado", assignment.Estado), ("pago", assignment.NumeroPago), ("nombre", assignment.NombreAsignado),
                    ("area", newArea), ("ncombo", comboNumber));
            }
            else if (isComboPart && current != default && AssignmentChanged(current, assignment, newArea))
            {
                await SplitCombo(connection, transaction, comboNumber!, cancellationToken);
            }

            return updated > 0;
        }, cancellationToken);

    private static bool AssignmentChanged(
        (int IdEquipo, string? Estado, string? Pago, string? Nombre, int? IdArea) previous,
        (bool IsAvailable, string Estado, string? NumeroPago, string? NombreAsignado) assignment,
        int? newArea)
    {
        static string Clean(string? value) => value?.Trim() ?? string.Empty;
        return !Clean(previous.Estado).Equals(Clean(assignment.Estado), StringComparison.OrdinalIgnoreCase)
            || Clean(previous.Pago) != Clean(assignment.NumeroPago)
            || !Clean(previous.Nombre).Equals(Clean(assignment.NombreAsignado), StringComparison.OrdinalIgnoreCase)
            || previous.IdArea != newArea;
    }

    // Disuelve un combo: sus piezas pasan a ser dispositivos individuales del tipo de su
    // componente (CPU, Teclado, Monitor) y conservan su número de ingreso y su asignación.
    private static Task<int> SplitCombo(
        DbConnection connection,
        DbTransaction transaction,
        string comboNumber,
        CancellationToken cancellationToken) =>
        Execute(connection, transaction, """
            UPDATE DISPOSITIVOS d
            SET ID_TIPO = COALESCE(
                    (SELECT MIN(t.ID_TIPO)
                     FROM TIPOS_DISPOSITIVOS t
                     WHERE UPPER(TRIM(t.TIPO_DISPOSITIVO)) = UPPER(TRIM(d.COMPONENTE))),
                    d.ID_TIPO),
                NCOMBO = NULL,
                COMPONENTE = NULL
            WHERE d.NCOMBO = :ncombo
            """, cancellationToken, ("ncombo", comboNumber));

    public Task<bool> UpdateDeviceByIdentifier(
        string? codigoInventario,
        string? noSerie,
        CreateDeviceDto device,
        CancellationToken cancellationToken)
    {
        var identifier = !string.IsNullOrWhiteSpace(codigoInventario) ? codigoInventario.Trim() : noSerie?.Trim();
        var identifierColumn = !string.IsNullOrWhiteSpace(codigoInventario) ? "CODIGO_INVENTARIO" : "NO_SERIE";
        if (string.IsNullOrWhiteSpace(identifier))
        {
            throw new ArgumentException("Debe indicar el código de inventario o el número de serie.");
        }

        return InTransaction(async (connection, transaction) =>
        {
            var assignment = await ResolveAssignment(connection, transaction, device, cancellationToken);
            var updated = await Execute(connection, transaction, $"""
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
                ("estado", assignment.Estado), ("pago", assignment.NumeroPago), ("nombre", assignment.NombreAsignado),
                ("area", assignment.IsAvailable ? null : device.IdArea),
                ("identifier", identifier));
            return updated > 0;
        }, cancellationToken);
    }

    public Task<bool> DeleteDevice(int idEquipo, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            await Execute(connection, transaction,
                "DELETE FROM REASIGNACIONES WHERE ID_EQUIPO = :idEquipo",
                cancellationToken, ("idEquipo", idEquipo));
            await Execute(connection, transaction,
                "DELETE FROM REPARACION WHERE ID_EQUIPO = :idEquipo",
                cancellationToken, ("idEquipo", idEquipo));
            var deleted = await Execute(connection, transaction,
                "DELETE FROM DISPOSITIVOS WHERE ID_EQUIPO = :idEquipo",
                cancellationToken, ("idEquipo", idEquipo));
            return deleted > 0;
        }, cancellationToken);

    // Normaliza estado y responsable del formulario: un equipo DISPONIBLE no conserva
    // responsable; uno asignado completa pago/nombre y registra al empleado si no existe.
    private static async Task<(bool IsAvailable, string Estado, string? NumeroPago, string? NombreAsignado)> ResolveAssignment(
        DbConnection connection,
        DbTransaction transaction,
        CreateDeviceDto device,
        CancellationToken cancellationToken)
    {
        var isAvailable = string.Equals(device.Estado, "DISPONIBLE", StringComparison.OrdinalIgnoreCase);
        var estado = isAvailable ? "DISPONIBLE" : device.Estado;
        var numeroPago = isAvailable || string.IsNullOrWhiteSpace(device.NumeroPagoAsignado) ? null : device.NumeroPagoAsignado.Trim();
        var nombreAsignado = isAvailable || string.IsNullOrWhiteSpace(device.NombreAsignado) ? null : device.NombreAsignado.Trim();

        if (!isAvailable && (!string.IsNullOrWhiteSpace(numeroPago) || !string.IsNullOrWhiteSpace(nombreAsignado)))
        {
            (numeroPago, nombreAsignado) = await EnsureEmployeeExistsAndResolvePayment(
                connection, transaction, numeroPago, nombreAsignado, device.IdArea, cancellationToken);
        }

        return (isAvailable, estado, numeroPago, nombreAsignado);
    }

    // Un código de inventario identifica un solo equipo (la recepción del taller lo busca por código).
    // Se llama con DISPOSITIVOS bloqueada para que dos altas simultáneas no lo dupliquen.
    private static async Task EnsureInventoryCodesAreNew(
        DbConnection connection,
        DbTransaction transaction,
        IEnumerable<string> inventoryCodes,
        CancellationToken cancellationToken)
    {
        foreach (var code in inventoryCodes.Select(code => code.Trim()))
        {
            if (await Exists(connection, transaction, """
                SELECT 1
                FROM DISPOSITIVOS
                WHERE UPPER(TRIM(CODIGO_INVENTARIO)) = UPPER(:codigo)
                """, cancellationToken, ("codigo", code)))
            {
                throw new InvalidOperationException($"El inventario {code} ya está registrado.");
            }
        }
    }

    // Cada tipo lleva su propia numeración de ingreso (Escáner 00001-01-2026, Laptop 00001-01-2026...),
    // por eso el número solo se repite entre tipos distintos. Se llama con DISPOSITIVOS bloqueada.
    private static async Task EnsureIngresoNumberIsNew(
        DbConnection connection,
        DbTransaction transaction,
        int? idTipo,
        string numeroIngreso,
        CancellationToken cancellationToken)
    {
        var existingType = await GetScalar<string?>(connection, transaction, """
            SELECT COALESCE(MAX(t.TIPO_DISPOSITIVO), 'este tipo')
            FROM DISPOSITIVOS d
            LEFT JOIN TIPOS_DISPOSITIVOS t ON t.ID_TIPO = d.ID_TIPO
            WHERE d.ID_TIPO = :tipo
              AND d.NUMERO_INGRESO = :numeroIngreso
            HAVING COUNT(*) > 0
            """, cancellationToken, ("tipo", idTipo), ("numeroIngreso", numeroIngreso));
        if (existingType is not null)
        {
            throw new InvalidOperationException(
                $"Ya existe un equipo de tipo {existingType} con el número de ingreso {numeroIngreso}.");
        }
    }

    private static Task<int> InsertInitialAssignment(
        DbConnection connection,
        DbTransaction transaction,
        int idEquipo,
        string? numeroPago,
        string? nombreAsignado,
        CancellationToken cancellationToken) =>
        Execute(connection, transaction, """
            INSERT INTO REASIGNACIONES
                (ID_EQUIPO, NO_PAGO_ANTERIOR, NOMBRE_ANTERIOR, NO_PAGO_NUEVO, NOMBRE_NUEVO, FECHA_CAMBIO, MOTIVO)
            VALUES
                (:idEquipo, NULL, NULL, :pago, :nombre, SYSDATE, 'ASIGNACIÓN INICIAL')
            """, cancellationToken,
            ("idEquipo", idEquipo), ("pago", numeroPago), ("nombre", nombreAsignado));

    private static async Task<List<(int IdEquipo, string? Estado, string? Pago, string? Nombre, int? IdArea)>> ReadPreviousAssignments(
        DbConnection connection,
        DbTransaction transaction,
        int idEquipo,
        string? comboNumber,
        CancellationToken cancellationToken)
    {
        const string columns = "ID_EQUIPO, ESTADO, NUMERO_PAGO_ASIGNADO, NOMBRE_ASIGNADO, ID_AREA";
        var sql = string.IsNullOrWhiteSpace(comboNumber)
            ? $"SELECT {columns} FROM DISPOSITIVOS WHERE ID_EQUIPO = :idEquipo"
            : $"SELECT {columns} FROM DISPOSITIVOS WHERE NCOMBO = :ncombo";
        var parameters = string.IsNullOrWhiteSpace(comboNumber)
            ? new (string Name, object? Value)[] { ("idEquipo", idEquipo) }
            : [("ncombo", comboNumber)];

        var result = new List<(int IdEquipo, string? Estado, string? Pago, string? Nombre, int? IdArea)>();
        await using var command = CreateCommand(connection, transaction, sql, parameters);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add((
                ReadInt(reader, "ID_EQUIPO"),
                ReadNullableString(reader, "ESTADO"),
                ReadNullableString(reader, "NUMERO_PAGO_ASIGNADO"),
                ReadNullableString(reader, "NOMBRE_ASIGNADO"),
                ReadNullableInt(reader, "ID_AREA")));
        }
        return result;
    }

    private static DeviceDto ReadDevice(DbDataReader reader) => new(
        ReadInt(reader, "ID_EQUIPO"),
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
        ReadNullableDate(reader, "FECHA_ASIGNACION"),
        ReadNullableString(reader, "NOMBRE_ASIGNADO"),
        ReadNullableInt(reader, "ID_EDIFICIO"),
        ReadNullableString(reader, "NOMBRE_EDIFICIO"),
        ReadNullableInt(reader, "ID_REGIONAL"),
        ReadNullableString(reader, "NOMBRE_REGIONAL"),
        ReadNullableString(reader, "NCOMBO"),
        ReadNullableString(reader, "COMPONENTE"),
        ReadNullableString(reader, "NUMERO_INGRESO"));
}
