import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, map, tap } from 'rxjs';
import { AuthUser, LoginRequest, LoginResponse, UserRole } from './auth.models';

const API_AUTH_URL = '/api/auth';
const AUTH_TOKEN_KEY = 'sistema_inventario_token';
const AUTH_USER_KEY = 'sistema_inventario_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly currentUserSubject = new BehaviorSubject<AuthUser | null>(this.readUser());
  readonly currentUser$: Observable<AuthUser | null> = this.currentUserSubject.asObservable();
  readonly isAuthenticated$: Observable<boolean> = new Observable((subscriber) => {
    subscriber.next(this.hasValidToken());
    return this.currentUser$.subscribe((user) => subscriber.next(user !== null));
  });

  constructor(private readonly httpClient: HttpClient) {}

  login(loginRequest: LoginRequest): Observable<LoginResponse> {
    return this.httpClient.post<LoginResponse>(`${API_AUTH_URL}/login`, loginRequest).pipe(
      map((loginResponse) => this.normalizeLoginResponse(loginResponse)),
      tap((loginResponse) => this.storeSession(loginResponse)),
    );
  }

  logout(): void {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    this.currentUserSubject.next(null);
  }

  hasRole(roles: UserRole[]): boolean {
    const currentUser = this.currentUserSubject.value;
    return currentUser !== null && roles.includes(currentUser.Role);
  }

  getToken(): string | null {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  private storeSession(loginResponse: LoginResponse): void {
    localStorage.setItem(AUTH_TOKEN_KEY, loginResponse.Token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(loginResponse.User));
    this.currentUserSubject.next(loginResponse.User);
  }

  private normalizeLoginResponse(loginResponse: LoginResponse): LoginResponse {
    const response = loginResponse as LoginResponse & { token?: string; user?: AuthUser & {
      userId?: number | string;
      userName?: string;
      fullName?: string;
      role?: UserRole;
    } };
    const user = (response.User ?? response.user) as (AuthUser & {
      userId?: number | string;
      userName?: string;
      fullName?: string;
      role?: UserRole;
    }) | undefined;

    return {
      Token: response.Token ?? response.token ?? '',
      User: {
        UserId: user?.UserId ?? user?.userId ?? '',
        UserName: user?.UserName ?? user?.userName ?? '',
        FullName: user?.FullName ?? user?.fullName ?? '',
        Role: user?.Role ?? user?.role ?? 'UsuarioComun',
      },
    };
  }

  private readUser(): AuthUser | null {
    try {
      const storedUser = localStorage.getItem(AUTH_USER_KEY);
      return storedUser ? (JSON.parse(storedUser) as AuthUser) : null;
    } catch {
      return null;
    }
  }

  private hasValidToken(): boolean {
    return this.getToken() !== null && this.currentUserSubject.value !== null;
  }
}