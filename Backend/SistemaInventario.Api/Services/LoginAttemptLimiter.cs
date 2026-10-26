using Microsoft.Extensions.Caching.Memory;

namespace SistemaInventario.Api.Services;

// Bloquea temporalmente un usuario después de varios intentos fallidos de inicio de sesión,
// sin importar desde qué equipo lleguen. Frena la fuerza bruta contra usuarios locales y
// evita que intentos repetidos terminen bloqueando la cuenta de dominio en Active Directory.
// Se configura con Security:LoginMaxFailedAttempts y Security:LoginLockoutMinutes.
public sealed class LoginAttemptLimiter(IMemoryCache cache, IConfiguration configuration)
{
    private int MaxFailedAttempts => Math.Max(1, configuration.GetValue("Security:LoginMaxFailedAttempts", 5));
    private TimeSpan LockoutWindow => TimeSpan.FromMinutes(Math.Max(1, configuration.GetValue("Security:LoginLockoutMinutes", 15)));

    // Tiempo que le falta al bloqueo, o null si el usuario puede intentar.
    public TimeSpan? GetRemainingLockout(string userName)
    {
        if (!cache.TryGetValue(Key(userName), out FailedAttempts? attempts) || attempts is null) return null;
        lock (attempts)
        {
            var remaining = attempts.LockedUntil - DateTimeOffset.UtcNow;
            return remaining > TimeSpan.Zero ? remaining : null;
        }
    }

    public void RegisterFailure(string userName)
    {
        var window = LockoutWindow;
        // La ventana empieza con el primer fallo: los fallos se olvidan pasado ese tiempo.
        var attempts = cache.GetOrCreate(Key(userName), entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = window;
            return new FailedAttempts();
        })!;
        lock (attempts)
        {
            attempts.Count++;
            if (attempts.Count >= MaxFailedAttempts)
            {
                attempts.LockedUntil = DateTimeOffset.UtcNow + window;
                // El bloqueo debe durar completo aunque la ventana original esté por vencer.
                cache.Set(Key(userName), attempts, window);
            }
        }
    }

    public void Reset(string userName) => cache.Remove(Key(userName));

    // "BA\Juan.Perez", "juan.perez@ihss.hn" y "Juan.Perez" cuentan como el mismo usuario.
    private static string Key(string userName) => $"login-failures:{AuthService.NormalizeDomainUserName(userName)}";

    private sealed class FailedAttempts
    {
        public int Count { get; set; }
        public DateTimeOffset LockedUntil { get; set; } = DateTimeOffset.MinValue;
    }
}
