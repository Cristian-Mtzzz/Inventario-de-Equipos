# SistemaInventario

Frontend Angular y API ASP.NET Core para autenticación y gestión de inventario con Oracle.

## Requisitos para ejecutar el proyecto

- Node.js compatible con Angular 22 y npm.
- .NET 8 SDK.
- Acceso de red (y VPN, si aplica) al servidor Oracle, credenciales autorizadas y el archivo `tnsnames.ora` que define el alias `HIHSS_APP`.
- Para autenticar usuarios de dominio, ejecutar la API en Windows con acceso al Active Directory correspondiente.

`npm install` instala únicamente las dependencias del frontend. No instala ni inicia la API, no configura Oracle y no da acceso a la base de datos.

## Configuración local de Oracle

Después de clonar el repositorio, crea `Backend\SistemaInventario.Api\appsettings.Development.json`. El archivo está excluido de Git; cada desarrollador debe configurarlo en su equipo:

```json
{
  "ConnectionStrings": {
    "OracleConnection": "User Id=USUARIO;Password=CONTRASENA;Data Source=HIHSS_APP"
  },
  "Oracle": {
    "TnsAdmin": "C:\\ruta\\a\\la\\carpeta\\de\\Oracle"
  }
}
```

Reemplaza `USUARIO`, `CONTRASENA` y la ruta por valores proporcionados de forma segura por el administrador. La carpeta `TnsAdmin` debe contener `tnsnames.ora` con una entrada `HIHSS_APP`. No subas este archivo ni publiques credenciales.

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
