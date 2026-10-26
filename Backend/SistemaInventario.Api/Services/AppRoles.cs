namespace SistemaInventario.Api.Services;

// Roles almacenados en USUARIOS.ROL. Centraliza los nombres para que controladores,
// validaciones y servicios no repitan cadenas sueltas.
public static class AppRoles
{
    public const string Admin = "Admin";
    public const string UsuarioComun = "UsuarioComun";
    public const string Taller = "Taller";
    public const string AdminTaller = "AdminTaller";
    public const string RecepcionTaller = "RecepcionTaller";
    public const string TecnicoTaller = "TecnicoTaller";
    public const string AdminTicket = "AdminTicket";

    // Combinaciones usadas en [Authorize(Roles = ...)].
    public const string WorkshopManagers = Admin + "," + AdminTaller + "," + Taller;
    public const string WorkshopReception = WorkshopManagers + "," + RecepcionTaller;
    public const string WorkshopTechnicians = WorkshopManagers + "," + TecnicoTaller;
    public const string DeviceViewers = WorkshopManagers + "," + UsuarioComun;
    // El admin de tickets también lee regionales, edificios y departamentos: los usa para
    // filtrar al empleado que solicita el soporte.
    public const string CatalogViewers = DeviceViewers + "," + RecepcionTaller + "," + AdminTicket;

    // Roles del módulo de tickets: el admin crea y asigna, y quien atiende es el mismo
    // técnico de taller, que trabaja en Taller y en Tickets.
    public const string TicketManagers = Admin + "," + AdminTicket;
    public const string TicketUsers = TicketManagers + "," + TecnicoTaller;

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
        Admin, UsuarioComun, Taller, AdminTaller, RecepcionTaller, TecnicoTaller, AdminTicket,
    };

    // El administrador de tickets solo trabaja en ese módulo.
    public static bool IsTicketRole(string role) =>
        role.Equals(AdminTicket, StringComparison.OrdinalIgnoreCase);

    // Roles de taller que solo pueden tener el módulo TALLER.
    public static bool IsRestrictedWorkshopRole(string role) =>
        role.Equals(RecepcionTaller, StringComparison.OrdinalIgnoreCase)
        || role.Equals(TecnicoTaller, StringComparison.OrdinalIgnoreCase);

    public static bool IsWorkshopRole(string role) =>
        IsRestrictedWorkshopRole(role)
        || role.Equals(AdminTaller, StringComparison.OrdinalIgnoreCase)
        || role.Equals(Taller, StringComparison.OrdinalIgnoreCase);
}
