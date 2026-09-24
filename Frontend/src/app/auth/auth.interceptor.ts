import { HttpInterceptorFn } from '@angular/common/http';

// Añade el token JWT a cada llamada protegida sin modificar peticiones públicas.
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = localStorage.getItem('sistema_inventario_token');
  if (!token) {
    return next(request);
  }

  return next(request.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
  }));
};