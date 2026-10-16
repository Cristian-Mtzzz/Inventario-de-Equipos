using Microsoft.AspNetCore.Diagnostics;
using Oracle.ManagedDataAccess.Client;

namespace SistemaInventario.Api.Infrastructure;

// Último recurso para excepciones que ningún controlador manejó. Registra el error y
// responde con el mismo formato { Message } que usan los endpoints, para que el
// frontend muestre un mensaje entendible en lugar de un 500 sin cuerpo.
public sealed class ApiExceptionHandler(ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
    // Códigos ORA/ODP.NET que indican que la base de datos no está disponible.
    // Códigos ORA/ODP.NET que indican que la base de datos no está disponible.
    private static readonly HashSet<int> UnavailableOracleErrors =
    [
        1033, 1034, 1089, 3113, 3114, 3135, 12170, 12514, 12528, 12537, 12541, 12543, 12545, 50000,
    ];

    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        // El cliente canceló la solicitud: no hay a quién responder.
        if (exception is OperationCanceledException && httpContext.RequestAborted.IsCancellationRequested)
        {
            return true;
        }

        var (statusCode, message) = Classify(exception);
        if (statusCode >= StatusCodes.Status500InternalServerError)
        {
            logger.LogError(exception, "Error no controlado en {Method} {Path}.",
                httpContext.Request.Method, httpContext.Request.Path);
        }
        else
        {
            logger.LogWarning(exception, "Solicitud rechazada en {Method} {Path}: {Message}",
                httpContext.Request.Method, httpContext.Request.Path, message);
        }

        httpContext.Response.StatusCode = statusCode;
        await httpContext.Response.WriteAsJsonAsync(new { Message = message }, cancellationToken);
        return true;
    }

    // Clasifica la excepción y devuelve el código de estado HTTP y el mensaje para el cliente.
    private static (int StatusCode, string Message) Classify(Exception exception) => exception switch
    {
        OracleException { Number: 1 } =>
            (StatusCodes.Status409Conflict, "Ya existe un registro con esos datos."),
        OracleException { Number: 2292 } =>
            (StatusCodes.Status409Conflict, "No se puede eliminar porque tiene registros relacionados."),
        OracleException { Number: 2291 } =>
            (StatusCodes.Status400BadRequest, "Uno de los datos relacionados seleccionados no existe."),
        OracleException { Number: 1400 } =>
            (StatusCodes.Status400BadRequest, "Falta un dato obligatorio."),
        OracleException { Number: 12899 or 1438 } =>
            (StatusCodes.Status400BadRequest, "Uno de los valores supera la longitud permitida."),
        OracleException { Number: 54 or 60 or 30006 } =>
            (StatusCodes.Status409Conflict, "Otro usuario está modificando estos datos. Intenta de nuevo en unos segundos."),
        OracleException oracle when UnavailableOracleErrors.Contains(oracle.Number) =>
            (StatusCodes.Status503ServiceUnavailable, "La base de datos no está disponible temporalmente."),
        // Solo la ArgumentException base: la lanzan los servicios con un mensaje para el usuario.
        ArgumentException argument when argument.GetType() == typeof(ArgumentException) =>
            (StatusCodes.Status400BadRequest, argument.Message),
        _ => (StatusCodes.Status500InternalServerError, "Ocurrió un error inesperado. Intenta de nuevo o contacta al administrador."),
    };
}
