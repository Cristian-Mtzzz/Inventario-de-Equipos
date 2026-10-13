# SistemaInventario

Frontend Angular y API ASP.NET Core para autenticación y gestión de inventario con Oracle.

## Requisitos para ejecutar el proyecto

- Node.js compatible con Angular 22 y npm.
- .NET 8 SDK.
- Acceso de red (y VPN, si aplica) al servidor Oracle y credenciales autorizadas.
- Para autenticar usuarios de dominio, ejecutar la API en Windows con acceso al Active Directory correspondiente.

`npm install` instala únicamente las dependencias del frontend. No instala ni inicia la API, no configura Oracle y no da acceso a la base de datos.

## Contraseña local de Oracle

Los datos de conexión no secretos están configurados en `Backend\SistemaInventario.Api\appsettings.json`. Guarda la contraseña en `Backend\SistemaInventario.Api\.env`, que está excluido de Git:

```powershell
ORACLE_PASSWORD=contraseña-proporcionada-por-el-administrador
```

La API carga el archivo automáticamente al arrancar, así que no tienes que volver a escribir la contraseña. Cada persona que clone el repositorio debe crear su propio `.env` y agregar esta linea "ORACLE_PASSWORD="ts26ihss*"


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

En el servidor, Swagger queda disponible en `http://10.1.22.55/desInventariosTic/swagger` y el documento OpenAPI en `http://10.1.22.55/desInventariosTic/swagger/v1/swagger.json`. Para probar rutas protegidas desde Swagger UI, usa **Authorize** e ingresa el JWT recibido en `/api/auth/login` sin anteponer `Bearer `.

El build de producción configura Angular para publicarse bajo `/desInventariosTic/`; las solicitudes del frontend se envían a `/desInventariosTic/api`. Si se publica la aplicación bajo otro prefijo, actualiza `baseHref` en `Frontend/angular.json` para que coincida con la ruta virtual del servidor.

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
