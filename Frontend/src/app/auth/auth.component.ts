import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { EMPTY, catchError, finalize } from 'rxjs';
import { AuthService } from './auth.service';

// Componente visual y reactivo de inicio de sesión.
@Component({
  selector: 'app-auth',
  imports: [ReactiveFormsModule],
  templateUrl: './auth.component.html',
  styleUrl: './auth.component.css',
})

// Valida credenciales, muestra estados de carga y redirige según el rol.
export class AuthComponent {
  private readonly formBuilder = inject(FormBuilder);
  readonly loginForm = this.formBuilder.nonNullable.group({
    userName: ['', [Validators.required]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });
  readonly isLoading = signal(false);
  readonly errorMessage = signal('');
  showPassword = false;

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
  ) { }

  submitLogin(): void {
    // Evita enviar formularios incompletos y marca los controles para mostrar errores.
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set('');
    const { userName, password } = this.loginForm.getRawValue();

    // El servicio persiste el JWT; aquí solo se decide la ruta inicial del usuario.
    this.authService.login({ UserName: userName, Password: password }).pipe(
      catchError((error: HttpErrorResponse) => {
        this.errorMessage.set(error.status === 401
          ? 'El usuario o la contrasena no son correctos.'
          : 'No fue posible conectar con el servicio. Intenta nuevamente.');
        return EMPTY;
      }),
      finalize(() => {
        this.isLoading.set(false);
      }),
    ).subscribe({
      next: ({ User }) => this.router.navigateByUrl(
        User.Role === 'Admin'
          ? '/admin'
          : User.Role === 'Taller'
            ? '/taller'
            : '/inventario',
      ),
    });
  }

}