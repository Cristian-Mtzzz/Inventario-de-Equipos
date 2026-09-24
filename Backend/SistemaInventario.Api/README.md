# SistemaInventario API

API de autenticacion para el frontend Angular.

## Configuracion segura

No guardes credenciales en `appsettings.json`. Configura User Secrets durante desarrollo:

```powershell
dotnet user-secrets init
dotnet user-secrets set "ConnectionStrings:OracleConnection" "User Id=USUARIO_ORACLE;Password=CONTRASENA;Data Source=HIHSS"
dotnet user-secrets set "Oracle:TnsAdmin" "C:\app\alexander\product\11.2.0\client_1\network\admin"
dotnet user-secrets set "Jwt:Key" "una-clave-local-de-32-caracteres-o-mas"
```

`HIHSS` existe en el archivo `tnsnames.ora` dentro de la carpeta indicada por `Oracle:TnsAdmin`. La conexión usa `Data Source=HIHSS`; no es necesario repetir host, puerto ni service name en la cadena.

## Ejecutar

```powershell
dotnet run --launch-profile http
```

La API queda en `http://localhost:5074`. El frontend Angular usa `proxy.conf.json` y consume `/api/auth/login`.

## Comprobar Oracle

```powershell
Invoke-RestMethod http://localhost:5074/api/health
```

Debe responder `{ "status": "ok", "database": "oracle" }`.

## Tabla existente

La API no ejecuta migraciones ni crea tablas. El mapeo usa la tabla empresarial `USUARIOS` con `ID_USUARIO`, `USUARIO`, `PASSWORD_HASH VARCHAR2(256)` y `ROL`. El nombre de usuario se usa como nombre completo porque la tabla no tiene una columna de nombre descriptivo. La validacion usa la misma expresion existente en Oracle: `ORA_HASH(password, 4294967295) || ORA_HASH(usuario, 4294967295)`.