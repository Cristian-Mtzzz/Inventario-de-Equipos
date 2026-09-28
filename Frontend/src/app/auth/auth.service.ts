import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { BehaviorSubject, Observable, map, tap } from 'rxjs';
import { AuthUser, LoginRequest, LoginResponse, UserRole } from './auth.models';

const WELCOME_TOAST_DURATION_MS = 2000;

const API_AUTH_URL = '/api/auth';
const AUTH_TOKEN_KEY = 'sistema_inventario_token';
const AUTH_USER_KEY = 'sistema_inventario_user';

// Centraliza la sesión del navegador: envía credenciales, guarda el Json Web Tokens, expone
// el usuario actual y ofrece comprobaciones reutilizables de autenticación/rol.
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly currentUserSubject = new BehaviorSubject<AuthUser | null>(this.readUser());
  readonly currentUser$: Observable<AuthUser | null> = this.currentUserSubject.asObservable();
  // Nombre a mostrar en el aviso de bienvenida; se limpia solo tras un login reciente.
  readonly welcomeName = signal<string | null>(null);
  readonly isAuthenticated$: Observable<boolean> = new Observable((subscriber) => {
    subscriber.next(this.hasValidToken());
    return this.currentUser$.subscribe((user) => subscriber.next(user !== null));
  });

  constructor(private readonly httpClient: HttpClient) { }

  login(loginRequest: LoginRequest): Observable<LoginResponse> {
    // Normaliza y guarda la respuesta exitosa del endpoint de login.
    return this.httpClient.post<LoginResponse>(`${API_AUTH_URL}/login`, loginRequest).pipe(
      map((loginResponse) => this.normalizeLoginResponse(loginResponse)),
      tap((loginResponse) => this.storeSession(loginResponse)),
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
  }

  // Verifica si el usuario actual está autenticado.
  isAuthenticated(): boolean {
    const token = this.getToken();
    const user = this.currentUserSubject.value ?? this.readUser();
    return !!token && !!user;
  }

  // Verifica si el usuario actual tiene alguno de los roles especificados.
  hasRole(roles: UserRole[]): boolean {
    const currentUser = this.currentUserSubject.value ?? this.readUser();
    return currentUser !== null && roles.includes(currentUser.Role);
  }

  // Obtiene el token JWT almacenado en la sesión local.
  getToken(): string | null {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    return token && token.trim().length > 0 ? token : null;
  }

  // Almacena la sesión del usuario en el almacenamiento local y actualiza el sujeto actual.
  private storeSession(loginResponse: LoginResponse): void {
    localStorage.setItem(AUTH_TOKEN_KEY, loginResponse.Token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(loginResponse.User));
    this.currentUserSubject.next(loginResponse.User);
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
      },
      MustChangePassword: response.MustChangePassword
        ?? response.mustChangePassword
        ?? response.mustChange
        ?? false,
    };
  }

  // Lee la información del usuario almacenada en la sesión local.
  private readUser(): AuthUser | null {
    try {
      const storedUser = localStorage.getItem(AUTH_USER_KEY);
      return storedUser ? (JSON.parse(storedUser) as AuthUser) : null;
    } catch {
      return null;
    }
  }
  // Verifica si el token almacenado es válido y si hay un usuario actual.
  private hasValidToken(): boolean {
    return this.getToken() !== null && this.currentUserSubject.value !== null;
  }
}