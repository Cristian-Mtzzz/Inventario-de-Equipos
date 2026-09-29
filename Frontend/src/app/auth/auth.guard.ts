import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';

// Impide abrir módulos protegidos sin credenciales  y sin el rol requerido.
export const authGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const requiredModules = (route.data['modules'] ?? []) as string[];

  if (!authService.isAuthenticated()) {
    authService.logout();
    return router.createUrlTree(['/login']);
  }

  return authService.refreshModuleAccess().pipe(
    map((access) => access.IsSuperAdmin || requiredModules.some((module) => access.Modules.includes(module))
      ? true
      : router.createUrlTree(['/sin-acceso'])),
    catchError(() => of(router.createUrlTree(['/login']))),
  );
};