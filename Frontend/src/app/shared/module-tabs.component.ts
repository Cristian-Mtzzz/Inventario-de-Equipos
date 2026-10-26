import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { UserRole } from '../auth/auth.models';

// Roles que entran al panel administrativo: ahí la navegación ya son sus pestañas.
const ADMIN_PANEL_ROLES: UserRole[] = ['Admin', 'UsuarioComun'];

// Ruta propia del taller según el rol, igual que la que usa el inicio de sesión.
const WORKSHOP_ROUTES: Partial<Record<UserRole, string>> = {
  RecepcionTaller: '/taller/recepcion',
  TecnicoTaller: '/taller/tecnico',
};

const MODULE_TABS = [
  { module: 'TALLER', label: 'Taller', route: '/taller' },
  { module: 'TICKETS', label: 'Tickets', route: '/tickets' },
  { module: 'INVENTARIO', label: 'Inventario', route: '/inventario' },
];

@Component({
  selector: 'app-module-tabs',
  template: `
    @if (tabs().length > 1) {
    <nav class="admin-tabs" aria-label="Módulos disponibles">
      @for (tab of tabs(); track tab.module) {
      <button type="button" [class.active]="tab.module === current()" (click)="open(tab.route)">{{ tab.label }}</button>
      }
    </nav>
    }
  `,
  // Usa las pestañas del sistema (.admin-tabs, en styles.css); display:contents deja que
  // la barra se coloque en el flujo de la página igual que en el panel.
  styles: `:host { display: contents; }`,
})
// Pestañas para moverse entre los módulos con pantalla propia. Solo aparecen cuando el
// usuario puede entrar a más de uno: hoy el técnico de taller, que atiende Taller y Tickets.
export class ModuleTabsComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly currentUser = toSignal(this.authService.currentUser$, { initialValue: null });

  // Módulo de la pantalla donde se muestran las pestañas: marca cuál queda activa.
  readonly current = input.required<string>();

  readonly tabs = computed(() => {
    const role = this.currentUser()?.Role;
    if (!role || ADMIN_PANEL_ROLES.includes(role)) return [];

    const access = this.authService.moduleAccess();
    return MODULE_TABS
      .filter((tab) => access.IsSuperAdmin || access.Modules.includes(tab.module))
      .map((tab) => tab.module === 'TALLER' ? { ...tab, route: WORKSHOP_ROUTES[role] ?? tab.route } : tab);
  });

  open(route: string): void {
    this.router.navigateByUrl(route);
  }
}
