import { Routes } from '@angular/router';
import { AuthComponent } from './auth.component';
import { authGuard } from './auth.guard';

export const routes: Routes = [
	{ path: '', pathMatch: 'full', redirectTo: 'login' },
	{ path: 'login', component: AuthComponent },
	{
		path: 'inventario',
		canActivate: [authGuard],
		data: { roles: ['Admin', 'UsuarioComun'] },
		loadComponent: () => import('./protected-placeholder.component').then((module) => module.ProtectedPlaceholderComponent),
	},
	{
		path: 'taller',
		canActivate: [authGuard],
		data: { roles: ['Admin', 'Taller'] },
		loadComponent: () => import('./protected-placeholder.component').then((module) => module.ProtectedPlaceholderComponent),
	},
	{ path: '**', redirectTo: 'login' },
];
