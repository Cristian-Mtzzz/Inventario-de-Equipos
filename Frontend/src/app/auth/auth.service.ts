import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, EMPTY, Observable, catchError, finalize, map, tap } from 'rxjs';
import { AuthUser, LoginRequest, LoginResponse, ModuleAccess, UserRole } from './auth.models';

const WELCOME_TOAST_DURATION_MS = 2000;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;

const API_AUTH_URL = '/api/auth';
const AUTH_TOKEN_KEY = 'sistema_inventario_token';
const AUTH_USER_KEY = 'sistema_inventario_user';
const LAST_ACTIVITY_KEY = 'sistema_inventario_last_activity';

// Centraliza la sesión del navegador: envía credenciales, guarda el Json Web Tokens, expone
// el usuario actual y ofrece comprobaciones reutilizables de autenticación/rol.
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly currentUserSubject = new BehaviorSubject<AuthUser | null>(this.readUserFromToken());
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private tokenRefreshInFlight = false;
  readonly currentUser$: Observable<AuthUser | null> = this.currentUserSubject.asObservable();
  // Nombre a mostrar en el aviso de bienvenida; se limpia solo tras un login reciente.
  readonly welcomeName = signal<string | null>(null);
  readonly moduleAccess = signal<ModuleAccess>({ Modules: [], IsSuperAdmin: false });
  readonly isAuthenticated$: Observable<boolean> = new Observable((subscriber) => {
    subscriber.next(this.hasValidToken());
    return this.currentUser$.subscribe((user) => subscriber.next(user !== null));
  });

  constructor(private readonly httpClient: HttpClient, private readonly router: Router) {
    localStorage.removeItem(AUTH_USER_KEY);
    const user = this.currentUserSubject.value;
    if (user) {
      this.moduleAccess.set({ Modules: user.Modules, IsSuperAdmin: user.IsSuperAdmin });
      const lastActivity = this.getLastActivityTimestamp();
      this.scheduleInactivityExpiry(lastActivity);
      this.refreshTokenIfNeeded(lastActivity);
    } else if (this.getToken()) {
      this.logout();
    }
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

  recordActivity(): void {
    if (!this.isAuthenticated()) return;
    const lastActivity = Date.now();
    localStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivity));
    this.scheduleInactivityExpiry(lastActivity);
    this.refreshTokenIfNeeded(lastActivity);
  }

  handleStorageChange(key: string | null, value: string | null): void {
    if (key === AUTH_TOKEN_KEY && value === null && this.currentUserSubject.value) {
      this.logout();
      void this.router.navigateByUrl('/login');
      return;
    }
    if (key !== LAST_ACTIVITY_KEY || value === null || !this.isAuthenticated()) return;

    const lastActivity = Number(value);
    if (Number.isFinite(lastActivity) && lastActivity > 0) {
      this.scheduleInactivityExpiry(lastActivity);
      this.refreshTokenIfNeeded(lastActivity);
    }
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
    if (this.inactivityTimer !== null) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(LAST_ACTIVITY_KEY);
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
    const hasAdminModule = access.IsSuperAdmin || access.Modules.some((module) => [
      'DISPOSITIVOS', 'REASIGNACIONES', 'TALLER', 'USUARIOS', 'MANTENIMIENTO',
    ].includes(module));
    if (hasAdminModule) return this.roleHomeRoute();
    if (access.Modules.includes('INVENTARIO')) return '/inventario';
    return '/sin-acceso';
  }

  roleHomeRoute(): string {
    switch (this.currentUserSubject.value?.Role) {
      case 'Admin': return '/admin';
      case 'UsuarioComun': return '/usuario';
      case 'Taller': return '/taller';
      default: return '/sin-acceso';
    }
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
    const lastActivity = Date.now();
    localStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivity));
    this.scheduleInactivityExpiry(lastActivity);
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
    const claims = this.readTokenClaims();
    if (!claims) return null;
    const expiresAt = Number(claims['exp']);
    if (!Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) return null;

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
  }
  // Verifica si el token almacenado es válido y si hay un usuario actual.
  private hasValidToken(): boolean {
    return this.getToken() !== null && this.currentUserSubject.value !== null;
  }

  private scheduleInactivityExpiry(lastActivity: number): void {
    if (this.inactivityTimer !== null) clearTimeout(this.inactivityTimer);
    const remainingTime = lastActivity + SESSION_IDLE_TIMEOUT_MS - Date.now();
    if (remainingTime <= 0) {
      this.expireSession();
      return;
    }
    this.inactivityTimer = setTimeout(() => this.expireSession(), remainingTime);
  }

  private getLastActivityTimestamp(): number {
    const storedActivity = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    if (Number.isFinite(storedActivity) && storedActivity > 0) return storedActivity;
    const issuedAt = Number(this.readTokenClaims()?.['iat']);
    return Number.isFinite(issuedAt) && issuedAt > 0 ? issuedAt * 1000 : Date.now();
  }

  private refreshTokenIfNeeded(lastActivity: number): void {
    const expiresAt = Number(this.readTokenClaims()?.['exp']);
    if (!Number.isFinite(expiresAt)
      || expiresAt * 1000 - (lastActivity + SESSION_IDLE_TIMEOUT_MS) > TOKEN_REFRESH_MARGIN_MS
      || this.tokenRefreshInFlight) return;

    this.tokenRefreshInFlight = true;
    this.httpClient.post<{ Token?: string; token?: string }>(`${API_AUTH_URL}/refresh`, {}).pipe(
      tap((response) => {
        const token = response.Token ?? response.token;
        if (!token) {
          this.expireSession();
          return;
        }
        localStorage.setItem(AUTH_TOKEN_KEY, token);
      }),
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401) this.expireSession();
        return EMPTY;
      }),
      finalize(() => this.tokenRefreshInFlight = false),
    ).subscribe();
  }

  private readTokenClaims(): Record<string, unknown> | null {
    try {
      const payloadSegment = this.getToken()?.split('.')[1];
      if (!payloadSegment) return null;
      const base64 = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
      const binaryPayload = atob(padded);
      const payloadBytes = Uint8Array.from(binaryPayload, (character) => character.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(payloadBytes)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private expireSession(): void {
    this.logout();
    void this.router.navigateByUrl('/login');
  }

  private storeModuleAccess(access: ModuleAccess): void {
    this.moduleAccess.set(access);
    const currentUser = this.currentUserSubject.value;
    if (currentUser) this.currentUserSubject.next({ ...currentUser, ...access });
  }
}