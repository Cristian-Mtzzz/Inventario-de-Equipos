import { HttpInterceptorFn } from '@angular/common/http';

// Intercepta las peticiones salientes y adjunta el JWT solo cuando existe una
// sesión local; así los servicios llaman a la API sin construir headers.
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = localStorage.getItem('sistema_inventario_token');
  if (!token) {
    return next(request);
  }

  //
  return next(request.clone({
    setHeaders: { Authorization: `Bearer ${token}` },
  }));
};