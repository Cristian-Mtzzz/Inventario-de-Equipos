import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, fromEvent, merge, switchMap, throttleTime, timer } from 'rxjs';
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

  constructor() {
    fromEvent<StorageEvent>(window, 'storage').pipe(
      takeUntilDestroyed(),
    ).subscribe((event) => this.authService.handleStorageChange(event.key, event.newValue));

    merge(
      fromEvent(document, 'pointerdown'),
      fromEvent(document, 'pointermove'),
      fromEvent(document, 'keydown'),
      fromEvent(document, 'input'),
      fromEvent(document, 'touchstart'),
      fromEvent(document, 'wheel'),
    ).pipe(
      throttleTime(1000),
      takeUntilDestroyed(),
    ).subscribe(() => this.authService.recordActivity());

    timer(0, 5000).pipe(
      switchMap(() => this.authService.isAuthenticated()
        ? this.authService.refreshModuleAccess().pipe(catchError(() => EMPTY))
        : EMPTY),
      takeUntilDestroyed(),
    ).subscribe();
  }
}
