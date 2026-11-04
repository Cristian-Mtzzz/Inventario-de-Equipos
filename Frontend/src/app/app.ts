import { ChangeDetectionStrategy, Component, NgZone, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, exhaustMap, fromEvent, merge, throttleTime, timer } from 'rxjs';
import { AuthService } from './auth/auth.service';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
  // Angular 22 usa OnPush por defecto. Con la raíz en OnPush, las pantallas Eager (Admin e
  // Inventario) no se redibujaban al llegar una respuesta HTTP sin markForCheck: el combo de
  // departamento quedaba vacío hasta el siguiente clic. La raíz Eager deja pasar esos cambios.
  changeDetection: ChangeDetectionStrategy.Eager,
})
// Componente raíz: aloja el outlet y vigila la actividad y los módulos de la sesión.
export class App {
  private readonly authService = inject(AuthService);
  private readonly ngZone = inject(NgZone);

  constructor() {
    fromEvent<StorageEvent>(window, 'storage').pipe(
      takeUntilDestroyed(),
    ).subscribe((event) => this.authService.handleStorageChange(event.key, event.newValue));

    // Se escucha fuera de Angular: dentro, cada movimiento del mouse redibujaba toda la app.
    // Solo el registro de actividad (como mucho una vez por segundo) vuelve a la zona, para
    // que el temporizador de inactividad y la navegación al login sigan funcionando igual.
    const activity$ = merge(
      fromEvent(document, 'pointerdown'),
      fromEvent(document, 'pointermove'),
      fromEvent(document, 'keydown'),
      fromEvent(document, 'input'),
      fromEvent(document, 'touchstart'),
      fromEvent(document, 'wheel'),
    ).pipe(
      throttleTime(1000),
      takeUntilDestroyed(),
    );
    this.ngZone.runOutsideAngular(() => activity$.subscribe(() =>
      this.ngZone.run(() => this.authService.recordActivity())));

    timer(0, 30_000).pipe(
      exhaustMap(() => this.authService.isAuthenticated()
        ? this.authService.refreshModuleAccess().pipe(catchError(() => EMPTY))
        : EMPTY),
      takeUntilDestroyed(),
    ).subscribe();
  }
}
