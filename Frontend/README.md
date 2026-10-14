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

Tanto la conexión a Oracle como la clave JWT están configuradas directamente en `Backend\SistemaInventario.Api\appsettings.json`, por lo que no se requiere configurar variables de entorno en el servidor ni archivos de secretos separados.

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

El build de producción configura el `base href` `/desInventariosTic/` en `Frontend\angular.json`. El frontend llama a `/ApiInventariosTic/api/`, definido en `Frontend\src\app\api-url.ts`; el proxy de desarrollo redirige esa ruta a `http://localhost:5074`. Si cambia alguna ruta virtual, actualiza estos valores en los archivos existentes y vuelve a compilar el frontend. Comprueba la API en `http://10.1.22.55/ApiInventariosTic/api/health`.

En desarrollo, `npm start` usa el proxy de Angular en `/api` hacia `http://localhost:5074`; no requiere cambiar `appsettings.json`.

### Publicar la API para IIS

Desde `Backend\SistemaInventario.Api`, genera una publicación autocontenida de 64 bits:

```powershell
dotnet publish -c Release -p:PublishIIS=true
```

El resultado queda en `bin\Release\net8.0\win-x64\publish`. Copia **todo** su contenido al directorio físico que IIS ya tiene asignado a `/ApiInventariosTic/`. El proyecto compila la API con el runtime de .NET 8 y genera la configuración IIS para ejecutar la API fuera del proceso de IIS (`OutOfProcess`), integrado directamente en el archivo `.csproj` sin requerir perfiles `.pubxml` externos ni scripts adicionales.

La publicación no puede instalar el módulo ASP.NET Core de IIS (ANCM), crear la aplicación IIS ni cambiar su directorio físico o grupo de aplicaciones. Esos requisitos deben existir previamente y no pueden resolverse desde `dotnet publish` si no tienes permisos de administración. Si ANCM no está instalado, un paquete autocontenido tampoco elimina el error 500.31. La primera solicitud después de copiar los archivos normalmente hace que IIS inicie la aplicación; reciclar el grupo dedicado a esta API puede ser necesario para reemplazar una instancia que siga ejecutándose, pero no hace falta reiniciar todo IIS.



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
