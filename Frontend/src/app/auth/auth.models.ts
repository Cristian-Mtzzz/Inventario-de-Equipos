// Roles reconocidos por el frontend y por las políticas del backend.
export type UserRole = 'Admin' | 'UsuarioComun' | 'Taller';

// Datos que el formulario envía al endpoint de autenticación.
export interface LoginRequest {
  UserName: string;
  Password: string;
}

// Perfil almacenado en localStorage y utilizado por guards y redirecciones.
export interface AuthUser {
  UserId: number | string;
  UserName: string;
  FullName: string;
  Role: UserRole;
}

// Respuesta normalizada: token JWT y usuario autenticado.
export interface LoginResponse {
  Token: string;
  User: AuthUser;
}