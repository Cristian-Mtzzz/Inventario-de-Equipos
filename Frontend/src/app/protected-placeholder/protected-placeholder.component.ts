import { Component } from '@angular/core';

@Component({
  standalone: true,
  selector: 'app-protected-placeholder',
  template: '<main style="padding: 3rem; font-family: sans-serif"><h1>Sin acceso asignado</h1><p>Solicita al administrador que te asigne los módulos necesarios.</p></main>',
})
// Explica que la cuenta no tiene un módulo asignado.

export class ProtectedPlaceholderComponent { }