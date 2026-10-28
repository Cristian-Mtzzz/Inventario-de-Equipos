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

    // La reparación guarda sus propios datos del equipo (los que se capturaron al
    // ingresarlo), por eso la tabla del taller no consulta DISPOSITIVOS: un ingreso por
    // recepción no tiene equipo en inventario y debe verse solo aquí.
    // Con idTecnico devuelve solo las reparaciones asignadas a ese técnico.
    public Task<IReadOnlyList<MaintenanceDto>> GetMaintenances(int? idTecnico, CancellationToken cancellationToken) =>
        ReadList($"""
            SELECT r.ID_REPARACION, r.ID_EQUIPO, r.CODIGO_INVENTARIO, r.NO_SERIE,
                   r.MARCA, r.MODELO, r.ID_TECNICO, r.TIPO_DISPOSITIVO, r.DICTAMEN,
                   r.TIPO_REPARACION, r.DETALLE_REPARACION,
                   r.FECHA_INGRESO, r.FECHA_SALIDA, r.MEMO_NUMERO,
                   r.RECIBE, r.TECNICO, r.DEPARTAMENTO, r.DESCRIPCION_EQUIPO,
                   r.EQUIPO_EN_GARANTIA, r.PIEZAS_SUSTITUIDAS,
                   r.OBSERVACIONES, r.EQUIPO_FUNCIONAL, r.TECNICO_ENTREGA,
                   r.CLIENTE_RECIBE, r.FECHA_ENTREGA
            FROM REPARACION r
            {(idTecnico is null ? string.Empty : "WHERE r.ID_TECNICO = :idTecnico")}
            ORDER BY r.FECHA_INGRESO DESC
            """, ReadMaintenance, cancellationToken,
            idTecnico is null ? [] : [("idTecnico", idTecnico)]);

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
            || reception.IdEdificio <= 0)
        {
            throw new InvalidOperationException("Completa todos los campos obligatorios del formato de recepción.");
        }

        var receiver = await GetUserDisplayName(userId, cancellationToken);
        var technician = await GetReceptionTechnician(cancellationToken);

        await InTransaction(async (connection, transaction) =>
        {
            // La recepción es solo un control de ingreso: no crea ni modifica el equipo en
            // DISPOSITIVOS (muchas veces ya está ahí), así que los datos capturados se
            // guardan en la propia reparación y ID_EQUIPO queda vacío.
            var departamento = reception.IdArea > 0
                ? await GetDepartmentName(connection, transaction, reception.IdEdificio, reception.IdArea, cancellationToken)
                : string.IsNullOrWhiteSpace(reception.Departamento) ? "-" : reception.Departamento.Trim();

            var fechaIngreso = reception.FechaIngreso == default ? DateTime.Now : reception.FechaIngreso;
            var idReparacion = await NextId(connection, transaction, "REPARACION", "ID_REPARACION", cancellationToken);
            await Execute(connection, transaction, """
                INSERT INTO REPARACION
                    (ID_REPARACION, ID_EQUIPO, ID_TECNICO, FECHA_INGRESO,
                     DICTAMEN, TIPO_REPARACION, DETALLE_REPARACION, MEMO_NUMERO,
                     RECIBE, TECNICO, DEPARTAMENTO,
                     DESCRIPCION_EQUIPO, EQUIPO_EN_GARANTIA,
                     CODIGO_INVENTARIO, NO_SERIE, MARCA, MODELO, TIPO_DISPOSITIVO)
                VALUES
                    (:idReparacion, NULL, :idTecnico,
                     :fechaIngreso, :dictamen, :tipoReparacion, 'PENDIENTE', :memoNumero,
                     :recibe, :tecnico, :departamento,
                     :descripcionEquipo, :equipoEnGarantia,
                     :codigo, :noSerie, :marca, :modelo, :tipoDispositivo)
                """, cancellationToken,
                ("idReparacion", idReparacion),
                ("idTecnico", technician?.IdUsuario ?? 0), ("fechaIngreso", fechaIngreso),
                ("dictamen", "PENDIENTE"), ("tipoReparacion", reception.TipoDispositivo.Trim()),
                ("memoNumero", reception.MemoNumero?.Trim()),
                ("recibe", receiver),
                ("tecnico", ReceptionTechnicianName(technician)), ("departamento", departamento),
                ("descripcionEquipo", reception.DescripcionEquipo.Trim()),
                ("equipoEnGarantia", string.IsNullOrWhiteSpace(reception.EquipoEnGarantia) ? null : reception.EquipoEnGarantia.Trim().ToUpperInvariant()),
                ("codigo", reception.CodigoInventario.Trim()), ("noSerie", reception.NoSerie.Trim()),
                ("marca", reception.Marca.Trim()), ("modelo", reception.Modelo.Trim()),
                ("tipoDispositivo", reception.TipoDispositivo.Trim()));
        }, cancellationToken);
    }

    public Task CreateMaintenance(int idTecnico, CreateMaintenanceEntryDto maintenance, CancellationToken cancellationToken) =>
        // Abre una reparación y deja el detalle inicial como pendiente. Copia los datos del
        // equipo elegido para que la tabla del taller los muestre sin consultar DISPOSITIVOS.
        InTransaction(async (connection, transaction) =>
        {
            var idReparacion = await NextId(connection, transaction, "REPARACION", "ID_REPARACION", cancellationToken);
            var inserted = await Execute(connection, transaction, """
                INSERT INTO REPARACION
                    (ID_REPARACION, ID_EQUIPO, ID_TECNICO, FECHA_INGRESO,
                     DICTAMEN, TIPO_REPARACION, DETALLE_REPARACION,
                     CODIGO_INVENTARIO, NO_SERIE, MARCA, MODELO, TIPO_DISPOSITIVO)
                SELECT :idReparacion, d.ID_EQUIPO, :idTecnico,
                       :fechaIngreso, :dictamen, :tipoReparacion, 'PENDIENTE',
                       d.CODIGO_INVENTARIO, d.NO_SERIE, d.MARCA, d.MODELO, t.TIPO_DISPOSITIVO
                FROM DISPOSITIVOS d
                LEFT JOIN TIPOS_DISPOSITIVOS t ON t.ID_TIPO = d.ID_TIPO
                WHERE d.ID_EQUIPO = :idEquipo
                """, cancellationToken,
                ("idReparacion", idReparacion),
                ("idTecnico", idTecnico),
                ("fechaIngreso", maintenance.FechaIngreso),
                ("dictamen", string.IsNullOrWhiteSpace(maintenance.Dictamen) ? "PENDIENTE" : maintenance.Dictamen.Trim()),
                ("tipoReparacion", maintenance.TipoReparacion),
                ("idEquipo", maintenance.IdEquipo));

            // Sin equipo que copiar no se insertó nada; avisar en lugar de responder como si sí.
            if (inserted == 0) throw new ArgumentException("El equipo seleccionado no existe.");
        }, cancellationToken);

    public async Task<bool> UpdateMaintenanceAssessment(
        int idMantenimiento,
        UpdateMaintenanceAssessmentDto assessment,
        int? idTecnico,
        CancellationToken cancellationToken)
    {
        var parameters = new List<(string Name, object? Value)>
        {
            ("dictamen", assessment.Dictamen?.Trim()),
            ("piezasSustituidas", assessment.PiezasSustituidas?.Trim()),
            ("observaciones", assessment.Observaciones?.Trim()),
            ("equipoEnGarantia", string.IsNullOrWhiteSpace(assessment.EquipoEnGarantia) ? null : assessment.EquipoEnGarantia.Trim().ToUpperInvariant()),
            ("idReparacion", idMantenimiento),
        };
        // Oracle rechaza parámetros que no aparecen en el SQL: el del técnico solo se agrega si se filtra por él.
        if (idTecnico is not null) parameters.Add(("idTecnico", idTecnico));

        return await Execute($"""
            UPDATE REPARACION
            SET DICTAMEN = :dictamen,
                PIEZAS_SUSTITUIDAS = :piezasSustituidas,
                OBSERVACIONES = :observaciones,
                EQUIPO_EN_GARANTIA = COALESCE(:equipoEnGarantia, EQUIPO_EN_GARANTIA)
            WHERE ID_REPARACION = :idReparacion
            {(idTecnico is null ? string.Empty : "AND ID_TECNICO = :idTecnico")}
            """, cancellationToken, parameters.ToArray()) > 0;
    }

    public async Task<bool> RegisterMaintenanceExit(
        int idMantenimiento,
        UpdateMaintenanceExitDto exit,
        CancellationToken cancellationToken) =>
        await Execute("""
            UPDATE REPARACION
            SET EQUIPO_FUNCIONAL = :equipoFuncional,
                TECNICO_ENTREGA = COALESCE(NULLIF(TRIM(TECNICO), ''), TECNICO_ENTREGA),
                CLIENTE_RECIBE = :clienteRecibe,
                FECHA_ENTREGA = :fechaEntrega,
                FECHA_SALIDA = :fechaEntrega
            WHERE ID_REPARACION = :idReparacion
            """, cancellationToken,
            ("equipoFuncional", exit.EquipoFuncional.Trim().ToUpperInvariant()),
            ("clienteRecibe", exit.ClienteRecibe.Trim()),
            ("fechaEntrega", exit.FechaEntrega), ("idReparacion", idMantenimiento)) > 0;

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
    // y su ID de usuario. Como quien entrega el equipo en la salida es el mismo técnico asignado, también
    // actualiza TECNICO_ENTREGA. El controlador ya validó que el usuario es un técnico activo.
    public async Task<bool> AssignTechnician(int idMantenimiento, int idUsuario, CancellationToken cancellationToken) =>
        await Execute("""
            UPDATE REPARACION
            SET TECNICO = (SELECT SUBSTR(NVL(TRIM(u.NOMBRE_PERSONA), u.USUARIO), 1, 200)
                           FROM USUARIOS u WHERE u.ID_USUARIO = :idUsuario),
                TECNICO_ENTREGA = (SELECT SUBSTR(NVL(TRIM(u.NOMBRE_PERSONA), u.USUARIO), 1, 200)
                                   FROM USUARIOS u WHERE u.ID_USUARIO = :idUsuarioEntrega),
                ID_TECNICO = :idUsuario
            WHERE ID_REPARACION = :idReparacion
            """, cancellationToken, ("idUsuario", idUsuario), ("idUsuarioEntrega", idUsuario), ("idReparacion", idMantenimiento)) > 0;

    // Valores que el formulario de recepción muestra bloqueados: quién recibe y el técnico asignado.
    public async Task<ReceptionDefaultsDto> GetReceptionDefaults(int userId, CancellationToken cancellationToken) =>
        new(await GetUserDisplayName(userId, cancellationToken),
            ReceptionTechnicianName(await GetReceptionTechnician(cancellationToken)));

    // Nombre que se guarda como técnico de la recepción. Si el usuario configurado en
    // Taller:TecnicoRecepcion no está en USUARIOS (o perdió el rol), se usa el nombre de
    // Taller:NombreTecnicoRecepcion: siempre es el mismo técnico quien recibe, y el
    // formulario ya no muestra el dato para corregirlo.
    private string ReceptionTechnicianName(WorkshopTechnicianDto? technician)
    {
        if (technician is not null) return technician.Nombre;
        var configured = configuration["Taller:NombreTecnicoRecepcion"]?.Trim();
        return string.IsNullOrWhiteSpace(configured) ? "Sin asignar" : configured;
    }

    private async Task<string> GetUserDisplayName(int userId, CancellationToken cancellationToken)
    {
        var names = await ReadList("""
            SELECT SUBSTR(NVL(TRIM(NOMBRE_PERSONA), USUARIO), 1, 200) NOMBRE
            FROM USUARIOS
            WHERE ID_USUARIO = :idUsuario
            """, reader => ReadString(reader, "NOMBRE"), cancellationToken, ("idUsuario", userId));
        return names.FirstOrDefault() ?? "-";
    }

    // Técnico que recibe por defecto todos los ingresos, indicado en Taller:TecnicoRecepcion (appsettings.json).
    // Se acepta el login (columna USUARIO) o el nombre de la persona (NOMBRE_PERSONA), sin distinguir
    // mayúsculas ni espacios, siempre que el usuario siga activo, vigente y con rol TecnicoTaller.
    private async Task<WorkshopTechnicianDto?> GetReceptionTechnician(CancellationToken cancellationToken)
    {
        var technicianName = configuration["Taller:TecnicoRecepcion"];
        if (string.IsNullOrWhiteSpace(technicianName)) return null;

        var technicians = await ReadList("""
            SELECT ID_USUARIO, SUBSTR(NVL(TRIM(NOMBRE_PERSONA), USUARIO), 1, 200) NOMBRE
            FROM USUARIOS
            WHERE (LOWER(TRIM(USUARIO)) = LOWER(TRIM(:tecnico)) OR LOWER(TRIM(NOMBRE_PERSONA)) = LOWER(TRIM(:tecnicoNombre)))
              AND ROL = 'TecnicoTaller'
              AND UPPER(ESTADO) = 'ACTIVO'
              AND (FECHA_EXPIRACION IS NULL OR FECHA_EXPIRACION >= TRUNC(SYSDATE))
            """, reader => new WorkshopTechnicianDto(
            ReadInt(reader, "ID_USUARIO"),
            ReadString(reader, "NOMBRE")), cancellationToken, ("tecnico", technicianName), ("tecnicoNombre", technicianName));
        return technicians.FirstOrDefault();
    }

    // Nombre del departamento de origen que se guarda en la reparación. Valida que el
    // área pertenezca al edificio elegido para no registrar un origen inexistente.
    private static async Task<string> GetDepartmentName(
        DbConnection connection,
        DbTransaction? transaction,
        int idEdificio,
        int idArea,
        CancellationToken cancellationToken)
    {
        var name = await GetScalar<string?>(connection, transaction, """
            SELECT DEPARTAMENTO_IHSS_DESC
            FROM DEPARTAMENTO_IHSS
            WHERE DEPARTAMENTO_IHSS_ID = :idArea
              AND EDIFICIO_ID = :idEdificio
            """, cancellationToken, ("idArea", idArea), ("idEdificio", idEdificio));

        return string.IsNullOrWhiteSpace(name)
            ? throw new InvalidOperationException("El departamento no pertenece al edificio seleccionado.")
            : name.Trim();
    }

    private static MaintenanceDto ReadMaintenance(DbDataReader reader) => new(
        ReadInt(reader, "ID_REPARACION"),
        ReadNullableInt(reader, "ID_EQUIPO"),
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
