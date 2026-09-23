import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-auth',
  imports: [ReactiveFormsModule],
  templateUrl: './auth.component.html',
  styleUrl: './auth.component.css',
})
export class AuthComponent {
  private readonly formBuilder = inject(FormBuilder);
  readonly loginForm = this.formBuilder.nonNullable.group({
    userName: ['', [Validators.required]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });
  isLoading = false;
  errorMessage = '';
  showPassword = false;

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {}

  submitLogin(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    const { userName, password } = this.loginForm.getRawValue();

    this.authService.login({ UserName: userName, Password: password }).pipe(
      finalize(() => this.isLoading = false),
    ).subscribe({
      next: ({ User }) => this.router.navigateByUrl(User.Role === 'Taller' ? '/taller' : '/inventario'),
      error: (error: { status?: number }) => {
        this.errorMessage = error.status === 401
          ? 'El usuario o la contrasena no son correctos.'
          : 'No fue posible conectar con el servicio. Intenta nuevamente.';
      },
    });
  }
}