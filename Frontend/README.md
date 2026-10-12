# SistemaInventario

Frontend Angular y API ASP.NET Core para autenticación y gestión de inventario con Oracle.

## Requisitos para ejecutar el proyecto

- Node.js compatible con Angular 22 y npm.
- .NET 8 SDK.
- Acceso de red (y VPN, si aplica) al servidor Oracle y credenciales autorizadas.
- Para autenticar usuarios de dominio, ejecutar la API en Windows con acceso al Active Directory correspondiente.

`npm install` instala únicamente las dependencias del frontend. No instala ni inicia la API, no configura Oracle y no da acceso a la base de datos.

## Contraseña local de Oracle

Los datos no secretos de Oracle ya están configurados en `Backend\SistemaInventario.Api\appsettings.json`. La contraseña no se guarda en Git: cada desarrollador debe configurar la variable de entorno `ORACLE_PASSWORD` en su equipo antes de iniciar la API. Por ejemplo, en PowerShell, solo para la terminal actual:

```powershell
$env:ORACLE_PASSWORD = "CONTRASENA"
```

Reemplaza el valor por la contraseña proporcionada por el administrador. No guardes una contraseña real en archivos versionados, comandos compartidos, ni capturas o registros.

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
