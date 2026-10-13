using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using SistemaInventario.Api.Data;
using SistemaInventario.Api.Services;
using SistemaInventario.Api.Swagger;

// Punto de entrada de la API. Aquí se conectan configuración, Oracle, servicios,
// autenticación JWT, CORS y el pipeline HTTP que atiende al frontend.
var builder = WebApplication.CreateBuilder(args);

const string AngularCorsPolicy = "AngularCorsPolicy";

// Habilita controladores para exponer endpoints, Swagger para probarlos y EF Core
// para administrar la conexión compartida con Oracle.
builder.Services.AddControllers();
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
// La cadena completa se configura en appsettings.json o en el archivo
// específico del entorno, por ejemplo appsettings.Development.json.
var oracleConnection = builder.Configuration.GetConnectionString("OracleConnection");
if (string.IsNullOrWhiteSpace(oracleConnection))
{
    throw new InvalidOperationException(
        "Falta configurar ConnectionStrings:OracleConnection en appsettings.json.");
}

// Registra servicios que concentran reglas y SQL de cada módulo, manteniendo los
// controladores enfocados en HTTP y validaciones básicas.
builder.Services.AddDbContext<InventoryDbContext>(options =>
    options.UseOracle(oracleConnection));
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IAdminService, AdminService>();
builder.Services.AddScoped<IModulePermissionService, ModulePermissionService>();
builder.Services.AddScoped<ITallerService, TallerService>();
builder.Services.AddScoped<IAuthorizationHandler, ModuleAccessAuthorizationHandler>();

// Configura la validación JWT. Los claims del token identifican al usuario y sus
// roles para que cada endpoint pueda decidir qué operaciones permite.
var jwtKey = builder.Configuration["Jwt:Key"];
if (string.IsNullOrWhiteSpace(jwtKey))
{
    if (!builder.Environment.IsDevelopment())
    {
        throw new InvalidOperationException(
            "Falta configurar Jwt:Key mediante la configuración del entorno (por ejemplo, Jwt__Key).");
    }

    jwtKey = "SistemaInventarioLocalDevelopmentKey1234567890";
}

if (jwtKey.Length < 32)
{
    throw new InvalidOperationException("Jwt:Key debe tener al menos 32 caracteres.");
}

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
    policy.WithOrigins("http://localhost:4200", "http://127.0.0.1:4200")
        .AllowAnyHeader()
        .AllowAnyMethod()));

var app = builder.Build();

// La documentación también está disponible en despliegues: /swagger y
// /swagger/v1/swagger.json.
app.UseSwagger();
app.UseSwaggerUI();

// El orden garantiza CORS, autenticación y autorización antes de ejecutar controladores.
app.UseCors(AngularCorsPolicy);
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();
