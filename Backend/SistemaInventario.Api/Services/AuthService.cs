using System.IdentityModel.Tokens.Jwt;
using System.Data;
using System.Security.Claims;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SistemaInventario.Api.Data;
using SistemaInventario.Api.Models;

namespace SistemaInventario.Api.Services;

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
                SELECT ID_USUARIO, USUARIO, PASSWORD_HASH, ROL
                FROM USUARIOS
                WHERE USUARIO = :userName
                  AND PASSWORD_HASH = ORA_HASH(:password, 4294967295)
                      || ORA_HASH(:userNameForHash, 4294967295)
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
            // Consulta Oracle y construye la respuesta solo cuando las credenciales coinciden.
                UserName = reader.GetString(reader.GetOrdinal("USUARIO")),
                PasswordHash = reader.GetString(reader.GetOrdinal("PASSWORD_HASH")),
                Role = reader.GetString(reader.GetOrdinal("ROL")),
            };

            return new LoginResponseDto(GenerateToken(user), new UserResponseDto(
                user.UserId,
                user.UserName,
                user.UserName,
                user.Role));
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

    private string GenerateToken(User user)
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
}