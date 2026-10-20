using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using SistemaInventario.Api.Data;
using SistemaInventario.Api.Infrastructure;
using SistemaInventario.Api.Services;
using SistemaInventario.Api.Swagger;

// Punto de entrada de la API. Aquí se conectan configuración, Oracle, servicios,
// autenticación JWT, CORS y el pipeline HTTP que atiende al frontend.
var builder = WebApplication.CreateBuilder(args);

const string AngularCorsPolicy = "AngularCorsPolicy";

// Habilita controladores para exponer endpoints, Swagger para probarlos y EF Core
// para administrar la conexión compartida con Oracle.
// Las respuestas JSON conservan los nombres en PascalCase de los DTO (IdEquipo, Message...),
// que es el formato que usan los modelos del frontend.
builder.Services.AddControllers()
    .AddJsonOptions(options => options.JsonSerializerOptions.PropertyNamingPolicy = null);
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.PropertyNamingPolicy = null);
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<ApiExceptionHandler>();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "SistemaInventario API",
        Version = "v1",
    });
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Ingresa el token JWT obtenido desde /api/auth/login.",
    });
    options.OperationFilter<AuthorizeCheckOperationFilter>();
});
// La cadena de conexión completa está configurada directamente en appsettings.json.
var oracleConnection = builder.Configuration.GetConnectionString("OracleConnection")
    ?? "User Id=TRANSACIONES_SOPORTE;Data Source=exd01-scan.corp.ihss.hn:1521/BDIHSS;Password=ts26ihss*";

// Registra servicios que concentran reglas y SQL de cada módulo, manteniendo los
// controladores enfocados en HTTP y validaciones básicas.
builder.Services.AddDbContext<InventoryDbContext>(options =>
    options.UseOracle(oracleConnection));
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IDeviceService, DeviceService>();
builder.Services.AddScoped<ICatalogService, CatalogService>();
builder.Services.AddScoped<IEmployeeService, EmployeeService>();
builder.Services.AddScoped<IReassignmentService, ReassignmentService>();
builder.Services.AddScoped<IUserAdminService, UserAdminService>();
builder.Services.AddScoped<IModulePermissionService, ModulePermissionService>();
builder.Services.AddScoped<ITallerService, TallerService>();
builder.Services.AddScoped<IAuthorizationHandler, ModuleAccessAuthorizationHandler>();

var allowedOrigins = new List<string>
{
    "http://localhost:4200",
    "http://127.0.0.1:4200",
    "http://10.1.22.55"
};

var frontendBaseUrl = builder.Configuration["Hosting:FrontendBaseUrl"];
if (!string.IsNullOrWhiteSpace(frontendBaseUrl)
    && Uri.TryCreate(frontendBaseUrl, UriKind.Absolute, out var frontendUri)
    && (frontendUri.Scheme == Uri.UriSchemeHttp || frontendUri.Scheme == Uri.UriSchemeHttps))
{
    allowedOrigins.Add(frontendUri.GetLeftPart(UriPartial.Authority));
}

var apiBaseUrl = builder.Configuration["Hosting:ApiBaseUrl"];
if (!string.IsNullOrWhiteSpace(apiBaseUrl)
    && Uri.TryCreate(apiBaseUrl, UriKind.Absolute, out var apiUri)
    && (apiUri.Scheme == Uri.UriSchemeHttp || apiUri.Scheme == Uri.UriSchemeHttps))
{
    allowedOrigins.Add(apiUri.GetLeftPart(UriPartial.Authority));
}

// Configura la validación JWT. Los claims del token identifican al usuario y sus
// roles para que cada endpoint pueda decidir qué operaciones permite.
var jwtKey = builder.Configuration["Jwt:Key"] ?? "SistemaInventarioSecretKey_2026_IHSS_InventarioEquipos";

var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "SistemaInventario.Api";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "SistemaInventario.Web";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.Zero,
        };
    });
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("PasswordChange", policy => policy.RequireAuthenticatedUser());
    options.AddPolicy(ModulePolicies.AdminPanel, policy => policy.Requirements.Add(
        new ModuleAccessRequirement(AppModules.AdminPanel)));
    options.AddPolicy(ModulePolicies.Inventory, policy => policy.Requirements.Add(
        new ModuleAccessRequirement(AppModules.Inventory)));
    options.AddPolicy(ModulePolicies.Workshop, policy => policy.Requirements.Add(
        new ModuleAccessRequirement(AppModules.Workshop)));
    options.AddPolicy(ModulePolicies.Users, policy => policy.Requirements.Add(
        new ModuleAccessRequirement(AppModules.Users)));
    options.AddPolicy(ModulePolicies.Maintenance, policy => policy.Requirements.Add(
        new ModuleAccessRequirement(AppModules.Maintenance)));
    options.AddPolicy(ModulePolicies.Devices, policy => policy.Requirements.Add(
        new ModuleAccessRequirement(AppModules.Devices, AppModules.Inventory)));
    options.AddPolicy(ModulePolicies.Reassignments, policy => policy.Requirements.Add(
        new ModuleAccessRequirement(AppModules.Reassignments, AppModules.Inventory)));
    options.AddPolicy(ModulePolicies.DeviceSupport, policy => policy.Requirements.Add(
        new ModuleAccessRequirement(AppModules.Devices, AppModules.Inventory, AppModules.Reassignments, AppModules.Workshop)));
    options.AddPolicy(ModulePolicies.AssignmentSupport, policy => policy.Requirements.Add(
        new ModuleAccessRequirement(AppModules.Devices, AppModules.Inventory, AppModules.Reassignments)));
    options.AddPolicy(ModulePolicies.LocationCatalogs, policy => policy.Requirements.Add(
        new ModuleAccessRequirement(AppModules.Devices, AppModules.Inventory, AppModules.Reassignments,
            AppModules.Workshop, AppModules.Maintenance)));
    options.AddPolicy(ModulePolicies.SuperAdmin, policy => policy.Requirements.Add(
        new ModuleAccessRequirement(AppModules.SuperAdmin)));
    options.DefaultPolicy = new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .RequireAssertion(context => !context.User.HasClaim("must_change_password", "true"))
        .Build();
});
builder.Services.AddCors(options => options.AddPolicy(AngularCorsPolicy, policy =>
    policy.WithOrigins(allowedOrigins.Distinct().ToArray())
        .AllowAnyHeader()
        .AllowAnyMethod()));

var app = builder.Build();

// Convierte cualquier excepción no controlada en una respuesta { Message } con su código HTTP.
app.UseExceptionHandler();

// Soporte para subaplicaciones o directorios virtuales en IIS (ej. /ApiInventariosTic).
if (!string.IsNullOrWhiteSpace(apiBaseUrl)
    && Uri.TryCreate(apiBaseUrl, UriKind.Absolute, out var configuredApiUri))
{
    var pathBase = configuredApiUri.AbsolutePath.TrimEnd('/');
    if (pathBase.EndsWith("/api", StringComparison.OrdinalIgnoreCase))
    {
        pathBase = pathBase[..^4];
    }

    if (!string.IsNullOrWhiteSpace(pathBase) && pathBase != "/")
    {
        app.UsePathBase(pathBase);
    }
}

// La documentación también está disponible en despliegues: /swagger y /swagger/v1/swagger.json.
// Usar endpoint relativo permite que funcione tanto en la raíz como bajo subdirectorios de IIS.
app.UseSwagger();
app.UseSwaggerUI(options =>
{
    options.SwaggerEndpoint("./v1/swagger.json", "SistemaInventario API v1");
    options.RoutePrefix = "swagger";
});

// El orden garantiza CORS, autenticación y autorización antes de ejecutar controladores.
app.UseCors(AngularCorsPolicy);
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapGet("/", () => Results.Redirect("swagger"));
app.MapGet("/api", () => Results.Ok(new
{
    status = "ok",
    service = "SistemaInventario.Api",
    serverTime = DateTime.UtcNow
}));

app.Run();
