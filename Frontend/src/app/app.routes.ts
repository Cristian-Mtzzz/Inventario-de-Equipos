import { Routes } from '@angular/router';
import { AuthComponent } from './auth/auth.component';
import { authenticatedGuard, authGuard, loginGuard } from './auth/auth.guard';

// Define la navegación principal; las rutas protegidas declaran módulos de acceso.
const administrativeModules = ['DISPOSITIVOS', 'REASIGNACIONES', 'TALLER', 'USUARIOS', 'MANTENIMIENTO'];

export const routes: Routes = [
	{ path: '', pathMatch: 'full', redirectTo: 'login' },
	{ path: 'login', component: AuthComponent, canActivate: [loginGuard] },
	{
		path: 'change-password',
		canActivate: [authenticatedGuard],
		loadComponent: () => import('./auth/change-password.component').then((module) => module.ChangePasswordComponent),
	},
	{
		path: 'admin',
		canActivate: [authGuard],
		data: { role: 'Admin', modules: administrativeModules },
		loadComponent: () => import('./admin/admin.component').then((module) => module.AdminComponent),
	},
	{
		path: 'usuario',
		canActivate: [authGuard],
		data: { role: 'UsuarioComun', modules: administrativeModules },
		loadComponent: () => import('./admin/admin.component').then((module) => module.AdminComponent),
	},
	{
		path: 'inventario',
		canActivate: [authGuard],
		data: { modules: ['DISPOSITIVOS', 'INVENTARIO'] },
		loadComponent: () => import('./inventory/inventory.component').then((module) => module.InventoryComponent),
	},
	{
		path: 'taller',
		canActivate: [authGuard],
		data: { role: 'Taller', modules: administrativeModules },
		loadComponent: () => import('./admin/admin.component').then((module) => module.AdminComponent),
	},
	{
		path: 'sin-acceso',
		loadComponent: () => import('./protected-placeholder/protected-placeholder.component').then((module) => module.ProtectedPlaceholderComponent),
	},
	{ path: '**', redirectTo: 'login' },
];
