import { DestroyRef, Directive, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, NG_VALIDATORS, NgForm, ValidationErrors, Validator } from '@angular/forms';

/**
 * Al intentar guardar un formulario con campos obligatorios vacíos, los sombrea en rojo
 * (clase `show-invalid`, estilos en styles.css). La marca se quita sola en cuanto todos los
 * campos quedan completos, así que no reaparece cuando el formulario se limpia tras guardar.
 * Uso: `<form appHighlightInvalid (ngSubmit)="...">` con `required` en los campos obligatorios.
 */
@Directive({
  selector: 'form[appHighlightInvalid]',
  host: {
    '[class.show-invalid]': 'attempted',
    '(submit)': 'attempted = !!form.invalid',
  },
})
export class HighlightInvalidDirective {
  protected readonly form = inject(NgForm);
  protected attempted = false;

  constructor() {
    this.form.statusChanges?.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((status) => {
      if (status === 'VALID') this.attempted = false;
    });
  }
}

/**
 * Lista obligatoria cuya opción "Selecciona..." vale 0 (edificio, área, equipo, técnico): el
 * `required` de Angular acepta el 0, así que aquí 0 o vacío cuentan como campo sin llenar.
 * En un `<input type="hidden">` marca como obligatorio algo que se elige con un botón (empleado).
 * Uso: `<select appRequiredId [(ngModel)]="..." required>`
 */
@Directive({
  selector: 'select[appRequiredId], input[appRequiredId]',
  providers: [{ provide: NG_VALIDATORS, useExisting: RequiredIdDirective, multi: true }],
})
export class RequiredIdDirective implements Validator {
  validate(control: AbstractControl): ValidationErrors | null {
    return control.value === null || control.value === undefined || Number(control.value) <= 0
      ? { required: true }
      : null;
  }
}
