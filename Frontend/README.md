# SistemaInventario

Frontend Angular y API ASP.NET Core para autenticación y gestión de inventario con Oracle.

## Requisitos para ejecutar el proyecto

- Node.js compatible con Angular 22 y npm.
- .NET 8 SDK.
- Acceso de red (y VPN, si aplica) al servidor Oracle y credenciales autorizadas.
- Para autenticar usuarios de dominio, ejecutar la API en Windows con acceso al Active Directory correspondiente.

`npm install` instala únicamente las dependencias del frontend. No instala ni inicia la API, no configura Oracle y no da acceso a la base de datos.

## Contraseña local de Oracle

Los datos de conexión no secretos están configurados en `Backend\SistemaInventario.Api\appsettings.json`. La contraseña no se guarda en Git. La API arranca aunque no esté configurada; para iniciar sesión y consultar Oracle, `ORACLE_PASSWORD` debe existir en las variables de entorno del usuario que ejecuta la API.

Configúrala una sola vez en las variables de entorno de usuario de Windows; las terminales nuevas la heredarán y no habrá que escribirla cada vez. Si aún no está configurada, puedes establecerla de forma persistente desde PowerShell; Windows te pedirá la contraseña sin mostrarla:

```powershell
$securePassword = Read-Host "Contraseña Oracle" -AsSecureString
$credential = [PSCredential]::new("oracle", $securePassword)
[Environment]::SetEnvironmentVariable("ORACLE_PASSWORD", $credential.GetNetworkCredential().Password, "User")
```

Después, cierra y vuelve a abrir la terminal y ejecuta la API normalmente. Cada persona que clone el repositorio debe configurar sus propias credenciales autorizadas. No guardes una contraseña real en archivos versionados.

La API espera que ya existan en Oracle las tablas y datos de la aplicación, incluidos `USUARIOS` y `USUARIO_MODULOS`; no crea ni modifica el esquema. La autenticación de usuarios de dominio también requiere que el servidor de API pueda comunicarse con Active Directory.

## Instalar y ejecutar

Desde la raíz del repositorio, en dos terminales:

Terminal 1, API:

```powershell
Set-Location Backend\SistemaInventario.Api
dotnet restore
dotnet run --launch-profile http
```

La API queda en `http://localhost:5074` y Swagger en `http://localhost:5074/swagger`.

Terminal 2, frontend:

```powershell
Set-Location Frontend
npm ci
npm start
```

Abre `http://localhost:4200/login`. El proxy de Angular redirige las peticiones `/api` a la API en `http://localhost:5074`.

## Validación

Desde la raíz del repositorio:

```powershell
dotnet build Backend\SistemaInventario.Api\SistemaInventario.Api.csproj
Set-Location Frontend
npm run build
npm test -- --watch=false --no-progress
```
