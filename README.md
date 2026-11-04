# Inventario de Equipos

Sistema web para administrar el inventario de equipos de cómputo de una institución: registro de dispositivos, asignación a empleados, reasignaciones, taller de reparaciones, tickets de soporte y administración de usuarios.

## Tecnologías

- **Backend:** ASP.NET Core 8 (API REST) con Oracle y autenticación JWT.
- **Frontend:** Angular.
- **Reportes:** archivos Excel generados en el navegador.

## Módulos

| Módulo | Para qué sirve |
| --- | --- |
| **Dispositivos** | Carga, edición y descarga de equipos; asignación a empleados, individual o como combo de escritorio (CPU, monitor y teclado); carga masiva desde Excel. |
| **Reasignaciones** | Cambio de responsable de un equipo con su motivo e historial de movimientos. |
| **Taller** | Recepción de equipos para reparación, asignación de técnico, dictamen, piezas sustituidas y entrega. |
| **Tickets** | Solicitudes de soporte: creación, asignación a un técnico, seguimiento por tiempo de espera y cierre con valoración. |
| **Empleados** | Directorio de empleados y su número de pago. |
| **Mantenimiento** | Catálogos: regionales, edificios, departamentos y tipos de dispositivos. |
| **Usuarios** | Usuarios del sistema, su rol y los módulos a los que tienen acceso. |

Las tablas tienen búsqueda, filtros y paginación, y cada módulo exporta sus reportes a Excel.

## Acceso y seguridad

- Cada usuario tiene un **rol**, que define su panel de inicio, y una lista de **módulos**, que define lo que puede ver y hacer. Los permisos se validan en la API en cada solicitud.
- Inicio de sesión con usuarios locales o de directorio activo.
- Contraseñas guardadas con BCrypt y cambio obligatorio de la contraseña inicial.
- Bloqueo temporal por intentos fallidos, con límites configurables desde la base de datos.
- La sesión se cierra por inactividad y se revalida contra la base al renovarse.
- Los técnicos solo ven y atienden las reparaciones y tickets que tienen asignados.

## Estructura

```
Backend/SistemaInventario.Api/   API REST
├── Controllers/                 Endpoints HTTP
├── Services/                    Reglas de negocio y acceso a datos de cada módulo
├── Models/                      Objetos de entrada y salida
├── Data/                        Conexión a Oracle
└── Infrastructure/              Manejo de errores, cabeceras de seguridad y límites de login

Frontend/src/app/                Aplicación Angular
├── auth/                        Inicio de sesión, sesión y permisos
├── admin/                       Dispositivos, reasignaciones, empleados, catálogos, usuarios e importación
├── inventory/                   Panel de inventario
├── taller/                      Taller de reparaciones
├── tickets/                     Tickets de soporte
└── shared/                      Componentes y utilidades comunes
```
