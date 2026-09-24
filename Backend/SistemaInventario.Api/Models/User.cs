namespace SistemaInventario.Api.Models;

// Representación mínima de USUARIOS usada para generar claims JWT.
public sealed class User
{
    public int UserId { get; set; }
    public string UserName { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
}