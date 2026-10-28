import { Directive, ElementRef, inject } from '@angular/core';
import { NgControl } from '@angular/forms';

/**
 * Campo que escribe siempre en mayúsculas (marca, modelo, serie), aunque el teclado esté en
 * minúsculas. Convierte lo que se teclea o pega, conserva la posición del cursor y mantiene
 * sincronizado el ngModel.
 * Uso: `<input appUppercase [(ngModel)]="..." />`
 */
@Directive({
  selector: 'input[appUppercase]',
  host: {
    autocapitalize: 'characters',
    '(input)': 'toUppercase()',
  },
})
export class UppercaseDirective {
  private readonly input = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private readonly control = inject(NgControl, { optional: true, self: true });

  toUppercase(): void {
    const upper = this.input.value.toLocaleUpperCase('es');
    if (upper === this.input.value) return;

    const { selectionStart, selectionEnd } = this.input;
    this.input.value = upper;
    this.input.setSelectionRange(selectionStart, selectionEnd);
    this.control?.control?.setValue(upper);
  }
}
