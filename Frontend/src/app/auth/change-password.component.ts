// Componente para cambiar la contraseña inicial del usuario.

import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { EMPTY, catchError, finalize } from 'rxjs';
import { AuthService } from './auth.service';

// Componente para cambiar la contraseña inicial del usuario.
@Component({
  selector: 'app-change-password',
  imports: [ReactiveFormsModule],
  templateUrl: './change-password.component.html',
  styleUrl: './change-password.component.css',
})

// Clase del componente para cambiar la contraseña inicial del usuario.
export class ChangePasswordComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  readonly form = this.formBuilder.nonNullable.group({
    currentPassword: ['', [Validators.required]],
    newPassword: ['', [Validators.required, Validators.minLength(6)]],
    confirmPassword: ['', [Validators.required]],
  });
  readonly isLoading = signal(false);
  readonly errorMessage = signal('');

  // Maneja el envío del formulario para cambiar la contraseña inicial.
  submit(): void {
    this.errorMessage.set('');
    const { currentPassword, newPassword, confirmPassword } = this.form.getRawValue();
    if (this.form.invalid || newPassword !== confirmPassword) {
      this.form.markAllAsTouched();
      if (newPassword !== confirmPassword) this.errorMessage.set('Las contrasenas nuevas no coinciden.');
      return;
    }

    // Realiza la solicitud para cambiar la contraseña inicial del usuario.
    this.isLoading.set(true);
    this.authService.changeInitialPassword(currentPassword, newPassword).pipe(
      catchError((error: HttpErrorResponse) => {
        this.errorMessage.set(error.error?.Message ?? 'No se pudo actualizar la contrasena.');
        return EMPTY;
      }),
      finalize(() => this.isLoading.set(false)),
    ).subscribe(() => {
      this.authService.logout();
      this.router.navigateByUrl('/login');
    });
  }
}