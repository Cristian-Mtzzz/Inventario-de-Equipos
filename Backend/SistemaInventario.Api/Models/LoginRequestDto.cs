using System.ComponentModel.DataAnnotations;

namespace SistemaInventario.Api.Models;

// Credenciales recibidas por el endpoint de autenticación.
public sealed class LoginRequestDto
{
    [Required]
    public string UserName { get; set; } = string.Empty;

    [Required]
    public string Password { get; set; } = string.Empty;
}