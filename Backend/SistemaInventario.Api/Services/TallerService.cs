using System.Data.Common;
using SistemaInventario.Api.Data;
using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Capa de persistencia del taller. Coordina recepción, reparaciones, historial y
// transacciones que deben guardarse completas o revertirse juntas.
public sealed class TallerService(InventoryDbContext dbContext, IConfiguration configuration) : OracleRepository(dbContext), ITallerService
{
    public Task<IReadOnlyList<WorkshopDeviceDto>> GetDevices(CancellationToken cancellationToken) =>
        ReadList("""
            SELECT ID_EQUIPO, CODIGO_INVENTARIO, NO_SERIE, MARCA, MODELO
            FROM DISPOSITIVOS
            ORDER BY CODIGO_INVENTARIO
            """, reader => new WorkshopDeviceDto(
            ReadInt(reader, "ID_EQUIPO"),
            ReadString(reader, "CODIGO_INVENTARIO"),
            ReadString(reader, "NO_SERIE"),
            ReadString(reader, "MARCA"),
            ReadString(reader, "MODELO")), cancellationToken);

    public Task<IReadOnlyList<MaintenanceDto>> GetMaintenances(CancellationToken cancellationToken) =>
        ReadList("""
            SELECT r.ID_REPARACION, r.ID_EQUIPO, d.CODIGO_INVENTARIO, d.NO_SERIE,
                   d.MARCA, d.MODELO, r.ID_TECNICO, td.TIPO_DISPOSITIVO, r.DICTAMEN,
                   r.TIPO_REPARACION, r.DETALLE_REPARACION,
                   r.FECHA_INGRESO, r.FECHA_SALIDA, r.MEMO_NUMERO,
                   r.RECIBE, r.TECNICO, r.DEPARTAMENTO, r.DESCRIPCION_EQUIPO,
                   r.EQUIPO_EN_GARANTIA, r.PIEZAS_SUSTITUIDAS,
                   r.OBSERVACIONES, r.EQUIPO_FUNCIONAL, r.TECNICO_ENTREGA,
                   r.CLIENTE_RECIBE, r.FECHA_ENTREGA
            FROM REPARACION r
            INNER JOIN DISPOSITIVOS d ON d.ID_EQUIPO = r.ID_EQUIPO
            LEFT JOIN TIPOS_DISPOSITIVOS td ON td.ID_TIPO = d.ID_TIPO
            ORDER BY r.FECHA_INGRESO DESC
            """, ReadMaintenance, cancellationToken);

    // "Recibe" es el usuario que registra y el técnico es el configurado en Taller:TecnicoRecepcion;
    // ambos los decide el servidor, no el formulario.
    public async Task RegisterReception(CreateReceptionEntryDto reception, int userId, CancellationToken cancellationToken)
    {
        // La recepción crea o reutiliza catálogos y registra el equipo dentro de una transacción.
        if (string.IsNullOrWhiteSpace(reception.CodigoInventario)
            || string.IsNullOrWhiteSpace(reception.NoSerie)
            || string.IsNullOrWhiteSpace(reception.Marca)
            || string.IsNullOrWhiteSpace(reception.Modelo)
            || string.IsNullOrWhiteSpace(reception.TipoDispositivo)
            || string.IsNullOrWhiteSpace(reception.DescripcionEquipo)
            || string.IsNullOrWhiteSpace(reception.EquipoEnGarantia)
            || reception.IdEdificio <= 0)
        {
            throw new InvalidOperationException("Completa todos los campos obligatorios del formato de recepción.");
        }

        var receiver = await GetUserDisplayName(userId, cancellationToken);
        var technician = await GetReceptionTechnician(cancellationToken);

        await InTransaction(async (connection, transaction) =>
        {
            var codigo = reception.CodigoInventario.Trim();
            var tipo = reception.TipoDispositivo.Trim();
            var defaultArea = await GetDefaultAreaForBuilding(connection, transaction, reception.IdEdificio, cancellationToken) ?? 1;
            var areaId = reception.IdArea > 0
                ? await GetAreaForBuilding(connection, transaction, reception.IdEdificio, reception.IdArea, cancellationToken)
                : defaultArea;
            var tipoId = await GetOrCreateDeviceType(connection, transaction, tipo, cancellationToken);
            var idEquipo = await GetDeviceIdByCode(connection, transaction, codigo, cancellationToken);

            if (idEquipo is null)
            {
                idEquipo = await NextId(connection, transaction, "DISPOSITIVOS", "ID_EQUIPO", cancellationToken);
                await Execute(connection, transaction, """
                    INSERT INTO DISPOSITIVOS
                        (ID_EQUIPO, CODIGO_INVENTARIO, NO_SERIE, MARCA, MODELO, ID_TIPO,
                         ESTADO, NUMERO_PAGO_ASIGNADO, NOMBRE_ASIGNADO, ID_AREA)
                    VALUES
                        (:idEquipo, :codigo, :noSerie, :marca, :modelo,
                         :tipo, 'DISPONIBLE', NULL, NULL, :area)
                    """, cancellationToken,
                    ("idEquipo", idEquipo.Value), ("codigo", codigo), ("noSerie", reception.NoSerie.Trim()),
                    ("marca", reception.Marca.Trim()), ("modelo", reception.Modelo.Trim()),
                    ("tipo", tipoId), ("area", areaId));
            }
            else
            {
                await Execute(connection, transaction, """
                    UPDATE DISPOSITIVOS
                    SET ID_TIPO = :tipo,
                        NO_SERIE = :noSerie,
                        MARCA = :marca,
                        MODELO = :modelo,
                        ID_AREA = :area,
                        ESTADO = 'DISPONIBLE'
                    WHERE ID_EQUIPO = :idEquipo
                    """, cancellationToken,
                    ("tipo", tipoId), ("noSerie", reception.NoSerie.Trim()),
                    ("marca", reception.Marca.Trim()), ("modelo", reception.Modelo.Trim()),
                    ("area", areaId), ("idEquipo", idEquipo.Value));
            }

            var fechaIngreso = reception.FechaIngreso == default ? DateTime.Now : reception.FechaIngreso;
            var departamento = string.IsNullOrWhiteSpace(reception.Departamento) ? "-" : reception.Departamento.Trim();
            var idReparacion = await NextId(connection, transaction, "REPARACION", "ID_REPARACION", cancellationToken);
            await Execute(connection, transaction, """
                INSERT INTO REPARACION
                    (ID_REPARACION, ID_EQUIPO, ID_TECNICO, FECHA_INGRESO,
                     DICTAMEN, TIPO_REPARACION, DETALLE_REPARACION, MEMO_NUMERO,
                     RECIBE, TECNICO, DEPARTAMENTO,
                     DESCRIPCION_EQUIPO, EQUIPO_EN_GARANTIA)
                VALUES
                    (:idReparacion, :idEquipo, :idTecnico,
                     :fechaIngreso, :dictamen, :tipoReparacion, 'PENDIENTE', :memoNumero,
                     :recibe, :tecnico, :departamento,
                     :descripcionEquipo, :equipoEnGarantia)
                """, cancellationToken,
                ("idReparacion", idReparacion),
                ("idEquipo", idEquipo.Value), ("idTecnico", technician?.IdUsuario ?? 0), ("fechaIngreso", fechaIngreso),
                ("dictamen", "PENDIENTE"), ("tipoReparacion", tipo),
                ("memoNumero", reception.MemoNumero?.Trim()),
                ("recibe", receiver),
                ("tecnico", technician?.Nombre ?? "Sin asignar"), ("departamento", departamento),
                ("descripcionEquipo", reception.DescripcionEquipo.Trim()),
                ("equipoEnGarantia", reception.EquipoEnGarantia.Trim().ToUpperInvariant()));
        }, cancellationToken);
    }

    public Task CreateMaintenance(int idTecnico, CreateMaintenanceEntryDto maintenance, CancellationToken cancellationToken) =>
        // Abre una reparación y deja el detalle inicial como pendiente.
        InTransaction(async (connection, transaction) =>
        {
            var idReparacion = await NextId(connection, transaction, "REPARACION", "ID_REPARACION", cancellationToken);
            await Execute(connection, transaction, """
                INSERT INTO REPARACION
                    (ID_REPARACION, ID_EQUIPO, ID_TECNICO, FECHA_INGRESO,
                     DICTAMEN, TIPO_REPARACION, DETALLE_REPARACION)
                VALUES
                    (:idReparacion, :idEquipo, :idTecnico,
                     :fechaIngreso, :dictamen, :tipoReparacion, 'PENDIENTE')
                """, cancellationToken,
                ("idReparacion", idReparacion),
                ("idEquipo", maintenance.IdEquipo), ("idTecnico", idTecnico),
                ("fechaIngreso", maintenance.FechaIngreso),
                ("dictamen", string.IsNullOrWhiteSpace(maintenance.Dictamen) ? "PENDIENTE" : maintenance.Dictamen.Trim()),
                ("tipoReparacion", maintenance.TipoReparacion));
        }, cancellationToken);

    public async Task<bool> UpdateMaintenanceAssessment(
        int idMantenimiento,
        UpdateMaintenanceAssessmentDto assessment,
        CancellationToken cancellationToken) =>
        await Execute("""
            UPDATE REPARACION
            SET DICTAMEN = :dictamen,
                PIEZAS_SUSTITUIDAS = :piezasSustituidas,
                OBSERVACIONES = :observaciones
            WHERE ID_REPARACION = :idReparacion
            """, cancellationToken,
            ("dictamen", assessment.Dictamen?.Trim()),
            ("piezasSustituidas", assessment.PiezasSustituidas?.Trim()),
            ("observaciones", assessment.Observaciones?.Trim()),
            ("idReparacion", idMantenimiento)) > 0;

    public async Task<bool> RegisterMaintenanceExit(
        int idMantenimiento,
        UpdateMaintenanceExitDto exit,
        CancellationToken cancellationToken) =>
        await Execute("""
            UPDATE REPARACION
            SET EQUIPO_FUNCIONAL = :equipoFuncional,
                TECNICO_ENTREGA = COALESCE(NULLIF(TRIM(TECNICO), ''), :tecnicoEntrega),
                CLIENTE_RECIBE = :clienteRecibe,
                FECHA_ENTREGA = :fechaEntrega,
                FECHA_SALIDA = :fechaEntrega
            WHERE ID_REPARACION = :idReparacion
            """, cancellationToken,
            ("equipoFuncional", exit.EquipoFuncional.Trim().ToUpperInvariant()),
            ("tecnicoEntrega", exit.TecnicoEntrega.Trim()),
            ("clienteRecibe", exit.ClienteRecibe.Trim()),
            ("fechaEntrega", exit.FechaEntrega), ("idReparacion", idMantenimiento)) > 0;

    public async Task<bool> EditMaintenance(int idMantenimiento, UpdateMaintenanceDto maintenance, CancellationToken cancellationToken) =>
        await Execute("""
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
            ("fechaSalida", maintenance.FechaSalida), ("idReparacion", idMantenimiento)) > 0;

    public async Task<bool> DeleteMaintenance(int idMantenimiento, CancellationToken cancellationToken) =>
        await Execute("""
            DELETE FROM REPARACION
            WHERE ID_REPARACION = :idReparacion
            """, cancellationToken, ("idReparacion", idMantenimiento)) > 0;

    // Usuarios activos y vigentes con rol de técnico; el nombre es el de la persona o, si falta, el usuario.
    public Task<IReadOnlyList<WorkshopTechnicianDto>> GetTechnicians(CancellationToken cancellationToken) =>
        ReadList("""
            SELECT ID_USUARIO, NVL(TRIM(NOMBRE_PERSONA), USUARIO) NOMBRE
            FROM USUARIOS
            WHERE ROL = 'TecnicoTaller'
              AND UPPER(ESTADO) = 'ACTIVO'
              AND (FECHA_EXPIRACION IS NULL OR FECHA_EXPIRACION >= TRUNC(SYSDATE))
            ORDER BY NOMBRE
            """, reader => new WorkshopTechnicianDto(
            ReadInt(reader, "ID_USUARIO"),
            ReadString(reader, "NOMBRE")), cancellationToken);

    // Guarda en la reparación el nombre del técnico (columna TECNICO, la que muestran la tabla y el reporte)
    // y su ID de usuario. El controlador ya validó que el usuario es un técnico activo.
    public async Task<bool> AssignTechnician(int idMantenimiento, int idUsuario, CancellationToken cancellationToken) =>
        await Execute("""
            UPDATE REPARACION
            SET TECNICO = (SELECT SUBSTR(NVL(TRIM(u.NOMBRE_PERSONA), u.USUARIO), 1, 200)
                           FROM USUARIOS u WHERE u.ID_USUARIO = :idUsuario),
                ID_TECNICO = :idUsuario
            WHERE ID_REPARACION = :idReparacion
            """, cancellationToken, ("idUsuario", idUsuario), ("idReparacion", idMantenimiento)) > 0;

    // Valores que el formulario de recepción muestra bloqueados: quién recibe y el técnico asignado.
    public async Task<ReceptionDefaultsDto> GetReceptionDefaults(int userId, CancellationToken cancellationToken) =>
        new(await GetUserDisplayName(userId, cancellationToken),
            (await GetReceptionTechnician(cancellationToken))?.Nombre ?? "Sin asignar");

    private async Task<string> GetUserDisplayName(int userId, CancellationToken cancellationToken)
    {
        var names = await ReadList("""
            SELECT SUBSTR(NVL(TRIM(NOMBRE_PERSONA), USUARIO), 1, 200) NOMBRE
            FROM USUARIOS
            WHERE ID_USUARIO = :idUsuario
            """, reader => ReadString(reader, "NOMBRE"), cancellationToken, ("idUsuario", userId));
        return names.FirstOrDefault() ?? "-";
    }

    // Técnico que recibe por defecto todos los ingresos: el usuario indicado en Taller:TecnicoRecepcion
    // (appsettings.json), siempre que siga activo y con rol de técnico.
    private async Task<WorkshopTechnicianDto?> GetReceptionTechnician(CancellationToken cancellationToken)
    {
        var userName = configuration["Taller:TecnicoRecepcion"];
        if (string.IsNullOrWhiteSpace(userName)) return null;

        var technicians = await ReadList("""
            SELECT ID_USUARIO, SUBSTR(NVL(TRIM(NOMBRE_PERSONA), USUARIO), 1, 200) NOMBRE
            FROM USUARIOS
            WHERE LOWER(TRIM(USUARIO)) = LOWER(TRIM(:usuario))
              AND ROL = 'TecnicoTaller'
              AND UPPER(ESTADO) = 'ACTIVO'
              AND (FECHA_EXPIRACION IS NULL OR FECHA_EXPIRACION >= TRUNC(SYSDATE))
            """, reader => new WorkshopTechnicianDto(
            ReadInt(reader, "ID_USUARIO"),
            ReadString(reader, "NOMBRE")), cancellationToken, ("usuario", userName));
        return technicians.FirstOrDefault();
    }

    private static async Task<int> GetAreaForBuilding(
        DbConnection connection,
        DbTransaction? transaction,
        int idEdificio,
        int idArea,
        CancellationToken cancellationToken)
    {
        var existingId = await GetScalar<int?>(connection, transaction, """
            SELECT DEPARTAMENTO_IHSS_ID
            FROM DEPARTAMENTO_IHSS
            WHERE DEPARTAMENTO_IHSS_ID = :idArea
              AND EDIFICIO_ID = :idEdificio
            """, cancellationToken, ("idArea", idArea), ("idEdificio", idEdificio));

        return existingId is > 0
            ? existingId.Value
            : throw new InvalidOperationException("El departamento no pertenece al edificio seleccionado.");
    }

    private static async Task<int?> GetDefaultAreaForBuilding(
        DbConnection connection,
        DbTransaction? transaction,
        int idEdificio,
        CancellationToken cancellationToken)
    {
        var area = await GetScalar<int?>(connection, transaction, """
            SELECT DEPARTAMENTO_IHSS_ID
            FROM DEPARTAMENTO_IHSS
            WHERE EDIFICIO_ID = :idEdificio
              AND ROWNUM = 1
            """, cancellationToken, ("idEdificio", idEdificio));

        if (area is > 0) return area;

        return await GetScalar<int?>(connection, transaction, """
            SELECT DEPARTAMENTO_IHSS_ID
            FROM DEPARTAMENTO_IHSS
            WHERE ROWNUM = 1
            """, cancellationToken);
    }

    private static async Task<int> GetOrCreateDeviceType(
        DbConnection connection,
        DbTransaction transaction,
        string tipoDispositivo,
        CancellationToken cancellationToken)
    {
        var existingId = await GetScalar<int?>(connection, transaction, """
            SELECT ID_TIPO
            FROM TIPOS_DISPOSITIVOS
            WHERE UPPER(TRIM(TIPO_DISPOSITIVO)) = UPPER(TRIM(:tipoDispositivo))
            """, cancellationToken, ("tipoDispositivo", tipoDispositivo));

        if (existingId is > 0) return existingId.Value;

        var idTipo = await NextId(connection, transaction, "TIPOS_DISPOSITIVOS", "ID_TIPO", cancellationToken);
        await Execute(connection, transaction, """
            INSERT INTO TIPOS_DISPOSITIVOS (ID_TIPO, TIPO_DISPOSITIVO) VALUES (:idTipo, :tipoDispositivo)
            """, cancellationToken, ("idTipo", idTipo), ("tipoDispositivo", tipoDispositivo));
        return idTipo;
    }

    private static Task<int?> GetDeviceIdByCode(
        DbConnection connection,
        DbTransaction? transaction,
        string codigoInventario,
        CancellationToken cancellationToken) =>
        GetScalar<int?>(connection, transaction, """
            SELECT ID_EQUIPO
            FROM DISPOSITIVOS
            WHERE UPPER(TRIM(CODIGO_INVENTARIO)) = UPPER(TRIM(:codigoInventario))
            """, cancellationToken, ("codigoInventario", codigoInventario));

    private static MaintenanceDto ReadMaintenance(DbDataReader reader) => new(
        ReadInt(reader, "ID_REPARACION"),
        ReadInt(reader, "ID_EQUIPO"),
        ReadString(reader, "CODIGO_INVENTARIO"),
        ReadString(reader, "NO_SERIE"),
        ReadString(reader, "MARCA"),
        ReadString(reader, "MODELO"),
        ReadInt(reader, "ID_TECNICO"),
        ReadNullableString(reader, "TIPO_DISPOSITIVO"),
        ReadNullableString(reader, "DICTAMEN"),
        ReadNullableString(reader, "TIPO_REPARACION"),
        ReadNullableString(reader, "DETALLE_REPARACION"),
        reader.GetDateTime(reader.GetOrdinal("FECHA_INGRESO")),
        ReadNullableDate(reader, "FECHA_SALIDA"),
        ReadNullableString(reader, "MEMO_NUMERO"),
        ReadNullableString(reader, "RECIBE"),
        ReadNullableString(reader, "TECNICO"),
        ReadNullableString(reader, "DEPARTAMENTO"),
        ReadNullableString(reader, "DESCRIPCION_EQUIPO"),
        ReadNullableString(reader, "EQUIPO_EN_GARANTIA"),
        ReadNullableString(reader, "PIEZAS_SUSTITUIDAS"),
        ReadNullableString(reader, "OBSERVACIONES"),
        ReadNullableString(reader, "EQUIPO_FUNCIONAL"),
        ReadNullableString(reader, "TECNICO_ENTREGA"),
        ReadNullableString(reader, "CLIENTE_RECIBE"),
        ReadNullableDate(reader, "FECHA_ENTREGA"));
}
