using System.IdentityModel.Tokens.Jwt;
using System.Data;
using System.Data.Common;
using System.DirectoryServices;
using System.Runtime.InteropServices;
using System.Security.Claims;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SistemaInventario.Api.Data;
using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

// Servicio de autenticación: consulta las credenciales en Oracle y crea el JWT
// que el frontend utiliza para conservar la sesión y aplicar permisos por rol.
public sealed class AuthService(
    InventoryDbContext dbContext,
    IModulePermissionService modulePermissions,
    IConfiguration configuration,
    ILogger<AuthService> logger) : IAuthService
{
    public async Task<LoginResponseDto?> AuthenticateUser(
        LoginRequestDto loginRequest,
        CancellationToken cancellationToken)
    {
        var connection = dbContext.Database.GetDbConnection();
        await dbContext.Database.OpenConnectionAsync(cancellationToken);

        try
        {
            await using var command = connection.CreateCommand();
            // Los usuarios locales se buscan tal como se escriben. Los de dominio, como en Active Directory,
            // sin distinguir mayúsculas ni espacios y aceptando "usuario", "DOMINIO\usuario" o "usuario@dominio".
            // Los parámetros se enlazan por posición: deben agregarse en el mismo orden en que aparecen.
            command.CommandText = """
                                SELECT ID_USUARIO, USUARIO, NOMBRE_PERSONA, PASSWORD_HASH, ROL, ESTADO,
                                             DOMINIOP, DOMINIO, CLAVE_SEGURA
                FROM USUARIOS
                WHERE (USUARIO = :userName OR (DOMINIO = 1 AND LOWER(TRIM(USUARIO)) = :domainUserName))
                  AND (DOMINIO = 1 OR PASSWORD_HASH = ORA_HASH(:password, 4294967295)
                      || ORA_HASH(:userNameForHash, 4294967295))
                  AND UPPER(ESTADO) = 'ACTIVO'
                  AND (FECHA_EXPIRACION IS NULL OR FECHA_EXPIRACION >= TRUNC(SYSDATE))
                """;
            AddParameter(command, "userName", loginRequest.UserName);
            AddParameter(command, "domainUserName", NormalizeDomainUserName(loginRequest.UserName));
            AddParameter(command, "password", loginRequest.Password);
            AddParameter(command, "userNameForHash", loginRequest.UserName);

            User user;
            int domain;
            string domainName;
            string secureKey;
            string status;
            await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            {
                if (!await reader.ReadAsync(cancellationToken))
                {
                    logger.LogWarning(
                        "Login rechazado para {UserName}: no existe, está inactivo o expirado, o la contraseña local no coincide.",
                        loginRequest.UserName);
                    return null;
                }

                user = new User
                {
                    UserId = reader.GetInt32(reader.GetOrdinal("ID_USUARIO")),
                    UserName = reader.GetString(reader.GetOrdinal("USUARIO")),
                    FullName = ReadString(reader, "NOMBRE_PERSONA"),
                    PasswordHash = reader.GetString(reader.GetOrdinal("PASSWORD_HASH")),
                    Role = reader.GetString(reader.GetOrdinal("ROL")),
                };
                domain = Convert.ToInt32(reader.GetValue(reader.GetOrdinal("DOMINIO")));
                domainName = ReadString(reader, "DOMINIOP").Trim().ToUpperInvariant();
                secureKey = ReadString(reader, "CLAVE_SEGURA");
                status = ReadString(reader, "ESTADO");
            }

            if (domain == 1)
            {
                if (domainName is not ("BA" or "HE" or "HRN" or "IVM"))
                {
                    logger.LogWarning(
                        "El usuario {UserName} tiene un dominio no reconocido: {DomainName}.",
                        loginRequest.UserName,
                        domainName);
                    return null;
                }

                // Se valida con el usuario registrado (no con lo escrito), así "BA\Usuario" o "Usuario " también entran.
                if (!ValidateCredentials(user.UserName.Trim(), loginRequest.Password, domainName))
                {
                    return null;
                }
            }
            else if (domain != 0)
            {
                return null;
            }

            var mustChangePassword = domain == 0 && secureKey == "0";
            var modules = await modulePermissions.GetModules(user.UserId, cancellationToken);
            var isSuperAdmin = modules.Contains(AppModules.SuperAdmin, StringComparer.OrdinalIgnoreCase);
            // Registrar información del usuario
            logger.LogInformation(
                "Login aceptado para {UserName}. Tipo: {Domain}, Dominio: {DomainName}.",
                loginRequest.UserName,
                domain,
                domainName);
            return new LoginResponseDto(GenerateToken(user, mustChangePassword), new UserResponseDto(
                user.UserId,
                user.UserName,
                string.IsNullOrWhiteSpace(user.FullName) ? user.UserName : user.FullName,
                user.Role,
                status,
                domainName,
                domain,
                modules.Where(module => !string.Equals(module, AppModules.SuperAdmin, StringComparison.OrdinalIgnoreCase)).ToArray(),
                isSuperAdmin),
                mustChangePassword);
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
    }

    // "BA\Juan.Perez", "juan.perez@ihss.hn" y " Juan.Perez " se reducen a "juan.perez".
    private static string NormalizeDomainUserName(string userName)
    {
        var value = userName.Trim();
        var slash = value.LastIndexOf('\\');
        if (slash >= 0) value = value[(slash + 1)..];
        var at = value.IndexOf('@');
        if (at >= 0) value = value[..at];
        return value.Trim().ToLowerInvariant();
    }

    private bool ValidateCredentials(string username, string password, string domain)
    {
        if (!OperatingSystem.IsWindows())
        {
            logger.LogWarning("Se intento validar contra Active Directory en un sistema no Windows.");
            return false;
        }

        try
        {
            // se agrega el prefijo "dominio\usuario": sin él, las confianzas entre dominios del bosque
            // permiten autenticar la cuenta aunque pertenezca a otro dominio distinto al elegido
            using var entry = new DirectoryEntry($"LDAP://{domain}", $@"{domain}\{username}", password);
            using var searcher = new DirectorySearcher(entry);
            return searcher.FindOne() is not null;
        }
        catch (Exception ex) when (ex is COMException or DirectoryServicesCOMException or UnauthorizedAccessException)
        {
            // ExtendedErrorMessage trae el motivo de AD: "data 52e" contraseña incorrecta, "data 532" contraseña
            // vencida, "data 773" debe cambiar la contraseña, "data 775" cuenta bloqueada, "data 525" no existe.
            logger.LogWarning(ex,
                "Active Directory rechazó a {UserName} en el dominio {Domain}. Detalle: {Detail}",
                username,
                domain,
                (ex as DirectoryServicesCOMException)?.ExtendedErrorMessage ?? ex.Message);
            return false;
        }
    }

    public async Task<bool> ChangeInitialPassword(
        int userId,
        ChangePasswordDto request,
        CancellationToken cancellationToken)
    {
        await dbContext.Database.OpenConnectionAsync(cancellationToken);
        try
        {
            await using var command = dbContext.Database.GetDbConnection().CreateCommand();
            command.CommandText = """
                UPDATE USUARIOS
                SET PASSWORD_HASH = ORA_HASH(:newPassword, 4294967295)
                                      || ORA_HASH(USUARIO, 4294967295),
                                        CLAVE_SEGURA = '1'
                WHERE ID_USUARIO = :userId
                  AND DOMINIO = 0
                                    AND CLAVE_SEGURA = '0'
                  AND PASSWORD_HASH = ORA_HASH(:currentPassword, 4294967295)
                                      || ORA_HASH(USUARIO, 4294967295)
                """;
            AddParameter(command, "newPassword", request.NewPassword);
            AddParameter(command, "userId", userId);
            AddParameter(command, "currentPassword", request.CurrentPassword);
            return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
    }

    private static void AddParameter(
        System.Data.Common.DbCommand command,
        string name,
        string value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.DbType = DbType.String;
        parameter.Size = 256;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }

    private static void AddParameter(
        System.Data.Common.DbCommand command,
        string name,
        int value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.DbType = DbType.Int32;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }

    public string RefreshToken(int userId, string userName, string role, bool mustChangePassword) =>
        GenerateToken(new User
        {
            UserId = userId,
            UserName = userName,
            Role = role,
        }, mustChangePassword);

    private string GenerateToken(User user, bool mustChangePassword)
    {
        var key = configuration["Jwt:Key"]
            ?? throw new InvalidOperationException("Falta configurar Jwt:Key.");
        var expiresInMinutes = configuration.GetValue("Jwt:ExpirationMinutes", 35);
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.UserId.ToString()),
            new Claim(JwtRegisteredClaimNames.UniqueName, user.UserName),
            new Claim(ClaimTypes.Name, user.UserName),
            new Claim(ClaimTypes.Role, user.Role),
            new Claim("must_change_password", mustChangePassword ? "true" : "false"),
        };
        var credentials = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
            SecurityAlgorithms.HmacSha256);
            // Convierte la identidad y el rol del usuario en claims que leerá ASP.NET Core.
        var token = new JwtSecurityToken(
            issuer: configuration["Jwt:Issuer"],
            audience: configuration["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddMinutes(expiresInMinutes),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private static string ReadString(DbDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? string.Empty : Convert.ToString(reader.GetValue(ordinal)) ?? string.Empty;
    }
}