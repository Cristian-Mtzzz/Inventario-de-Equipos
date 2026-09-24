import { Component } from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-protected-placeholder',
  template: '<main style="padding: 3rem; font-family: sans-serif"><h1>Modulo protegido</h1><p>La ruta esta disponible para el rol autenticado.</p></main>',
})
// Componente de respaldo para rutas protegidas aún no implementadas.
export class ProtectedPlaceholderComponent {}