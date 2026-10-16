import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { DigitsOnlyDirective } from './digits-only.directive';

@Component({
  imports: [FormsModule, DigitsOnlyDirective],
  template: `<input appDigitsOnly maxlength="7" [(ngModel)]="code" name="code" />`,
})
class HostComponent {
  code = '';
}

describe('DigitsOnlyDirective', () => {
  async function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    return { fixture, input };
  }

  it('removes letters and symbols from pasted text and updates the model', async () => {
    const { fixture, input } = await setup();
    input.value = '41-02a532';
    input.dispatchEvent(new Event('input'));

    expect(input.value).toBe('4102532');
    expect(fixture.componentInstance.code).toBe('4102532');
  });

  it('respects the maxlength of the input', async () => {
    const { fixture, input } = await setup();
    input.value = '1234567890';
    input.dispatchEvent(new Event('input'));

    expect(input.value).toBe('1234567');
    expect(fixture.componentInstance.code).toBe('1234567');
  });

  it('blocks typing a non-digit character', async () => {
    const { input } = await setup();
    const letter = new InputEvent('beforeinput', { inputType: 'insertText', data: 'a', cancelable: true });
    const digit = new InputEvent('beforeinput', { inputType: 'insertText', data: '5', cancelable: true });
    input.dispatchEvent(letter);
    input.dispatchEvent(digit);

    expect(letter.defaultPrevented).toBe(true);
    expect(digit.defaultPrevented).toBe(false);
  });
});
