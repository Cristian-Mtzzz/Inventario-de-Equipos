import { Routes } from '@angular/router';
import { AuthComponent } from './auth/auth.component';
import { authenticatedGuard, authGuard, loginGuard } from './auth/auth.guard';
import { ADMIN_PANEL_MODULES, AppModules } from './auth/app-modules';

// Define la navegación principal; las rutas protegidas declaran módulos de acceso.
const administrativeModules = ADMIN_PANEL_MODULES;

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
		data: { modules: [AppModules.Devices, AppModules.Inventory] },
		loadComponent: () => import('./inventory/inventory.component').then((module) => module.InventoryComponent),
	},
	{
		path: 'taller',
		canActivate: [authGuard],
		data: { role: ['Taller', 'AdminTaller'], modules: [AppModules.Workshop] },
		loadComponent: () => import('./taller/taller.component').then((module) => module.TallerComponent),
	},
	{
		path: 'taller/recepcion',
		canActivate: [authGuard],
		data: { role: 'RecepcionTaller', modules: [AppModules.Workshop] },
		loadComponent: () => import('./taller/taller.component').then((module) => module.TallerComponent),
	},
	{
		path: 'taller/tecnico',
		canActivate: [authGuard],
		data: { role: 'TecnicoTaller', modules: [AppModules.Workshop] },
		loadComponent: () => import('./taller/taller.component').then((module) => module.TallerComponent),
	},
	{
		path: 'tickets',
		canActivate: [authGuard],
		data: { role: ['AdminTicket', 'TecnicoTaller'], modules: [AppModules.Tickets] },
		loadComponent: () => import('./tickets/tickets.component').then((module) => module.TicketsComponent),
	},
	{
		path: 'sin-acceso',
		loadComponent: () => import('./protected-placeholder/protected-placeholder.component').then((module) => module.ProtectedPlaceholderComponent),
	},
	{ path: '**', redirectTo: 'login' },
];
