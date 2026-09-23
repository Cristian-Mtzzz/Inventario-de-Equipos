export type UserRole = 'Admin' | 'UsuarioComun' | 'Taller';

export interface LoginRequest {
  UserName: string;
  Password: string;
}

export interface AuthUser {
  UserId: number | string;
  UserName: string;
  FullName: string;
  Role: UserRole;
}

export interface LoginResponse {
  Token: string;
  User: AuthUser;
}