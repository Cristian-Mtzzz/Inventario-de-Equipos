import { ChangeDetectorRef, Component, Input, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PagePipe, TablePageSizeComponent, TablePaginatorComponent } from '../shared/table-paginator';
import { finalize, retry } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { AppModules } from '../auth/app-modules';
import { ApiError, apiErrorMessage } from '../shared/api-response';
import { AdminService } from './admin.service';
import { AdminUser, CreateAdminUser } from './admin.models';

const emptyUser = (): CreateAdminUser => ({
  Usuario: '', NombrePersona: '', FechaExpiracion: null, Estado: 'ACTIVO',
  DominioP: 'BA', Dominio: 0, Rol: 'UsuarioComun', Modules: [], IsSuperAdmin: false,
});

@Component({
  selector: 'app-user-management',
  imports: [FormsModule, PagePipe, TablePageSizeComponent, TablePaginatorComponent],
  templateUrl: './user-management.component.html',
  // Reutiliza los estilos del panel admin para que la sección se vea igual que antes.
  styleUrls: ['./admin.component.css', './user-management.component.css'],
})
// Sección Usuarios del panel administrativo: listado con filtros, alta/edición con
// módulos de acceso, eliminación y restablecimiento de contraseña.
// El panel la mantiene creada mientras el usuario tenga el módulo USUARIOS, así la
// lista se carga una sola vez y se conserva al cambiar de sección.
export class UserManagementComponent {
  private readonly adminService = inject(AdminService);
  private readonly authService = inject(AuthService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  private isActive = false;
  // Muestra la sección; al entrar se limpian los mensajes, igual que en las demás
  // secciones, y se reintenta la carga si la primera falló.
  @Input() set active(value: boolean) {
    if (value && !this.isActive) {
      this.clearMessages();
      if (!this.usersLoaded) this.reload();
    }
    this.isActive = value;
  }
  get active(): boolean { return this.isActive; }

  users: AdminUser[] = [];
  // Página actual y tamaño de página de la tabla (paginación en el navegador).
  userPage = 1;
  userPageSize = 10;
  isLoadingUsers = false;
  private usersLoaded = false;
  private usersRequestInFlight = false;
  userSearchTerm = '';
  selectedUserRole = '';
  message = '';
  errorMessage = '';
  readonly moduleOptions: { code: string; label: string }[] = [
    { code: AppModules.Devices, label: 'Dispositivos' },
    { code: AppModules.Reassignments, label: 'Reasignaciones' },
    { code: AppModules.Workshop, label: 'Taller' },
    { code: AppModules.Users, label: 'Usuarios' },
    { code: AppModules.Maintenance, label: 'Mantenimiento' },
  ];
  newUser: CreateAdminUser = emptyUser();
  isUserDialogOpen = false;
  editingUserId: number | null = null;
  pendingUserId: number | null = null;
  pendingPasswordResetUserId: number | null = null;
  pendingPasswordResetUserName = '';
  isPasswordResetDialogOpen = false;

  constructor() {
    this.reload();
  }

  get canManageSuperAdmins(): boolean {
    return this.authService.moduleAccess().IsSuperAdmin;
  }

  get filteredUsers(): AdminUser[] {
    const normalizedSearch = this.userSearchTerm.trim().toLowerCase();
    return this.users.filter((user) => {
      const matchesSearch = !normalizedSearch || user.Usuario.toLowerCase().includes(normalizedSearch);
      const matchesRole = !this.selectedUserRole || user.Rol === this.selectedUserRole;
      return matchesSearch && matchesRole;
    });
  }

  get availableUserRoles(): string[] {
    return [...new Set(this.users.map((user) => user.Rol).filter(Boolean))].sort((first, second) => first.localeCompare(second));
  }

  // Carga la lista de usuarios desde el backend, con control de estado y reintentos.
  reload(): void {
    if (this.usersRequestInFlight) return;

    this.usersRequestInFlight = true;
    this.isLoadingUsers = true;
    this.adminService.getUsers().pipe(
      retry({ count: 3, delay: 1000 }),
      finalize(() => {
        this.usersRequestInFlight = false;
        this.isLoadingUsers = false;
        this.changeDetector.markForCheck();
      }),
    ).subscribe({
      next: (users) => {
        this.users = users;
        this.usersLoaded = true;
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.usersLoaded = false;
        this.errorMessage = this.getErrorMessage(error, 'No se pudieron cargar los usuarios.');
        this.changeDetector.markForCheck();
      },
    });
  }

  clearUserFilters(): void {
    this.userSearchTerm = '';
    this.selectedUserRole = '';
  }

  isRestrictedWorkshopRole(role: string): boolean {
    return ['RecepcionTaller', 'TecnicoTaller'].includes(role);
  }

  setUserModule(module: string, checked: boolean): void {
    if (this.newUser.IsSuperAdmin || this.isRestrictedWorkshopRole(this.newUser.Rol)) return;
    this.newUser.Modules = checked
      ? [...new Set([...this.newUser.Modules, module])]
      : this.newUser.Modules.filter((item) => item !== module);
  }

  selectUserRole(role: string): void {
    this.newUser.Rol = role;
    if (this.isRestrictedWorkshopRole(role)) {
      this.newUser.Modules = [AppModules.Workshop];
      this.newUser.IsSuperAdmin = false;
    } else if (role === 'AdminTaller') {
      if (!this.newUser.Modules.includes(AppModules.Workshop)) {
        this.newUser.Modules = [...this.newUser.Modules, AppModules.Workshop];
      }
    }
  }

  setUserSuperAdmin(enabled: boolean): void {
    if (!this.canManageSuperAdmins || this.isRestrictedWorkshopRole(this.newUser.Rol)) return;
    this.newUser.IsSuperAdmin = enabled;
    if (enabled) this.newUser.Modules = [];
  }

  // Abre el diálogo para agregar un nuevo usuario.
  openUserDialog(): void {
    this.clearMessages();
    this.editingUserId = null;
    this.newUser = emptyUser();
    this.isUserDialogOpen = true;
  }

  // Abre el diálogo para editar un usuario existente.
  editUser(user: AdminUser): void {
    this.clearMessages();
    this.editingUserId = user.IdUsuario;
    this.newUser = {
      Usuario: user.Usuario,
      NombrePersona: user.NombrePersona,
      FechaExpiracion: user.FechaExpiracion?.slice(0, 10) ?? null,
      Estado: user.Estado,
      DominioP: user.DominioP,
      Dominio: user.Dominio,
      Rol: user.Rol,
      Modules: [...user.Modules],
      IsSuperAdmin: user.IsSuperAdmin,
    };
    this.isUserDialogOpen = true;
  }

  // Guarda el diálogo: crea el usuario si es nuevo o actualiza el que se está editando.
  // La contraseña inicial se genera en el backend y no se muestra en pantalla.
  saveUserDialog(): void {
    this.clearMessages();
    if (!this.newUser.Usuario.trim() || !this.newUser.NombrePersona.trim()) {
      this.errorMessage = 'El usuario y el nombre de la persona son obligatorios.';
      this.changeDetector.markForCheck();
      return;
    }

    if (this.editingUserId === null) this.createUser();
    else this.updateUser(this.editingUserId);
  }

  closeUserDialog(): void {
    this.isUserDialogOpen = false;
    this.editingUserId = null;
  }

  askRemoveUser(idUsuario: number): void {
    this.pendingUserId = idUsuario;
  }

  confirmRemoveUser(): void {
    if (this.pendingUserId === null) return;
    const idUsuario = this.pendingUserId;
    this.pendingUserId = null;
    this.adminService.deleteUser(idUsuario).subscribe({
      next: () => { this.message = 'Usuario eliminado.'; this.reload(); },
      error: (error) => this.errorMessage = this.getErrorMessage(error, 'No se pudo quitar el usuario.'),
    });
  }

  cancelRemoveUser(): void {
    this.pendingUserId = null;
  }

  askResetUserPassword(idUsuario: number, userName: string): void {
    this.pendingPasswordResetUserId = idUsuario;
    this.pendingPasswordResetUserName = userName;
    this.isPasswordResetDialogOpen = true;
  }

  resetUserPassword(): void {
    if (this.pendingPasswordResetUserId === null) return;
    const idUsuario = this.pendingPasswordResetUserId;
    this.adminService.resetUserPassword(idUsuario).subscribe({
      next: () => {
        this.message = `Contraseña de ${this.pendingPasswordResetUserName} restablecida.`;
        this.cancelPasswordReset();
        this.reload();
      },
      error: (error) => this.errorMessage = this.getErrorMessage(error, 'No se pudo restablecer la contraseña.'),
    });
  }

  cancelPasswordReset(): void {
    this.pendingPasswordResetUserId = null;
    this.pendingPasswordResetUserName = '';
    this.isPasswordResetDialogOpen = false;
  }

  private createUser(): void {
    // El input de fecha envía '' cuando queda vacío; el backend solo acepta null.
    const userToCreate: CreateAdminUser = {
      ...this.newUser,
      ...this.resolveModuleAccess(),
      FechaExpiracion: this.newUser.FechaExpiracion?.trim() || null,
    };
    this.adminService.createUser(userToCreate).subscribe({
      next: () => {
        this.message = 'Usuario agregado correctamente.';
        this.closeUserDialog();
        this.newUser = emptyUser();
        this.reload();
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.errorMessage = this.getErrorMessage(error, 'No se pudo agregar el usuario.');
        this.changeDetector.markForCheck();
      },
    });
  }

  private updateUser(idUsuario: number): void {
    // El input de fecha envía '' cuando queda vacío; el backend solo acepta null.
    const userToUpdate: CreateAdminUser = {
      Usuario: this.newUser.Usuario.trim(),
      NombrePersona: this.newUser.NombrePersona.trim(),
      FechaExpiracion: this.newUser.FechaExpiracion?.trim() || null,
      Estado: this.newUser.Estado,
      DominioP: this.newUser.DominioP,
      Dominio: this.newUser.Dominio,
      Rol: this.newUser.Rol,
      ...this.resolveModuleAccess(),
    };
    this.adminService.updateUser(idUsuario, userToUpdate).subscribe({
      next: () => {
        this.message = 'Usuario actualizado correctamente.';
        this.closeUserDialog();
        this.reload();
        this.changeDetector.markForCheck();
      },
      error: (error) => {
        this.errorMessage = this.getErrorMessage(error, 'No se pudo actualizar el usuario.');
        this.changeDetector.markForCheck();
      },
    });
  }

  // Los roles de recepción y técnico solo usan Taller; el administrador de taller siempre lo incluye.
  private resolveModuleAccess(): Pick<CreateAdminUser, 'Modules' | 'IsSuperAdmin'> {
    if (this.isRestrictedWorkshopRole(this.newUser.Rol)) {
      return { Modules: [AppModules.Workshop], IsSuperAdmin: false };
    }
    const modules = [...this.newUser.Modules];
    if (this.newUser.Rol === 'AdminTaller' && !modules.includes(AppModules.Workshop)) {
      modules.push(AppModules.Workshop);
    }
    return { Modules: modules, IsSuperAdmin: this.newUser.IsSuperAdmin };
  }

  private clearMessages(): void {
    this.message = '';
    this.errorMessage = '';
  }

  private getErrorMessage(error: ApiError, fallback: string): string {
    return apiErrorMessage(error, fallback);
  }
}
