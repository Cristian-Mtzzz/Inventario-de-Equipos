// Códigos de módulo guardados en USUARIO_MODULOS. Deben coincidir con AppModules del backend.
export const AppModules = {
  Devices: 'DISPOSITIVOS',
  Reassignments: 'REASIGNACIONES',
  Workshop: 'TALLER',
  Users: 'USUARIOS',
  Maintenance: 'MANTENIMIENTO',
  Inventory: 'INVENTARIO',
} as const;

export type AppModule = (typeof AppModules)[keyof typeof AppModules];

// Módulos que dan acceso al panel administrativo.
export const ADMIN_PANEL_MODULES: AppModule[] = [
  AppModules.Devices,
  AppModules.Reassignments,
  AppModules.Workshop,
  AppModules.Users,
  AppModules.Maintenance,
];
