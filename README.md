# Inventario de Equipos

Sistema web del IHSS para llevar el inventario de equipos de cómputo: registro de dispositivos, asignación a empleados, reasignaciones, control del taller de reparaciones y administración de usuarios.

- **Backend:** ASP.NET Core 8 (API REST) con Oracle y autenticación JWT.
- **Frontend:** Angular 22.


## Módulos

| Pestaña | Para qué sirve |
| --- | --- |
| **Dispositivos** | Alta, edición y baja de equipos; asignación a empleados (individual o por combo); carga masiva desde Excel (`.xlsx`) y reportes. |
| **Reasignaciones** | Cambio de responsable de un equipo con su motivo; historial y reporte con los nombres de quien entrega y quien recibe. |
| **Taller** | Recepción de equipos para reparación, asignación de técnico, dictamen, piezas sustituidas y entrega al cliente; reporte del taller. |
| **Mantenimiento** | Catálogos del sistema: regionales y tipos de dispositivos. |
| **Usuarios** | Alta y edición de usuarios del sistema, su rol y los módulos a los que tienen acceso. |

Las tablas tienen búsqueda y paginación, y cada módulo genera sus reportes en Excel.

## Usuarios, roles y permisos

Cada usuario tiene un **rol**, que decide a qué panel entra, y una lista de **módulos** que habilitan las pestañas que ve.

| Rol | Entra a |
| --- | --- |
| `Admin` | Panel administrativo (`/admin`) |
| `UsuarioComun` | Panel de usuario (`/usuario`), con las pestañas de sus módulos |
| `Taller`, `AdminTaller` | Administración del taller (`/taller`) |
| `RecepcionTaller` | Recepción de equipos en el taller (`/taller/recepcion`) |
| `TecnicoTaller` | Reparaciones asignadas al técnico (`/taller/tecnico`) |

Los módulos son: `DISPOSITIVOS`, `REASIGNACIONES`, `TALLER`, `MANTENIMIENTO`, `USUARIOS` e `INVENTARIO`. El módulo `ADMIN_TOTAL` da acceso a todo.

### Inicio de sesión

- **Usuarios locales:** la contraseña se guarda con BCrypt en `USUARIOS.PASSWORD_HASH`. La primera vez se obliga a cambiarla. Las contraseñas antiguas (formato `ORA_HASH`) siguen funcionando y se convierten a BCrypt la próxima vez que el usuario inicia sesión.
- **Intentos fallidos:** tras `Security:LoginMaxFailedAttempts` fallos seguidos (5) el usuario queda bloqueado `Security:LoginLockoutMinutes` minutos (15), sin consultar Active Directory para no bloquear también su cuenta de dominio. Además, cada equipo puede intentar `Security:LoginRequestsPerMinutePerIp` veces por minuto (20). Los bloqueos viven en memoria: reciclar el grupo de aplicaciones de la API los borra.
- **Acceso total:** solo un usuario con `ADMIN_TOTAL` puede otorgarlo, quitarlo o editar, restablecer o eliminar a otro usuario que lo tenga. No se puede quitar al último.
- **Usuarios de dominio:** se validan contra Active Directory en los dominios `BA`, `HE`, `HRN` e `IVM`. Se aceptan `usuario`, `BA\usuario` o `usuario@dominio`, sin importar mayúsculas. Para esto, la API debe ejecutarse en Windows con acceso al AD.
- La sesión se cierra tras **30 minutos de inactividad**. El token se renueva solo mientras el usuario está activo; cada renovación vuelve a leer `USUARIOS`, así que un usuario desactivado o expirado pierde la sesión en la siguiente renovación y un cambio de rol se aplica ahí mismo.

## Estructura del repositorio

```
Backend/SistemaInventario.Api/
├── Controllers/      Endpoints HTTP (auth, dispositivos, reasignaciones, taller, usuarios, catálogos, empleados)
├── Services/         Reglas de negocio y SQL de cada módulo; roles y permisos por módulo
├── Models/           DTO de entrada y salida
├── Data/             DbContext y acceso a Oracle
├── Infrastructure/   Manejo global de errores, cabeceras de seguridad y límite de intentos de login
├── appsettings.json  Configuración (ver abajo)
└── web.config        Configuración para IIS (desactiva WebDAV, quita X-Powered-By)

Frontend/
├── public/           logo.png y favicon.png
└── src/
    ├── web.config    Configuración de IIS: rutas de Angular con URL Rewrite, cabeceras de seguridad y regla HTTPS (se copia al build)
    └── app/
        ├── auth/       Login, cambio de contraseña, sesión, guardas e interceptor JWT
        ├── admin/      Panel administrativo: dispositivos, reasignaciones, catálogos, usuarios, importación y reportes
        ├── inventory/  Panel de usuario común
        ├── taller/     Recepción, administración y técnico del taller
        ├── shared/     Encabezado, paginador, validación de solo dígitos y utilidades
        └── api-url.ts  Ruta base de la API
```

## Requisitos

- .NET 8 SDK.
- Node.js compatible con Angular 22, y npm.
- Acceso de red (y VPN, si aplica) al servidor Oracle, con credenciales autorizadas.
- Windows con acceso al Active Directory, para probar el login de usuarios de dominio.

## Configuración

La API se configura en `Backend/SistemaInventario.Api/appsettings.json`. Para desarrollo local puedes sobrescribir valores en `appsettings.Development.json`.

| Clave | Descripción |
| --- | --- |
| `ConnectionStrings:OracleConnection` | Cadena de conexión a Oracle: `User Id=...;Password=...;Data Source=SERVIDOR:1521/SERVICIO`. |
| `Jwt:Key` | Clave para firmar los tokens. Debe ser larga y secreta. |
| `Jwt:Issuer` / `Jwt:Audience` | Emisor y audiencia del token. Deben coincidir entre emisión y validación. |
| `Jwt:ExpirationMinutes` | Vigencia del token (35 por defecto). |
| `Hosting:ApiBaseUrl` | URL pública de la API. De su ruta sale el directorio virtual de IIS (`/ApiInventariosTic`). |
| `Hosting:FrontendBaseUrl` | URL pública del frontend. Se agrega a los orígenes permitidos por CORS. |
| `Hosting:RequireHttps` | `true` redirige HTTP a HTTPS y envía HSTS. Déjalo en `false` hasta que IIS tenga certificado (ver [HTTPS](#https)). |
| `Security:LoginMaxFailedAttempts` / `Security:LoginLockoutMinutes` | Fallos seguidos que bloquean a un usuario y minutos que dura el bloqueo (5 y 15). |
| `Security:LoginRequestsPerMinutePerIp` | Intentos de login por minuto desde un mismo equipo (20). |
| `Taller:TecnicoRecepcion` | Técnico al que se asignan por defecto los equipos recibidos en el taller. Acepta el login (`frank.midence`) o el nombre de la persona (`Frank Midence`), sin importar mayúsculas; el usuario debe estar activo, vigente y tener rol `TecnicoTaller`. |
| `Taller:NombreTecnicoRecepcion` | Nombre que se guarda como técnico cuando el usuario anterior no se encuentra en `USUARIOS` o perdió el rol. El formulario de recepción no muestra este dato, así que sin esta clave quedaría como `Sin asignar`. |

> No subas contraseñas ni claves reales en documentación o capturas.

### Scripts de base de datos

Los cambios de esquema que necesita la aplicación están en `docs/sql/`. Se corren una vez
contra Oracle con el usuario del sistema y se pueden repetir sin efecto.

| Script | Para qué |
| --- | --- |
| `reparacion-datos-equipo.sql` | Da a `REPARACION` sus propias columnas del equipo (`CODIGO_INVENTARIO`, `NO_SERIE`, `MARCA`, `MODELO`, `TIPO_DISPOSITIVO`) y vuelve opcional `ID_EQUIPO`, para que la recepción del taller no registre el equipo en Dispositivos. |
| `roles-modulos-nuevos.sql` | Agrega a las restricciones `CHECK` de `USUARIOS` y `USUARIO_MODULOS` el rol `AdminTicket` y los módulos `EMPLEADOS` y `TICKETS`. Sin esto, crear un usuario con esos valores falla. |
| `tickets-soporte.sql` | Crea la tabla `TICKETS_SOPORTE` del módulo Tickets de soporte. |
| `tickets-config.sql` | Crea `TICKETS_CONFIG` con los minutos en que un ticket pendiente pasa de verde a amarillo y de amarillo a rojo. Para cambiarlos basta un `UPDATE` sobre esa tabla. |

Los archivos `diagnostico-*.sql` no cambian nada: son consultas de apoyo para revisar datos.

En el frontend, la ruta de la API está en `Frontend/src/app/api-url.ts` (`/ApiInventariosTic/api/`). Si cambia el nombre de la aplicación de la API en IIS, actualiza ese archivo y vuelve a compilar.

## Ejecutar en desarrollo

En dos terminales, desde la raíz del repositorio.

**API**

```powershell
Set-Location Backend\SistemaInventario.Api
dotnet restore
dotnet run --launch-profile http
```

La API queda en `http://localhost:5074` y Swagger en `http://localhost:5074/swagger`.

**Frontend**

```powershell
Set-Location Frontend
npm ci
npm start
```

Abre `http://localhost:4200/login`. El proxy de Angular redirige las peticiones `/api` a `http://localhost:5074`, así que no hace falta tocar la configuración de la API.

Después de cambiar código del backend, **reinicia la API**: una instancia que ya estaba corriendo sigue usando el código anterior.

### Swagger

- Local: `http://localhost:5074/swagger`
- Servidor: `http://10.1.22.55/ApiInventariosTic/swagger`

Para probar rutas protegidas, haz login en `POST /api/auth/login`, copia el `Token` de la respuesta, pulsa **Authorize** y pégalo sin anteponer `Bearer `.

## Publicar en IIS

IIS ya debe tener instalados el **ASP.NET Core Module (ANCM)** y **URL Rewrite**, y las aplicaciones `/ApiInventariosTic` e `/InventariosTic` deben estar creadas. La publicación no instala ni configura nada de IIS.

### API

Desde `Backend\SistemaInventario.Api`:

```powershell
dotnet publish -c Release -r win-x64 --self-contained true
```

Copia **todo** el contenido de `bin\Release\net8.0\win-x64\publish` al directorio físico de `/ApiInventariosTic`. Si una instancia anterior sigue en ejecución, recicla el grupo de aplicaciones de la API; no hace falta reiniciar todo IIS.

### Frontend

Desde `Frontend`, **en PowerShell**:

```powershell
ng build --configuration production --base-href /InventariosTic/
```

> En Git Bash, la ruta `/InventariosTic/` se convierte en `C:/Program Files/Git/InventariosTic/` y la aplicación queda en blanco. Usa PowerShell o CMD.

Copia el contenido de `dist\SistemaInventario\browser` (no la carpeta `dist` completa) al directorio de `/InventariosTic`. El `web.config` incluido hace que recargar la página o abrir un enlace directo (por ejemplo `/InventariosTic/admin`) funcione en lugar de dar 404; requiere el módulo URL Rewrite.

### HTTPS

La aplicación está preparada para HTTPS, pero viene desactivado porque el servidor todavía no tiene certificado. Para activarlo:

1. En IIS, instala el certificado y agrega al sitio un enlace `https` (puerto 443).
2. En el `appsettings.json` de la API pon `Hosting:RequireHttps` en `true` y cambia `Hosting:FrontendBaseUrl` y `Hosting:ApiBaseUrl` a `https://...`.
3. En `Frontend/src/web.config` cambia la regla `Forzar HTTPS` a `enabled="true"`.
4. Publica la API y el frontend **juntos**. Si solo uno de los dos fuerza HTTPS, las llamadas a la API pierden el token y la sesión se cierra.

> Activar los pasos 2 o 3 sin el certificado del paso 1 deja la aplicación sin acceso.

### Cabeceras de seguridad

La API agrega `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y `Cache-Control: no-store` (Swagger queda sin CSP para que cargue su página). El frontend las define en su `web.config`. La CSP del frontend solo permite scripts propios, por eso `angular.json` desactiva `inlineCritical`: esa optimización carga los estilos con un `onload` en línea que la CSP bloquearía y la aplicación se vería sin estilos.

### Logo e ícono

`Frontend/public/logo.png` es el logo de los encabezados y `Frontend/public/favicon.png` el ícono de la pestaña. Si reemplazas el favicon, sube el número de versión en `Frontend/src/index.html` (`favicon.png?v=2` → `?v=3`) para que los navegadores no sigan mostrando el anterior.

## Solución de problemas

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| 404 al recargar una página del frontend | Falta URL Rewrite o el `web.config` del frontend | Instala URL Rewrite y verifica que `web.config` se copió con el build. |
| 405 en operaciones de editar o eliminar | WebDAV intercepta PUT/DELETE | Verifica que el `web.config` publicado de la API sea el del proyecto. |
| 500.30 al abrir la API | La aplicación falla al arrancar (configuración, Oracle...) | En el `web.config` publicado pon `stdoutLogEnabled="true"`, crea la carpeta `logs` con permiso de escritura y revisa el log. |
| 500.31 | ANCM no está instalado | Instala el Hosting Bundle de .NET 8 en el servidor. |
| 503 al iniciar sesión | Oracle no responde | Revisa la conexión de red/VPN y la cadena de conexión. |
| Un usuario de dominio no puede entrar | AD rechazó las credenciales o el dominio no es válido | El log de la API trae el detalle de AD (`data 52e` contraseña incorrecta, `775` cuenta bloqueada, `532` contraseña vencida). |
| La recepción del taller deja el técnico "Sin asignar" | `Taller:TecnicoRecepcion` no coincide con un técnico activo | Revisa que el login o el nombre coincida con un usuario activo con rol `TecnicoTaller` y reinicia la API. |
| La página queda en blanco en el servidor | Build sin `--base-href /InventariosTic/`, o hecho desde Git Bash | Vuelve a compilar desde PowerShell con el comando de arriba. |

## Validación

Desde la raíz del repositorio:

```powershell
dotnet build Backend\SistemaInventario.Api\SistemaInventario.Api.csproj
Set-Location Frontend
npm run build
npm test -- --watch=false --no-progress
```
