import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router, RouterStateSnapshot } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Observable } from 'rxjs';
import { App } from './app';
import { authGuard } from './auth/auth.guard';
import { UserRole } from './auth/auth.models';

// Pruebas básicas del componente raíz y del shell de navegación.
describe('App', () => {
  beforeEach(async () => {
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(key) ?? null,
      key: (index) => Array.from(values.keys())[index] ?? null,
      removeItem: (key) => values.delete(key),
      setItem: (key, value) => values.set(key, String(value)),
    };
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    });
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    })
      .compileComponents();
  });
  // Prueba que verifica la creación del componente raíz.
  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  // Prueba que verifica que se renderiza el shell de la aplicación.
  it('should render the application shell', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled).toBeTruthy();
  });

  // Prueba que verifica la redirección a login cuando no hay sesión activa.
  it('should redirect to login when there is no active session', () => {
    const router = TestBed.inject(Router);
    const route = { data: { roles: ['Admin'] as UserRole[] } };
    const navigationState = {} as RouterStateSnapshot;

    TestBed.runInInjectionContext(() => {
      expect(authGuard(route as unknown as ActivatedRouteSnapshot, navigationState)).toEqual(router.createUrlTree(['/login']));
    });
  });

  // Prueba que permite el acceso cuando la sesión del usuario es válida para el rol requerido.
  it('should allow access when the user session is valid for the required role', () => {
    const encodeBase64Url = (value: object): string => btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const tokenPayload = encodeBase64Url({
      sub: '1',
      unique_name: 'admin',
      role: 'Admin',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    localStorage.setItem('sistema_inventario_token', `header.${tokenPayload}.signature`);

    const route = { data: { role: 'Admin' as UserRole, modules: ['DISPOSITIVOS'] } };
    const navigationState = {} as RouterStateSnapshot;
    const result = TestBed.runInInjectionContext(() =>
      authGuard(route as unknown as ActivatedRouteSnapshot, navigationState));
    let guardResult: boolean | ReturnType<Router['createUrlTree']> | undefined;

    expect(result).toBeInstanceOf(Observable);
    (result as Observable<boolean | ReturnType<Router['createUrlTree']>>).subscribe((value) => {
      guardResult = value;
    });

    TestBed.inject(HttpTestingController)
      .expectOne((request) => request.url.endsWith('/api/auth/permissions'))
      .flush({ Modules: ['DISPOSITIVOS'], IsSuperAdmin: false });

    expect(guardResult).toBe(true);
  });
});
