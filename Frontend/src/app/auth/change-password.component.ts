import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { EMPTY, catchError, finalize } from 'rxjs';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-change-password',
  imports: [ReactiveFormsModule],
  templateUrl: './change-password.component.html',
  styleUrl: './change-password.component.css',
})
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

  submit(): void {
    this.errorMessage.set('');
    const { currentPassword, newPassword, confirmPassword } = this.form.getRawValue();
    if (this.form.invalid || newPassword !== confirmPassword) {
      this.form.markAllAsTouched();
      if (newPassword !== confirmPassword) this.errorMessage.set('Las contrasenas nuevas no coinciden.');
      return;
    }

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