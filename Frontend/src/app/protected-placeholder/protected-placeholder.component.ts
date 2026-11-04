import { Component, inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';

@Component({
  standalone: true,
  selector: 'app-protected-placeholder',
  template: `<main style="padding: 3rem; font-family: sans-serif">
    <h1>Sin acceso asignado</h1>
    @if (esCuentaDePermisos) {
    <p>Tu cuenta es del Control de permisos, que ahora es un sistema aparte. Entra con el mismo usuario en ese sistema.</p>
    } @else {
    <p>Solicita al administrador que te asigne los módulos necesarios.</p>
    }
  </main>`,
})
// Explica que la cuenta no tiene un módulo asignado (o que es del Control de permisos).
export class ProtectedPlaceholderComponent {
  readonly esCuentaDePermisos = inject(AuthService).hasRole(['Permisos']);
}
