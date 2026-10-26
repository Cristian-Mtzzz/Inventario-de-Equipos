import { Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from '../auth/auth.service';
import { UserRole } from '../auth/auth.models';

// Ruta del logo institucional dentro de la carpeta public/ (por ejemplo 'logo-ihss.png').
// Mientras sea null se muestra un espacio reservado con el mismo tamaño.
const LOGO_SRC: string | null = 'logo.png';

const ROLE_LABELS: Record<UserRole, string> = {
  Admin: 'Administrador general',
  UsuarioComun: 'Usuario común',
  Taller: 'Taller',
  AdminTaller: 'Administrador de taller',
  RecepcionTaller: 'Recepción de taller',
  TecnicoTaller: 'Técnico de taller',
  AdminTicket: 'Administrador de tickets',
};

@Component({
  selector: 'app-header',
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.css',
})
// Barra superior común a los paneles de Admin, Inventario y Taller: logo, nombre del
// sistema, módulo actual, usuario en sesión y las acciones Refrescar / Cerrar sesión.
export class AppHeaderComponent {
  private readonly authService = inject(AuthService);
  private readonly currentUser = toSignal(this.authService.currentUser$, { initialValue: null });

  // Nombre del panel o módulo que se muestra junto al nombre del sistema.
  readonly moduleName = input.required<string>();
  readonly refresh = output<void>();
  readonly logout = output<void>();

  readonly logoSrc = LOGO_SRC;
  readonly userName = computed(() => {
    const user = this.currentUser();
    return user?.FullName?.trim() || user?.UserName || '';
  });
  readonly roleLabel = computed(() => {
    const role = this.currentUser()?.Role;
    return role ? ROLE_LABELS[role] ?? role : '';
  });
  readonly initials = computed(() => this.userName()
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join(''));
}
