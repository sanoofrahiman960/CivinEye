import { Bell, FileBarChart, LayoutDashboard, ListChecks, LogOut, Map as MapIcon, Menu, UserCircle, Users } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';

import { ROLE_LABELS } from '../lib/styles';
import { useAuthStore } from '../store/auth';
import { useNotificationStore } from '../store/notifications';
import { useReferenceStore } from '../store/reference';
import { Button, LoadingState } from './ui';

const UNREAD_POLL_MS = 60_000;

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/issues', label: 'Issues', icon: ListChecks },
  { to: '/map', label: 'Map', icon: MapIcon },
  { to: '/reports', label: 'Reports & export', icon: FileBarChart },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/team', label: 'Team', icon: Users, adminOnly: true },
  { to: '/profile', label: 'Profile', icon: UserCircle },
];

export function Layout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const unread = useNotificationStore((s) => s.unread);
  const refreshUnread = useNotificationStore((s) => s.refreshUnread);
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    useReferenceStore.getState().load().catch(() => undefined);
    refreshUnread();
    const timer = setInterval(refreshUnread, UNREAD_POLL_MS);
    const onFocus = () => refreshUnread();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshUnread]);

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app">
      <a href="#main" className="sr-only">
        Skip to content
      </a>
      <aside className={`sidebar${menuOpen ? ' open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          <img src="/favicon.svg" alt="" width={32} height={32} />
          <div>
            CivicEye
            <small>Authority dashboard</small>
          </div>
        </div>
        <nav>
          {NAV.filter((item) => !item.adminOnly || user?.role === 'ADMIN').map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Icon size={18} aria-hidden />
              {label}
              {to === '/notifications' && unread ? (
                <span className="count" aria-label={`${unread} unread`}>
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : null}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="who">{user?.full_name}</div>
          <div>{user ? ROLE_LABELS[user.role] : ''}</div>
          <div>{user?.department?.name ?? 'All departments'}</div>
          <div>{user?.is_global_admin ? 'All areas (state)' : user?.service_areas.map((a) => `${a.name} ${a.level_label}`).join(', ') || 'No service area'}</div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Button variant="icon" className="menu-toggle" aria-label="Open menu" aria-expanded={menuOpen} icon={Menu} onClick={() => setMenuOpen((v) => !v)} />
          <div className="spacer" />
          <Button variant="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} icon={Bell} onClick={() => navigate('/notifications')} />
          <span className="muted" style={{ fontWeight: 600 }}>
            {user?.full_name}
          </span>
          <Button variant="outline" size="sm" icon={LogOut} onClick={signOut}>
            Sign out
          </Button>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          <Suspense fallback={<LoadingState />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
