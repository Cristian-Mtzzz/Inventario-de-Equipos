using System.IdentityModel.Tokens.Jwt;
using System.Data;
using System.Data.Common;
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
    IConfiguration configuration) : IAuthService
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
                                SELECT ID_USUARIO, USUARIO, PASSWORD_HASH, ROL, ESTADO,
                                             DOMINIOP, DOMINIO, CLAVE_SEGURA
                FROM USUARIOS
                WHERE USUARIO = :userName
                  AND PASSWORD_HASH = ORA_HASH(:password, 4294967295)
                      || ORA_HASH(:userNameForHash, 4294967295)
                                    AND UPPER(ESTADO) = 'ACTIVO'
                                    AND (FECHA_EXPIRACION IS NULL OR FECHA_EXPIRACION >= TRUNC(SYSDATE))
                """;
            AddParameter(command, "userName", loginRequest.UserName);
            AddParameter(command, "password", loginRequest.Password);
            AddParameter(command, "userNameForHash", loginRequest.UserName);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                return null;
            }

            var user = new User
            {
                UserId = reader.GetInt32(reader.GetOrdinal("ID_USUARIO")),
                UserName = reader.GetString(reader.GetOrdinal("USUARIO")),
                PasswordHash = reader.GetString(reader.GetOrdinal("PASSWORD_HASH")),
                Role = reader.GetString(reader.GetOrdinal("ROL")),
            };
            var domain = Convert.ToInt32(reader.GetValue(reader.GetOrdinal("DOMINIO")));
            if (domain == 1)
            {
                // La validación contra Active Directory se incorpora en la siguiente etapa.
                return null;
            }

            var secureKey = ReadString(reader, "CLAVE_SEGURA");

            return new LoginResponseDto(GenerateToken(user, secureKey != "1"), new UserResponseDto(
                user.UserId,
                user.UserName,
                user.UserName,
                user.Role,
                ReadString(reader, "ESTADO"),
                ReadString(reader, "DOMINIOP"),
                domain),
                secureKey != "1");
        }
        finally
        {
            await dbContext.Database.CloseConnectionAsync();
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