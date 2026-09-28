import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './auth/auth.service';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
// Componente raíz: aloja el outlet y el aviso de bienvenida tras iniciar sesión.
export class App {
  private readonly authService = inject(AuthService);
  protected readonly welcomeName = this.authService.welcomeName;
}
