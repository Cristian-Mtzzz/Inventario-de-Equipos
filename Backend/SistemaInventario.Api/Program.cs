using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Oracle.ManagedDataAccess.Client;
using SistemaInventario.Api.Data;
using SistemaInventario.Api.Services;

// Punto de entrada de la API. Aquí se conectan configuración, Oracle, servicios,
// autenticación JWT, CORS y el pipeline HTTP que atiende al frontend.
var builder = WebApplication.CreateBuilder(args);

const string AngularCorsPolicy = "AngularCorsPolicy";

// Habilita controladores para exponer endpoints, Swagger para probarlos y EF Core
// para administrar la conexión compartida con Oracle.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
// La conexión se obtiene desde User Secrets o variables de entorno para cambiar
// de base de datos sin guardar usuarios ni contraseñas en el repositorio.
var oracleConnection = builder.Configuration.GetConnectionString("OracleConnection");
if (string.IsNullOrWhiteSpace(oracleConnection))
{
    throw new InvalidOperationException(
        "Falta configurar ConnectionStrings:OracleConnection mediante User Secrets o una variable de entorno.");
}

var tnsAdmin = builder.Configuration["Oracle:TnsAdmin"];
if (!string.IsNullOrWhiteSpace(tnsAdmin))
{
    OracleConfiguration.TnsAdmin = tnsAdmin;
}

// Registra servicios que concentran reglas y SQL de cada módulo, manteniendo los
// controladores enfocados en HTTP y validaciones básicas.
builder.Services.AddDbContext<InventoryDbContext>(options =>
    options.UseOracle(oracleConnection));
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IAdminService, AdminService>();
builder.Services.AddScoped<ITallerService, TallerService>();

// Configura la validación JWT. Los claims del token identifican al usuario y sus
// roles para que cada endpoint pueda decidir qué operaciones permite.
var jwtKey = builder.Configuration["Jwt:Key"] ?? "SistemaInventarioLocalDevelopmentKey1234567890";
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
builder.Services.AddAuthorization();
builder.Services.AddCors(options => options.AddPolicy(AngularCorsPolicy, policy =>
    policy.WithOrigins("http://localhost:4200", "http://127.0.0.1:4200")
        .AllowAnyHeader()
        .AllowAnyMethod()));

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// El orden garantiza CORS, autenticación y autorización antes de ejecutar controladores.
app.UseCors(AngularCorsPolicy);
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();
