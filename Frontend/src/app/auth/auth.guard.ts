import { inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';
import { UserRole } from './auth.models';

export const authenticatedGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  return authService.isAuthenticated() ? true : router.createUrlTree(['/login']);
};

export const loginGuard: CanActivateFn = () => {
  inject(AuthService).logout();
  return true;
};

// Impide abrir módulos protegidos sin credenciales  y sin el rol requerido.
export const authGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const requiredModules = (route.data['modules'] ?? []) as string[];
  const requiredRole = route.data['role'] as UserRole | undefined;

  if (!authService.isAuthenticated()) {
    authService.logout();
    return router.createUrlTree(['/login']);
  }

  return authService.refreshModuleAccess().pipe(
    map((access) => {
      if (requiredRole && !authService.hasRole([requiredRole])) {
        return router.createUrlTree([authService.roleHomeRoute()]);
      }

      return access.IsSuperAdmin || requiredModules.some((module) => access.Modules.includes(module))
        ? true
        : router.createUrlTree(['/sin-acceso']);
    }),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) authService.logout();
      return of(router.createUrlTree(['/login']));
    }),
  );
};