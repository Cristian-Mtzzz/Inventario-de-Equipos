import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { BehaviorSubject, Observable, map, tap } from 'rxjs';
import { AuthUser, LoginRequest, LoginResponse, ModuleAccess, UserRole } from './auth.models';

const WELCOME_TOAST_DURATION_MS = 2000;

const API_AUTH_URL = '/api/auth';
const AUTH_TOKEN_KEY = 'sistema_inventario_token';
const AUTH_USER_KEY = 'sistema_inventario_user';

// Centraliza la sesión del navegador: envía credenciales, guarda el Json Web Tokens, expone
// el usuario actual y ofrece comprobaciones reutilizables de autenticación/rol.
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly currentUserSubject = new BehaviorSubject<AuthUser | null>(this.readUserFromToken());
  readonly currentUser$: Observable<AuthUser | null> = this.currentUserSubject.asObservable();
  // Nombre a mostrar en el aviso de bienvenida; se limpia solo tras un login reciente.
  readonly welcomeName = signal<string | null>(null);
  readonly moduleAccess = signal<ModuleAccess>({ Modules: [], IsSuperAdmin: false });
  readonly isAuthenticated$: Observable<boolean> = new Observable((subscriber) => {
    subscriber.next(this.hasValidToken());
    return this.currentUser$.subscribe((user) => subscriber.next(user !== null));
  });

  constructor(private readonly httpClient: HttpClient) {
    localStorage.removeItem(AUTH_USER_KEY);
    const user = this.currentUserSubject.value;
    if (user) this.moduleAccess.set({ Modules: user.Modules, IsSuperAdmin: user.IsSuperAdmin });
  }

  login(loginRequest: LoginRequest): Observable<LoginResponse> {
    // Normaliza y guarda la respuesta exitosa del endpoint de login.
    return this.httpClient.post<LoginResponse>(`${API_AUTH_URL}/login`, loginRequest).pipe(
      map((loginResponse) => this.normalizeLoginResponse(loginResponse)),
      tap((loginResponse) => this.storeSession(loginResponse)),
    );
  }

  refreshModuleAccess(): Observable<ModuleAccess> {
    return this.httpClient.get<ModuleAccess & { modules?: string[]; isSuperAdmin?: boolean }>(`${API_AUTH_URL}/permissions`).pipe(
      map((access) => ({
        Modules: access.Modules ?? access.modules ?? [],
        IsSuperAdmin: access.IsSuperAdmin ?? access.isSuperAdmin ?? false,
      })),
      tap((access) => this.storeModuleAccess(access)),
    );
  }
  // Cambia la contraseña inicial del usuario.
  changeInitialPassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.httpClient.post<void>('/api/auth/change-initial-password', {
      CurrentPassword: currentPassword,
      NewPassword: newPassword,
    });
  }

  // Cierra la sesión del usuario actual.
  logout(): void {
    
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    this.currentUserSubject.next(null);
    this.moduleAccess.set({ Modules: [], IsSuperAdmin: false });
  }

  // Verifica si el usuario actual está autenticado.
  isAuthenticated(): boolean {
    const token = this.getToken();
    const user = this.currentUserSubject.value;
    return !!token && !!user;
  }

  defaultRoute(): string {
    const access = this.moduleAccess();
    if (access.IsSuperAdmin || access.Modules.some((module) => [
      'DISPOSITIVOS', 'REASIGNACIONES', 'TALLER', 'USUARIOS', 'MANTENIMIENTO',
    ].includes(module))) return '/admin';
    if (access.Modules.includes('INVENTARIO')) return '/inventario';
    if (access.Modules.includes('TALLER')) return '/taller';
    return '/sin-acceso';
  }

  // Verifica si el usuario actual tiene alguno de los roles especificados.
  hasRole(roles: UserRole[]): boolean {
    const currentUser = this.currentUserSubject.value;
    return currentUser !== null && roles.includes(currentUser.Role);
  }

  hasModule(module: string): boolean {
    const access = this.moduleAccess();
    return access.IsSuperAdmin || access.Modules.includes(module);
  }

  hasAnyModule(modules: string[]): boolean {
    return this.moduleAccess().IsSuperAdmin || modules.some((module) => this.moduleAccess().Modules.includes(module));
  }

  // Obtiene el token JWT almacenado en la sesión local.
  getToken(): string | null {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    return token && token.trim().length > 0 ? token : null;
  }

  // Conserva el token para la sesión y mantiene el perfil solo en memoria.
  private storeSession(loginResponse: LoginResponse): void {
    localStorage.setItem(AUTH_TOKEN_KEY, loginResponse.Token);
    localStorage.removeItem(AUTH_USER_KEY);
    this.currentUserSubject.next(loginResponse.User);
    this.storeModuleAccess({
      Modules: loginResponse.User.Modules ?? [],
      IsSuperAdmin: loginResponse.User.IsSuperAdmin ?? false,
    });
    this.welcomeName.set(loginResponse.User.FullName || loginResponse.User.UserName);
    setTimeout(() => this.welcomeName.set(null), WELCOME_TOAST_DURATION_MS);
  }

  // Normaliza la respuesta de login para aceptar tanto PascalCase como camelCase.
  private normalizeLoginResponse(loginResponse: LoginResponse): LoginResponse {
    const response = loginResponse as LoginResponse & {
      token?: string; user?: AuthUser & {
        userId?: number | string;
        userName?: string;
        fullName?: string;
        role?: UserRole;
        estado?: string;
        dominioP?: string;
        dominio?: number;
      }, mustChangePassword?: boolean; mustChange?: boolean;
    };

    // Extrae el usuario de la respuesta
    const user = (response.User ?? response.user) as (AuthUser & {
      userId?: number | string;
      userName?: string;
      fullName?: string;
      role?: UserRole;
      estado?: string;
      dominioP?: string;
      dominio?: number;
    }) | undefined;

    // Construye la respuesta normalizada con propiedades PascalCase, usando valores de respaldo si es necesario.
    return {
      Token: response.Token ?? response.token ?? '',
      User: {
        UserId: user?.UserId ?? user?.userId ?? '',
        UserName: user?.UserName ?? user?.userName ?? '',
        FullName: user?.FullName ?? user?.fullName ?? '',
        Role: user?.Role ?? user?.role ?? 'UsuarioComun',
        Estado: user?.Estado ?? user?.estado ?? 'ACTIVO',
        DominioP: user?.DominioP ?? user?.dominioP ?? '',
        Dominio: user?.Dominio ?? user?.dominio ?? 0,
        Modules: user?.Modules ?? (user as { modules?: string[] } | undefined)?.modules ?? [],
        IsSuperAdmin: user?.IsSuperAdmin ?? (user as { isSuperAdmin?: boolean } | undefined)?.isSuperAdmin ?? false,
      },
      MustChangePassword: response.MustChangePassword
        ?? response.mustChangePassword
        ?? response.mustChange
        ?? false,
    };
  }

  // Reconstituye en memoria solo la identidad y el rol necesarios desde el JWT.
  private readUserFromToken(): AuthUser | null {
    try {
      const token = this.getToken();
      const payloadSegment = token?.split('.')[1];
      if (!payloadSegment) return null;

      const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
      const binaryPayload = atob(padded);
      const payloadBytes = Uint8Array.from(binaryPayload, (character) => character.charCodeAt(0));
      const claims = JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
      const expiresAt = Number(claims['exp']);
      if (Number.isFinite(expiresAt) && expiresAt * 1000 <= Date.now()) return null;

      const userName = String(claims['unique_name'] ?? claims['name'] ?? '').trim();
      const rawRole = claims['role'] ?? claims['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'];
      const role = Array.isArray(rawRole) ? rawRole[0] : rawRole;
      if (!userName || !['Admin', 'UsuarioComun', 'Taller'].includes(String(role))) return null;

      return {
        UserId: String(claims['sub'] ?? ''),
        UserName: userName,
        FullName: userName,
        Role: String(role) as UserRole,
        Estado: 'ACTIVO',
        DominioP: '',
        Dominio: 0,
        Modules: [],
        IsSuperAdmin: false,
      };
    } catch {
      return null;
    }
  }
  // Verifica si el token almacenado es válido y si hay un usuario actual.
  private hasValidToken(): boolean {
    return this.getToken() !== null && this.currentUserSubject.value !== null;
  }

  private storeModuleAccess(access: ModuleAccess): void {
    this.moduleAccess.set(access);
    const currentUser = this.currentUserSubject.value;
    if (currentUser) this.currentUserSubject.next({ ...currentUser, ...access });
  }
}