import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { authGuard } from './auth/auth.guard';
import { AuthUser, UserRole } from './auth/auth.models';

// Pruebas básicas del componente raíz y del shell de navegación.
describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the application shell', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled).toBeTruthy();
  });

  it('should redirect to login when there is no active session', () => {
    const router = TestBed.inject(Router);
    const route = { data: { roles: ['Admin'] as UserRole[] } };

    TestBed.runInInjectionContext(() => {
      expect(authGuard(route as any)).toEqual(router.createUrlTree(['/login']));
    });
  });

  it('should allow access when the user session is valid for the required role', () => {
    const user: AuthUser = {
      UserId: '1',
      UserName: 'admin',
      FullName: 'Administrador',
      Role: 'Admin',
    };

    localStorage.setItem('sistema_inventario_token', 'jwt-token');
    localStorage.setItem('sistema_inventario_user', JSON.stringify(user));

    const route = { data: { roles: ['Admin'] as UserRole[] } };
    TestBed.runInInjectionContext(() => {
      expect(authGuard(route as any)).toBeTrue();
    });
  });
});
