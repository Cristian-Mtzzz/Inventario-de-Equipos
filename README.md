# SistemaInventario

Proyecto completo de control de inventario:

- `Frontend`: aplicación Angular.
- `Backend`: API ASP.NET Core y conexión Oracle.

## Ejecutar la API

```powershell
Set-Location Backend/SistemaInventario.Api
dotnet user-secrets init
dotnet user-secrets set "ConnectionStrings:OracleConnection" "User Id=USUARIO;Password=CONTRASENA;Data Source=HIHSS"
dotnet user-secrets set "Oracle:TnsAdmin" "C:\app\alexander\product\11.2.0\client_1\network\admin"
dotnet user-secrets set "Jwt:Key" "una-clave-secreta-de-minimo-32-caracteres"
dotnet run --launch-profile http
```

## Ejecutar Angular

En otra terminal:

```powershell
Set-Location Frontend
npm.cmd start
```

Abre `http://localhost:4200/login`. El proxy de Angular conecta `/api` con `http://localhost:5074`.

## Verificar Oracle

```powershell
Invoke-RestMethod http://localhost:5074/api/health
```

La conexión usa el alias empresarial `HIHSS` definido en `C:\app\alexander\product\11.2.0\client_1\network\admin\tnsnames.ora`. La API usa la tabla existente `USUARIOS` con `ID_USUARIO`, `USUARIO`, `PASSWORD_HASH` y `ROL`. No crea ni modifica tablas. La validación usa `ORA_HASH(password, 4294967295) || ORA_HASH(usuario, 4294967295)`.

## Módulo administrador

Los usuarios con rol `Admin` pueden abrir `http://localhost:4200/admin` para agregar y quitar dispositivos, registrar reasignaciones y agregar o quitar usuarios. Las operaciones están protegidas por JWT y rol `Admin` bajo `/api/admin`.

## Validar ambos proyectos

```powershell
dotnet build Backend/SistemaInventario.Api/SistemaInventario.Api.csproj
Set-Location Frontend
npm.cmd run build
npm.cmd test -- --watch=false --no-progress
```# SistemaInventario

Frontend Angular y API ASP.NET Core para el login contra Oracle.

## Configurar Oracle y JWT

Desde `Backend/SistemaInventario.Api` ejecuta:

```powershell
dotnet user-secrets init
dotnet user-secrets set "ConnectionStrings:OracleConnection" "User Id=INVENTARIO;Password=TU_PASSWORD;Data Source=localhost:1521/XEPDB1"
dotnet user-secrets set "Jwt:Key" "una-clave-local-de-32-caracteres-o-mas"
```

La API no crea ni modifica tablas. Usa la tabla empresarial `USUARIOS` que ya existe en Oracle y consulta `ID_USUARIO`, `USUARIO`, `PASSWORD_HASH` y `ROL`. La verificacion usa `ORA_HASH(password, 4294967295) || ORA_HASH(usuario, 4294967295)`, igual que la actualizacion existente de usuarios.

## Ejecutar en desarrollo

Terminal 1, API:

```powershell
Set-Location Backend/SistemaInventario.Api
dotnet run --launch-profile http
```

Terminal 2, Angular:

```powershell
npm.cmd start
```

Abre `http://localhost:4200/login`. El proxy de Angular redirige `/api` a `http://localhost:5074`.

## Verificar la conexion

```powershell
Invoke-RestMethod http://localhost:5074/api/health
```

Una respuesta correcta es `{ "status": "ok", "database": "oracle" }`. El login usa `POST /api/auth/login` y devuelve un JWT con el usuario y su rol.

## Validacion

```powershell
dotnet build Backend/SistemaInventario.Api/SistemaInventario.Api.csproj
npm.cmd run build
npm.cmd test -- --watch=false --no-progress
```
