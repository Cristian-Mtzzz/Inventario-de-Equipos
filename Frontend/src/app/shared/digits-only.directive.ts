import { Directive, ElementRef, inject } from '@angular/core';
import { NgControl } from '@angular/forms';

/**
 * Campo que solo acepta dígitos (número de inventario, número de pago).
 * Bloquea las letras al teclear y limpia lo que se pegue; respeta el maxlength del input
 * y mantiene sincronizado el ngModel aunque el valor visible no cambie.
 * Uso: `<input appDigitsOnly maxlength="7" [(ngModel)]="..." />`
 */
@Directive({
  selector: 'input[appDigitsOnly]',
  host: {
    inputmode: 'numeric',
    autocomplete: 'off',
    '(beforeinput)': 'blockNonDigits($event)',
    '(input)': 'removeNonDigits()',
  },
})
export class DigitsOnlyDirective {
  private readonly input = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private readonly control = inject(NgControl, { optional: true, self: true });

  // Evita que una tecla que no es número llegue a escribirse.
  blockNonDigits(event: InputEvent): void {
    if (event.inputType === 'insertText' && event.data && /\D/.test(event.data)) {
      event.preventDefault();
    }
  }

  // Respaldo para pegado, autocompletado o arrastre: deja solo los dígitos.
  removeNonDigits(): void {
    const maxLength = this.input.maxLength > 0 ? this.input.maxLength : undefined;
    const digits = this.input.value.replace(/\D/g, '').slice(0, maxLength);
    if (digits === this.input.value) return;

    this.input.value = digits;
    this.control?.control?.setValue(digits);
  }
}
