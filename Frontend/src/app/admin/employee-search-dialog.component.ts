import { Component, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';
import { AdminService } from './admin.service';
import { EmployeeSearchResult } from './admin.models';

@Component({
    selector: 'app-employee-search-dialog',
    imports: [FormsModule],
    templateUrl: './employee-search-dialog.component.html',
    styleUrl: './employee-search-dialog.component.css',
})


export class EmployeeSearchDialogComponent {
    readonly closed = output<void>();
    readonly employees = signal<EmployeeSearchResult[]>([]);
    readonly isLoading = signal(false);
    readonly errorMessage = signal('');
    searchTerm = '';
    hasSearched = false;

    constructor(private readonly adminService: AdminService) { }

    //cuadro de busqueda
    search(): void {
        const term = this.searchTerm.trim();
        this.errorMessage.set('');
        this.hasSearched = true;
        if (term.length < 2) {
            this.employees.set([]);
            this.errorMessage.set('Escribe al menos 2 caracteres para buscar.');
            return;
        }

        this.isLoading.set(true);
        this.adminService.searchEmployees(term).pipe(finalize(() => this.isLoading.set(false))).subscribe({
            next: (employees) => this.employees.set(employees),
            error: () => this.errorMessage.set('No se pudo buscar al empleado.'),
        });
    }
}
