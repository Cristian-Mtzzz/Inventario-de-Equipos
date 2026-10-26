using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using SistemaInventario.Api.Services;

namespace SistemaInventario.Api.Infrastructure;

// Protección del inicio de sesión contra fuerza bruta, en dos niveles:
// - por equipo (IP): máximo Security:LoginRequestsPerMinutePerIp intentos por minuto;
// - por usuario: LoginAttemptLimiter lo bloquea tras varios fallos seguidos.
public static class LoginRateLimit
{
    public const string Policy = "login";

    public static IServiceCollection AddLoginProtection(this IServiceCollection services, IConfiguration configuration)
    {
        var permitsPerMinute = Math.Max(1, configuration.GetValue("Security:LoginRequestsPerMinutePerIp", 20));
        services.AddMemoryCache();
        services.AddSingleton<LoginAttemptLimiter>();
        services.AddRateLimiter(options =>
        {
            options.AddPolicy(Policy, context => RateLimitPartition.GetFixedWindowLimiter(
                context.Connection.RemoteIpAddress?.ToString() ?? "desconocido",
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = permitsPerMinute,
                    Window = TimeSpan.FromMinutes(1),
                    QueueLimit = 0,
                }));
            options.OnRejected = async (context, cancellationToken) =>
            {
                context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                await context.HttpContext.Response.WriteAsJsonAsync(new
                {
                    Message = "Demasiados intentos de inicio de sesión desde este equipo. Espera un minuto e intenta de nuevo.",
                }, cancellationToken);
            };
        });
        return services;
    }

    public static ObjectResult TooManyAttempts(TimeSpan remaining)
    {
        var minutes = Math.Max(1, (int)Math.Ceiling(remaining.TotalMinutes));
        return new ObjectResult(new
        {
            Message = $"Demasiados intentos fallidos. Intenta de nuevo en {minutes} {(minutes == 1 ? "minuto" : "minutos")}.",
        })
        {
            StatusCode = StatusCodes.Status429TooManyRequests,
        };
    }
}
