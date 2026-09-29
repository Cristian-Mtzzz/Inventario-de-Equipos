import { Routes } from '@angular/router';
import { AuthComponent } from './auth/auth.component';
import { authGuard } from './auth/auth.guard';

// Define la navegación principal; las rutas protegidas declaran módulos de acceso.
export const routes: Routes = [
	{ path: '', pathMatch: 'full', redirectTo: 'login' },
	{ path: 'login', component: AuthComponent },
	{
		path: 'change-password',
		loadComponent: () => import('./auth/change-password.component').then((module) => module.ChangePasswordComponent),
	},
	{
		path: 'admin',
		canActivate: [authGuard],
		data: { modules: ['DISPOSITIVOS', 'REASIGNACIONES', 'TALLER', 'USUARIOS', 'MANTENIMIENTO'] },
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
		data: { modules: ['TALLER'] },
		loadComponent: () => import('./taller/taller.component').then((module) => module.TallerComponent),
	},
	{
		path: 'sin-acceso',
		loadComponent: () => import('./protected-placeholder/protected-placeholder.component').then((module) => module.ProtectedPlaceholderComponent),
	},
	{ path: '**', redirectTo: 'login' },
];
