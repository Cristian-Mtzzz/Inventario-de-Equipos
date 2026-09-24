import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { UserRole } from './auth.models';
import { AuthService } from './auth.service';

// Impide abrir módulos protegidos sin token y sin el rol requerido.
export const authGuard: CanActivateFn = (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const allowedRoles = (route.data['roles'] ?? []) as UserRole[];

  if (authService.getToken() && authService.hasRole(allowedRoles)) {
    return true;
  }

  return router.createUrlTree(['/login']);
};