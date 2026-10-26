using SistemaInventario.Api.Data;
using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Persistencia del historial de reasignaciones y del cambio de responsable de un equipo.
public sealed class ReassignmentService(InventoryDbContext dbContext) : AssignmentRepository(dbContext), IReassignmentService
{
    public Task<IReadOnlyList<ReassignmentDto>> GetReassignments(CancellationToken cancellationToken) =>
        // Consulta el historial ordenado para que la interfaz muestre primero los cambios recientes.
        ReadList("""
            SELECT r.ID_REASIGNACION, r.ID_EQUIPO, d.CODIGO_INVENTARIO,
                   TO_CHAR(r.NO_PAGO_ANTERIOR) AS NO_PAGO_ANTERIOR,
                   COALESCE(r.NOMBRE_ANTERIOR, e_ant.NOMBRE_EMPLEADO, TO_CHAR(r.NO_PAGO_ANTERIOR)) AS NOMBRE_ANTERIOR,
                   a_ant.DEPARTAMENTO_IHSS_DESC AS NOMBRE_AREA_ANTERIOR,
                   TO_CHAR(r.NO_PAGO_NUEVO) AS NO_PAGO_NUEVO,
                   COALESCE(r.NOMBRE_NUEVO, e.NOMBRE_EMPLEADO, TO_CHAR(r.NO_PAGO_NUEVO), 'Sin asignar') AS NOMBRE_NUEVO,
                   -- Área de trabajo de quien quedó responsable en ESE cambio, no la del equipo:
                   -- cada fila del historial muestra el área de su propio responsable.
                   b_new.EDIFICIO_DESCRIPCION AS NOMBRE_EDIFICIO,
                   a_new.DEPARTAMENTO_IHSS_DESC AS NOMBRE_AREA,
                   r.FECHA_CAMBIO, r.MOTIVO,
                   t.TIPO_DISPOSITIVO || CASE WHEN d.COMPONENTE IS NOT NULL THEN ' · ' || d.COMPONENTE END AS NOMBRE_TIPO,
                   d.MARCA, d.MODELO, d.NO_SERIE
            FROM (
                SELECT ra.ID_REASIGNACION, ra.ID_EQUIPO, ra.NO_PAGO_ANTERIOR, ra.NOMBRE_ANTERIOR,
                       ra.NO_PAGO_NUEVO, ra.NOMBRE_NUEVO, ra.FECHA_CAMBIO, ra.MOTIVO,
                       -- Departamento del nuevo responsable: primero por No. de pago y, si ese
                       -- número no corresponde a ningún empleado (o el empleado no lo tiene
                       -- registrado), por nombre.
                       COALESCE(
                           (SELECT MAX(emp.DEPARTAMENTO_IHSS_ID)
                            FROM EMPLEADOS_IHSS emp
                            WHERE TRIM(TO_CHAR(emp.NPAGO)) = TRIM(TO_CHAR(ra.NO_PAGO_NUEVO))),
                           (SELECT MAX(emp.DEPARTAMENTO_IHSS_ID)
                            FROM EMPLEADOS_IHSS emp
                            WHERE UPPER(TRIM(emp.NOMBRE_EMPLEADO)) = UPPER(TRIM(ra.NOMBRE_NUEVO)))) AS ID_AREA_NUEVO
                FROM REASIGNACIONES ra
            ) r
            LEFT JOIN DISPOSITIVOS d ON d.ID_EQUIPO = r.ID_EQUIPO
            LEFT JOIN EMPLEADOS_IHSS e ON TRIM(TO_CHAR(e.NPAGO)) = TRIM(TO_CHAR(r.NO_PAGO_NUEVO))
            LEFT JOIN EMPLEADOS_IHSS e_ant ON TRIM(TO_CHAR(e_ant.NPAGO)) = TRIM(TO_CHAR(r.NO_PAGO_ANTERIOR))
            LEFT JOIN DEPARTAMENTO_IHSS a_ant ON a_ant.DEPARTAMENTO_IHSS_ID = e_ant.DEPARTAMENTO_IHSS_ID
            LEFT JOIN DEPARTAMENTO_IHSS a_new ON a_new.DEPARTAMENTO_IHSS_ID = r.ID_AREA_NUEVO
            LEFT JOIN EDIFICIO b_new ON b_new.EDIFICIO_ID = a_new.EDIFICIO_ID
            LEFT JOIN TIPOS_DISPOSITIVOS t ON t.ID_TIPO = d.ID_TIPO
            ORDER BY r.FECHA_CAMBIO DESC
            """, reader => new ReassignmentDto(
                ReadInt(reader, "ID_REASIGNACION"),
                ReadInt(reader, "ID_EQUIPO"),
                ReadString(reader, "CODIGO_INVENTARIO"),
                ReadNullableString(reader, "NO_PAGO_ANTERIOR"),
                ReadNullableString(reader, "NOMBRE_ANTERIOR"),
                ReadNullableString(reader, "NOMBRE_AREA_ANTERIOR"),
                ReadNullableString(reader, "NO_PAGO_NUEVO"),
                ReadNullableString(reader, "NOMBRE_NUEVO"),
                ReadNullableString(reader, "NOMBRE_EDIFICIO"),
                ReadNullableString(reader, "NOMBRE_AREA"),
                reader.GetDateTime(reader.GetOrdinal("FECHA_CAMBIO")),
                ReadString(reader, "MOTIVO"),
                ReadNullableString(reader, "NOMBRE_TIPO"),
                ReadNullableString(reader, "MARCA"),
                ReadNullableString(reader, "MODELO"),
                ReadNullableString(reader, "NO_SERIE")), cancellationToken);

    public Task CreateReassignment(CreateReassignmentDto reassignment, CancellationToken cancellationToken) =>
        InTransaction(async (connection, transaction) =>
        {
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

            if (!string.IsNullOrWhiteSpace(nuevoPago) || !string.IsNullOrWhiteSpace(nuevoNombre))
            {
                (nuevoPago, nuevoNombre) = await EnsureEmployeeExistsAndResolvePayment(
                    connection, transaction, nuevoPago, nuevoNombre, reassignment.IdArea, cancellationToken);
            }

            await Execute(connection, transaction, """
                INSERT INTO REASIGNACIONES
                    (ID_EQUIPO, NO_PAGO_ANTERIOR, NOMBRE_ANTERIOR, NO_PAGO_NUEVO, NOMBRE_NUEVO, FECHA_CAMBIO, MOTIVO)
                SELECT ID_EQUIPO, NUMERO_PAGO_ASIGNADO, NOMBRE_ASIGNADO, :nuevoPago, :nuevoNombre, SYSDATE, :motivo
                FROM DISPOSITIVOS
                WHERE ID_EQUIPO = :idEquipo
                """, cancellationToken,
                ("nuevoPago", nuevoPago), ("nuevoNombre", nuevoNombre), ("motivo", reassignment.Motivo),
                ("idEquipo", reassignment.IdEquipo));
            await Execute(connection, transaction, """
                UPDATE DISPOSITIVOS
                SET NUMERO_PAGO_ASIGNADO = :nuevoPago,
                    NOMBRE_ASIGNADO = :nuevoNombre,
                    ID_AREA = :idArea,
                    ESTADO = 'ASIGNADO'
                WHERE ID_EQUIPO = :idEquipo
                """, cancellationToken,
                ("nuevoPago", nuevoPago), ("nuevoNombre", nuevoNombre),
                ("idArea", reassignment.IdArea), ("idEquipo", reassignment.IdEquipo));
        }, cancellationToken);

    // Elimina solo el registro del historial; no revierte la asignación actual del equipo.
    public async Task<bool> DeleteReassignment(int idReasignacion, CancellationToken cancellationToken) =>
        await Execute("DELETE FROM REASIGNACIONES WHERE ID_REASIGNACION = :idReasignacion", cancellationToken,
            ("idReasignacion", idReasignacion)) > 0;
}
