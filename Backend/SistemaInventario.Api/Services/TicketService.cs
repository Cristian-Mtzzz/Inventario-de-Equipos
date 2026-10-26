using Oracle.ManagedDataAccess.Client;
using SistemaInventario.Api.Data;
using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Persistencia del módulo Tickets de soporte. El administrador crea y asigna; el técnico
// cierra el ticket confirmando el No. de pago del empleado que atendió.
public sealed class TicketService(InventoryDbContext dbContext) : OracleRepository(dbContext), ITicketService
{
    public Task<IReadOnlyList<TicketDto>> GetTickets(int? idTecnico, CancellationToken cancellationToken) =>
        // El tiempo que tomó el servicio se calcula aquí para que la tabla y el reporte
        // muestren siempre el mismo número.
        ReadList($"""
            SELECT t.ID_TICKET, t.FECHA_CREACION, t.FECHA_FINALIZACION,
                   CASE WHEN t.FECHA_FINALIZACION IS NULL THEN NULL
                        ELSE ROUND((t.FECHA_FINALIZACION - t.FECHA_CREACION) * 1440)
                   END AS MINUTOS_TRANSCURRIDOS,
                   t.ID_EMPLEADO, e.NOMBRE_EMPLEADO AS EMPLEADO,
                   r.DESCRIPCION AS REGION,
                   b.EDIFICIO_DESCRIPCION AS EDIFICIO,
                   a.DEPARTAMENTO_IHSS_DESC AS DEPARTAMENTO,
                   t.DETALLE, t.ID_TECNICO,
                   NVL(TRIM(u.NOMBRE_PERSONA), u.USUARIO) AS TECNICO,
                   t.ESTADO, t.OBSERVACIONES, t.VALORACION, t.TIPO_SOPORTE
            FROM TICKETS_SOPORTE t
            LEFT JOIN EMPLEADOS_IHSS e ON e.EMPLEADOS_IHSS_ID = t.ID_EMPLEADO
            LEFT JOIN DEPARTAMENTO_IHSS a ON a.DEPARTAMENTO_IHSS_ID = e.DEPARTAMENTO_IHSS_ID
            LEFT JOIN EDIFICIO b ON b.EDIFICIO_ID = a.EDIFICIO_ID
            LEFT JOIN REGIONAL r ON r.REGIONA_ID = COALESCE(a.REGIONA_ID, b.REGIONA_ID)
            LEFT JOIN USUARIOS u ON u.ID_USUARIO = t.ID_TECNICO
            {(idTecnico is null ? string.Empty : "WHERE t.ID_TECNICO = :idTecnico")}
            ORDER BY t.FECHA_CREACION DESC
            """, reader => new TicketDto(
                ReadInt(reader, "ID_TICKET"),
                reader.GetDateTime(reader.GetOrdinal("FECHA_CREACION")),
                ReadNullableDate(reader, "FECHA_FINALIZACION"),
                ReadNullableInt(reader, "MINUTOS_TRANSCURRIDOS"),
                ReadInt(reader, "ID_EMPLEADO"),
                ReadString(reader, "EMPLEADO"),
                ReadNullableString(reader, "REGION"),
                ReadNullableString(reader, "EDIFICIO"),
                ReadNullableString(reader, "DEPARTAMENTO"),
                ReadString(reader, "DETALLE"),
                ReadInt(reader, "ID_TECNICO"),
                ReadNullableString(reader, "TECNICO"),
                ReadString(reader, "ESTADO"),
                ReadNullableString(reader, "OBSERVACIONES"),
                ReadNullableString(reader, "VALORACION"),
                ReadNullableString(reader, "TIPO_SOPORTE")),
            cancellationToken,
            idTecnico is null ? [] : [("idTecnico", (object?)idTecnico.Value)]);

    // Empleados de un departamento. TIENE_NO_PAGO avisa en el formulario que ese empleado
    // todavía no se puede confirmar al cerrar el ticket.
    public Task<IReadOnlyList<TicketEmployeeDto>> GetEmployeesByArea(int idArea, CancellationToken cancellationToken) =>
        ReadList("""
            SELECT EMPLEADOS_IHSS_ID AS ID_EMPLEADO, NOMBRE_EMPLEADO AS NOMBRE_COMPLETO,
                   CASE WHEN TRIM(NPAGO) IS NULL THEN 0 ELSE 1 END AS TIENE_NO_PAGO
            FROM EMPLEADOS_IHSS
            WHERE DEPARTAMENTO_IHSS_ID = :idArea
            ORDER BY UPPER(NOMBRE_EMPLEADO)
            """, reader => new TicketEmployeeDto(
                ReadInt(reader, "ID_EMPLEADO"),
                ReadString(reader, "NOMBRE_COMPLETO"),
                ReadInt(reader, "TIENE_NO_PAGO") == 1),
            cancellationToken, ("idArea", idArea));

    // Los tickets los atienden los técnicos de taller: el mismo rol que ya existía.
    public Task<IReadOnlyList<TicketTechnicianDto>> GetTechnicians(CancellationToken cancellationToken) =>
        ReadList("""
            SELECT ID_USUARIO, NVL(TRIM(NOMBRE_PERSONA), USUARIO) AS NOMBRE
            FROM USUARIOS
            WHERE ROL = 'TecnicoTaller'
              AND UPPER(ESTADO) = 'ACTIVO'
              AND (FECHA_EXPIRACION IS NULL OR FECHA_EXPIRACION >= TRUNC(SYSDATE))
            ORDER BY NOMBRE
            """, reader => new TicketTechnicianDto(
                ReadInt(reader, "ID_USUARIO"),
                ReadString(reader, "NOMBRE")),
            cancellationToken);

    // Minutos que definen el color del ticket pendiente. Si la tabla todavía no existe o
    // le falta algún valor, se usan los de referencia para que la tabla siga funcionando.
    public async Task<TicketAlertThresholdsDto> GetAlertThresholds(CancellationToken cancellationToken)
    {
        const int defaultGreen = 30;
        const int defaultYellow = 60;
        try
        {
            var values = await ReadList("""
                SELECT CLAVE, VALOR
                FROM TICKETS_CONFIG
                WHERE CLAVE IN ('MINUTOS_VERDE', 'MINUTOS_AMARILLO')
                """, reader => (Clave: ReadString(reader, "CLAVE"), Valor: ReadInt(reader, "VALOR")),
                cancellationToken);

            var green = values.FirstOrDefault(value => value.Clave == "MINUTOS_VERDE").Valor;
            var yellow = values.FirstOrDefault(value => value.Clave == "MINUTOS_AMARILLO").Valor;
            if (green <= 0) green = defaultGreen;
            if (yellow <= 0) yellow = defaultYellow;
            // El amarillo no puede quedar antes que el verde: se corrige en lugar de fallar.
            return new TicketAlertThresholdsDto(green, Math.Max(green, yellow));
        }
        catch (OracleException exception) when (exception.Number == 942)
        {
            return new TicketAlertThresholdsDto(defaultGreen, defaultYellow);
        }
    }

    public Task CreateTicket(CreateTicketDto ticket, int createdByUserId, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            var idTicket = await NextId(connection, transaction, "TICKETS_SOPORTE", "ID_TICKET", cancellationToken);
            await Execute(connection, transaction, """
                INSERT INTO TICKETS_SOPORTE
                    (ID_TICKET, FECHA_CREACION, ID_EMPLEADO, DETALLE,
                     ID_TECNICO, ID_USUARIO_CREA, ESTADO, TIPO_SOPORTE)
                VALUES
                    (:idTicket, SYSDATE, :idEmpleado, :detalle,
                     :idTecnico, :idUsuarioCrea, 'PENDIENTE', :tipoSoporte)
                """, cancellationToken,
                ("idTicket", idTicket), ("idEmpleado", ticket.IdEmpleado),
                ("detalle", ticket.Detalle.Trim()), ("idTecnico", ticket.IdTecnico),
                ("idUsuarioCrea", createdByUserId),
                ("tipoSoporte", ticket.TipoSoporte?.Trim().ToUpperInvariant()));
        }, cancellationToken);

    // Solo se edita un ticket abierto: una vez cerrado, su contenido es el respaldo del servicio.
    public async Task<bool> UpdateTicket(int idTicket, UpdateTicketDto ticket, CancellationToken cancellationToken) =>
        await Execute("""
            UPDATE TICKETS_SOPORTE
            SET ID_EMPLEADO = :idEmpleado,
                DETALLE = :detalle,
                ID_TECNICO = :idTecnico,
                TIPO_SOPORTE = :tipoSoporte
            WHERE ID_TICKET = :idTicket
              AND ESTADO = 'PENDIENTE'
            """, cancellationToken,
            ("idEmpleado", ticket.IdEmpleado), ("detalle", ticket.Detalle.Trim()),
            ("idTecnico", ticket.IdTecnico), ("tipoSoporte", ticket.TipoSoporte?.Trim().ToUpperInvariant()),
            ("idTicket", idTicket)) > 0;

    public async Task<bool> ReassignTicket(int idTicket, int idTecnico, CancellationToken cancellationToken) =>
        await Execute("""
            UPDATE TICKETS_SOPORTE
            SET ID_TECNICO = :idTecnico
            WHERE ID_TICKET = :idTicket
              AND ESTADO = 'PENDIENTE'
            """, cancellationToken,
            ("idTecnico", idTecnico), ("idTicket", idTicket)) > 0;

    public Task<bool> FinishTicket(
        int idTicket,
        FinishTicketDto finish,
        int idTecnico,
        bool isManager,
        CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
            // Estado del ticket y No. de pago del empleado atendido, leídos juntos para
            // decidir con datos de la misma transacción.
            var estado = await GetScalar<string?>(connection, transaction, """
                SELECT ESTADO
                FROM TICKETS_SOPORTE
                WHERE ID_TICKET = :idTicket
                """, cancellationToken, ("idTicket", idTicket));
            if (estado is null) return false;
            if (!string.Equals(estado, "PENDIENTE", StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException("El ticket ya fue finalizado.");
            }

            // Un técnico solo cierra lo suyo; el administrador puede cerrar cualquiera.
            if (!isManager)
            {
                var assigned = await GetScalar<int?>(connection, transaction, """
                    SELECT ID_TECNICO
                    FROM TICKETS_SOPORTE
                    WHERE ID_TICKET = :idTicket
                    """, cancellationToken, ("idTicket", idTicket));
                if (assigned != idTecnico)
                {
                    throw new ArgumentException("El ticket está asignado a otro técnico.");
                }
            }

            var registrado = await GetScalar<string?>(connection, transaction, """
                SELECT TRIM(e.NPAGO)
                FROM TICKETS_SOPORTE t
                JOIN EMPLEADOS_IHSS e ON e.EMPLEADOS_IHSS_ID = t.ID_EMPLEADO
                WHERE t.ID_TICKET = :idTicket
                """, cancellationToken, ("idTicket", idTicket));
            if (string.IsNullOrWhiteSpace(registrado))
            {
                throw new ArgumentException(
                    "El empleado no tiene No. de pago registrado, así que no se puede confirmar. "
                    + "Asígnaselo en el módulo Empleados.");
            }
            if (!string.Equals(registrado.Trim(), finish.NoPago.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException("El No. de pago es incorrecto. La tarea no se finalizó.");
            }

            return await Execute(connection, transaction, """
                UPDATE TICKETS_SOPORTE
                SET ESTADO = 'FINALIZADO',
                    FECHA_FINALIZACION = SYSDATE,
                    OBSERVACIONES = :observaciones,
                    VALORACION = :valoracion
                WHERE ID_TICKET = :idTicket
                """, cancellationToken,
                ("observaciones", string.IsNullOrWhiteSpace(finish.Observaciones) ? null : finish.Observaciones.Trim()),
                ("valoracion", finish.Valoracion.Trim().ToUpperInvariant()),
                ("idTicket", idTicket)) > 0;
        }, cancellationToken);
}
