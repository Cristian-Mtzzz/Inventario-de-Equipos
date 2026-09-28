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
            command.CommandText = """
                                SELECT ID_USUARIO, USUARIO, NOMBRE_PERSONA, PASSWORD_HASH, ROL, ESTADO,
                                             DOMINIOP, DOMINIO, CLAVE_SEGURA
                FROM USUARIOS
                WHERE USUARIO = :userName
                  AND (DOMINIO = 1 OR PASSWORD_HASH = ORA_HASH(:password, 4294967295)
                      || ORA_HASH(:userNameForHash, 4294967295))
                  AND UPPER(ESTADO) = 'ACTIVO'
                  AND (FECHA_EXPIRACION IS NULL OR FECHA_EXPIRACION >= TRUNC(SYSDATE))
                """;
            AddParameter(command, "userName", loginRequest.UserName);
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

                if (!ValidateCredentials(loginRequest.UserName, loginRequest.Password, domainName))
                {
                    return null;
                }
            }
            else if (domain != 0)
            {
                return null;
            }

            var mustChangePassword = domain == 0 && secureKey == "0";
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
                domain),
                mustChangePassword);
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
        }
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
            // Prefijo "dominio\usuario": sin él, las confianzas entre dominios del bosque
            // permiten autenticar la cuenta aunque pertenezca a otro dominio distinto al elegido
            using var entry = new DirectoryEntry($"LDAP://{domain}", $@"{domain}\{username}", password);
            using var searcher = new DirectorySearcher(entry);
            return searcher.FindOne() is not null;
        }
        catch (Exception ex) when (ex is COMException or DirectoryServicesCOMException or UnauthorizedAccessException)
        {
            logger.LogWarning(ex, "Fallo la validacion contra Active Directory para el dominio {Domain}.", domain);
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

    private string GenerateToken(User user, bool mustChangePassword)
    {
        var key = configuration["Jwt:Key"]
            ?? throw new InvalidOperationException("Falta configurar Jwt:Key.");
        var expiresInMinutes = configuration.GetValue("Jwt:ExpirationMinutes", 60);
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