import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
// Componente raíz: aloja el outlet donde Angular inserta login y módulos protegidos.
export class App { }
