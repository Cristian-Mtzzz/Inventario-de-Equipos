import { Routes } from '@angular/router';
import { AuthComponent } from './auth/auth.component';
import { authGuard } from './auth/auth.guard';

// Define la navegación principal. Admin, Inventario y Taller se cargan bajo demanda
// y cada ruta declara los roles que el guard debe aceptar.
export const routes: Routes = [
	{ path: '', pathMatch: 'full', redirectTo: 'login' },
	{ path: 'login', component: AuthComponent },
	{
		path: 'admin',
		canActivate: [authGuard],
		data: { roles: ['Admin'] },
		loadComponent: () => import('./admin/admin.component').then((module) => module.AdminComponent),
	},
	{
		path: 'inventario',
		canActivate: [authGuard],
		data: { roles: ['Admin', 'UsuarioComun'] },
		loadComponent: () => import('./inventory/inventory.component').then((module) => module.InventoryComponent),
	},
	{
		path: 'taller',
		canActivate: [authGuard],
		data: { roles: ['Taller'] },
		loadComponent: () => import('./taller/taller.component').then((module) => module.TallerComponent),
	},
	{ path: '**', redirectTo: 'login' },
];
