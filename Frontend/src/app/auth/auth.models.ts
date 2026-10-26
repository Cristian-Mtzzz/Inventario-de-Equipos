// Roles reconocidos por el frontend y por las políticas del backend (AppRoles.cs).
// La sesión guardada solo se acepta si el rol del token está en esta lista.
export const USER_ROLES = [
  'Admin',
  'UsuarioComun',
  'Taller',
  'RecepcionTaller',
  'TecnicoTaller',
  'AdminTaller',
  'AdminTicket',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

// Datos que el formulario envía al endpoint de autenticación.
export interface LoginRequest {
  UserName: string;
  Password: string;
}

// Perfil de sesión mantenido en memoria y reconstruido desde los claims del token.
export interface AuthUser {
  UserId: number | string;
  UserName: string;
  FullName: string;
  Role: UserRole;
  Estado: string;
  DominioP: string;
  Dominio: number;
  Modules: string[];
  IsSuperAdmin: boolean;
}

export interface ModuleAccess {
  Modules: string[];
  IsSuperAdmin: boolean;
}

// Respuesta normalizada: token JWT y usuario autenticado.
export interface LoginResponse {
  Token: string;
  User: AuthUser;
  MustChangePassword: boolean;
}