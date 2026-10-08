import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { LoginPage } from './features/auth/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from './features/auth/PasswordResetPages';
import { RegisterPage } from './features/auth/RegisterPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { ContactsPage } from './features/contacts/ContactsPage';
import { HomePage } from './features/home/HomePage';
import { InboxPage } from './features/inbox/InboxPage';
import { TasksPage } from './features/tasks/TasksPage';
import { LegalPage } from './features/legal/legal';
import { PipelinePage } from './features/pipeline/PipelinePage';
import { CompanySettingsPage } from './features/settings/CompanySettingsPage';
import { AcceptInvitationPage } from './features/team/AcceptInvitationPage';
import { TeamPage } from './features/team/TeamPage';
import { authClient } from './shared/auth-client';

const rootRoute = createRootRoute({ component: Outlet });

async function requireSession() {
  const { data } = await authClient.getSession();
  if (!data) throw redirect({ to: '/login' });
}

const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/', beforeLoad: requireSession, component: HomePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/register', component: RegisterPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/forgot-password', component: ForgotPasswordPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/reset-password', component: ResetPasswordPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', beforeLoad: requireSession, component: CompanySettingsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/team', beforeLoad: requireSession, component: TeamPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/deals', beforeLoad: requireSession, component: PipelinePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/contacts', beforeLoad: requireSession, component: ContactsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/inbox', beforeLoad: requireSession, component: InboxPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/tasks', beforeLoad: requireSession, component: TasksPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/reports', beforeLoad: requireSession, component: ReportsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/legal/terminos', component: () => <LegalPage doc="terminos" /> }),
  createRoute({ getParentRoute: () => rootRoute, path: '/legal/privacidad', component: () => <LegalPage doc="privacidad" /> }),
  createRoute({ getParentRoute: () => rootRoute, path: '/invitations/$invitationId', component: AcceptInvitationPage }),
];

export const router = createRouter({ routeTree: rootRoute.addChildren(routes) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
