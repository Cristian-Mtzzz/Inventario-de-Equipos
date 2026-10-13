# SistemaInventario

Frontend Angular y API ASP.NET Core para autenticación y gestión de inventario con Oracle.

## Requisitos para ejecutar el proyecto

- Node.js compatible con Angular 22 y npm.
- .NET 8 SDK.
- Acceso de red (y VPN, si aplica) al servidor Oracle y credenciales autorizadas.
- Para autenticar usuarios de dominio, ejecutar la API en Windows con acceso al Active Directory correspondiente.

`npm install` instala únicamente las dependencias del frontend. No instala ni inicia la API, no configura Oracle y no da acceso a la base de datos.

## Conexión local de Oracle

La cadena de conexión completa se configura en `Backend\SistemaInventario.Api\appsettings.Development.json`, un archivo local excluido de Git. Por ejemplo:

```json
{
  "ConnectionStrings": {
    "OracleConnection": "User Id=USUARIO;Password=CONTRASENA;Data Source=SERVIDOR:1521/SERVICIO"
  }
}
```

ASP.NET Core carga este archivo automáticamente cuando `ASPNETCORE_ENVIRONMENT` está en `Development`. Cada instalación debe completar la cadena con las credenciales y el servicio Oracle autorizados. No se requiere la variable `ORACLE_PASSWORD`.


La API espera que ya existan en Oracle las tablas y datos de la aplicación, incluidos `USUARIOS` y `USUARIO_MODULOS`; no crea ni modifica el esquema. La autenticación de usuarios de dominio también requiere que el servidor de API pueda comunicarse con Active Directory.

En producción configura `Jwt__Key` como variable de entorno con una clave secreta única de al menos 32 caracteres. La clave de desarrollo local solo se usa cuando ASP.NET Core está en el entorno `Development`.

## Instalar y ejecutar

Desde la raíz del repositorio, en dos terminales:

Terminal 1, API:

```powershell
Set-Location Backend\SistemaInventario.Api
dotnet restore
dotnet run --launch-profile http
```

La API queda en `http://localhost:5074` y Swagger en `http://localhost:5074/swagger`.

En el servidor, Swagger queda disponible en `http://10.1.22.55/ApiInventariosTic/swagger` y el documento OpenAPI en `http://10.1.22.55/ApiInventariosTic/swagger/v1/swagger.json`. Para probar rutas protegidas desde Swagger UI, usa **Authorize** e ingresa el JWT recibido en `/api/auth/login` sin anteponer `Bearer `.

El build de producción configura Angular para publicarse bajo `/desInventariosTic/`. La API se publica en la aplicación IIS `/ApiInventariosTic/`, por lo que el frontend envía sus solicitudes a `/ApiInventariosTic/api`. Comprueba la disponibilidad de la API en `http://10.1.22.55/ApiInventariosTic/api/health`. Si cambia la ruta virtual de la API, actualiza `API_BASE_PATH` en `Frontend/src/app/api-url.ts`.

Para que IIS lea la cadena Oracle, establece `ASPNETCORE_ENVIRONMENT=Development` en la configuración de la aplicación IIS y publica la API desde el equipo que tiene `appsettings.Development.json`. Verifica que el archivo quede junto a la DLL publicada; al no estar en Git, una publicación hecha desde un clon limpio no lo tendrá. Después de copiar la publicación al servidor, reinicia la aplicación IIS.

Terminal 2, frontend:

```powershell
Set-Location Frontend
npm ci
npm start
```

Abre `http://localhost:4200/login`. En desarrollo, el proxy de Angular redirige las peticiones `/api` a la API en `http://localhost:5074`.

## Validación

Desde la raíz del repositorio:

```powershell
dotnet build Backend\SistemaInventario.Api\SistemaInventario.Api.csproj
Set-Location Frontend
npm run build
npm test -- --watch=false --no-progress
```
