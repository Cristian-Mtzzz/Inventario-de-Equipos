using System.Data.Common;

namespace SistemaInventario.Api.Data;

// Base de los servicios que asignan equipos a empleados (dispositivos y reasignaciones).
// Comparte la regla que completa el número de pago o el nombre y registra en
// EMPLEADOS_IHSS al empleado que todavía no existe.
public abstract class AssignmentRepository(InventoryDbContext dbContext) : OracleRepository(dbContext)
{
    protected static async Task<(string? NumeroPago, string? NombreAsignado)> EnsureEmployeeExistsAndResolvePayment(
        DbConnection connection,
        DbTransaction transaction,
        string? numeroPago,
        string? nombreAsignado,
        int? idArea,
        CancellationToken cancellationToken)
    {
        numeroPago = string.IsNullOrWhiteSpace(numeroPago) ? null : numeroPago.Trim();
        nombreAsignado = string.IsNullOrWhiteSpace(nombreAsignado) ? null : nombreAsignado.Trim();

        if (numeroPago is null && nombreAsignado is null)
        {
            return (null, null);
        }

        if (numeroPago is null && nombreAsignado is not null)
        {
            numeroPago = await GetScalar<string?>(connection, transaction, """
                SELECT NPAGO
                FROM EMPLEADOS_IHSS
                WHERE UPPER(TRIM(NOMBRE_EMPLEADO)) = UPPER(TRIM(:nombreCompleto))
                  AND ROWNUM = 1
                """, cancellationToken, ("nombreCompleto", nombreAsignado));
        }

        if (nombreAsignado is null && numeroPago is not null)
        {
            nombreAsignado = await GetScalar<string?>(connection, transaction, """
                SELECT MAX(NOMBRE_EMPLEADO)
                FROM EMPLEADOS_IHSS
                WHERE TRIM(NPAGO) = TRIM(:noPago)
                """, cancellationToken, ("noPago", numeroPago));
        }

        bool exists = false;
        if (numeroPago is not null && nombreAsignado is not null)
        {
            exists = await Exists(connection, transaction, """
                SELECT 1
                FROM EMPLEADOS_IHSS
                WHERE TRIM(NPAGO) = TRIM(:pago)
                   OR UPPER(TRIM(NOMBRE_EMPLEADO)) = UPPER(TRIM(:nombre))
                """, cancellationToken,
                ("pago", numeroPago), ("nombre", nombreAsignado));
        }
        else if (numeroPago is not null)
        {
            exists = await Exists(connection, transaction, """
                SELECT 1
                FROM EMPLEADOS_IHSS
                WHERE TRIM(NPAGO) = TRIM(:pago)
                """, cancellationToken,
                ("pago", numeroPago));
        }
        else if (nombreAsignado is not null)
        {
            exists = await Exists(connection, transaction, """
                SELECT 1
                FROM EMPLEADOS_IHSS
                WHERE UPPER(TRIM(NOMBRE_EMPLEADO)) = UPPER(TRIM(:nombre))
                """, cancellationToken,
                ("nombre", nombreAsignado));
        }

        if (!exists)
        {
            var finalName = nombreAsignado ?? numeroPago!;
            var employeeId = await NextId(connection, transaction, "EMPLEADOS_IHSS", "EMPLEADOS_IHSS_ID", cancellationToken);
            await Execute(connection, transaction, """
                INSERT INTO EMPLEADOS_IHSS
                    (EMPLEADOS_IHSS_ID, NPAGO, NOMBRE_EMPLEADO, ESTADO, DEPARTAMENTO_IHSS_ID)
                VALUES (:employeeId, :noPago, :nombre, 1, :idArea)
                """, cancellationToken,
                ("employeeId", employeeId),
                ("noPago", numeroPago),
                ("nombre", finalName),
                ("idArea", idArea));

            nombreAsignado ??= finalName;
        }

        return (numeroPago, nombreAsignado);
    }

    // Saca del combo la pieza que se asignó por separado: pasa a ser un dispositivo individual
    // del tipo de su componente (CPU, Teclado, Monitor) y conserva su número de ingreso. Las
    // demás piezas siguen en el combo con su asignación; si solo queda una, también se separa.
    protected static async Task RemoveFromCombo(
        DbConnection connection,
        DbTransaction transaction,
        int idEquipo,
        CancellationToken cancellationToken)
    {
        var comboNumber = await GetScalar<string?>(connection, transaction,
            "SELECT NCOMBO FROM DISPOSITIVOS WHERE ID_EQUIPO = :idEquipo", cancellationToken,
            ("idEquipo", idEquipo));
        if (string.IsNullOrWhiteSpace(comboNumber)) return;

        await Execute(connection, transaction, """
            UPDATE DISPOSITIVOS d
            SET ID_TIPO = COALESCE(
                    (SELECT MIN(t.ID_TIPO)
                     FROM TIPOS_DISPOSITIVOS t
                     WHERE UPPER(TRIM(t.TIPO_DISPOSITIVO)) = UPPER(TRIM(d.COMPONENTE))),
                    d.ID_TIPO),
                NCOMBO = NULL,
                COMPONENTE = NULL
            WHERE d.NCOMBO = :ncombo
              AND (d.ID_EQUIPO = :idEquipo
                   OR (SELECT COUNT(*) FROM DISPOSITIVOS s WHERE s.NCOMBO = :ncombo) <= 2)
            """, cancellationToken, ("ncombo", comboNumber), ("idEquipo", idEquipo));
    }
}
