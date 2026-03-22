import { Component, Input, Output, EventEmitter, HostListener } from '@angular/core';
import { ThemeService, Theme } from '../../services/theme.service';

export type NavItem = {
  label: string;
  icon: string;
  route: string;
};

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.scss']
})
export class SidebarComponent {
  @Input() collapsed = false;
  @Input() mobileOpen = false;
  @Output() sidebarToggle = new EventEmitter<void>();
  @Output() sidebarClose = new EventEmitter<void>();

  constructor(public themeService: ThemeService) {}

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.mobileOpen) this.sidebarClose.emit();
  }

  get currentTheme(): Theme { return this.themeService.theme; }

  setTheme(t: Theme): void { this.themeService.apply(t); }

  private baseNavItems: NavItem[] = [
    { label: 'Dashboard',     icon: 'ti-layout-dashboard', route: '/dashboard' },
    { label: 'Agenda',        icon: 'ti-calendar',         route: '/agenda' },
    { label: 'Concerti',      icon: 'ti-music',            route: '/concerts' },
    { label: 'Insegnamento',  icon: 'ti-school',           route: '/teaching' },
    { label: 'Report',        icon: 'ti-chart-bar',        route: '/reports' },
    { label: 'Spese',         icon: 'ti-map-pin',          route: '/expenses' },
    { label: 'Comunicazione', icon: 'ti-message-circle',   route: '/communication' },
    { label: 'Rubrica',       icon: 'ti-address-book',     route: '/contacts' },
    { label: 'Archivio',      icon: 'ti-archive',          route: '/archive' },
    { label: 'Contratti',     icon: 'ti-file-text',        route: '/contracts' },
    { label: 'Storico',       icon: 'ti-clock',            route: '/history' },
    { label: 'Contabilità',   icon: 'ti-briefcase',        route: '/accounting' },
    { label: 'Fatturazione',  icon: 'ti-receipt',          route: '/fatturazione' },
    { label: 'Profilo',       icon: 'ti-user-circle',      route: '/profile' },
  ];

  get navItems(): NavItem[] {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    const isTeacher = profile?.isTeacher === true;
    let items = this.baseNavItems;
    if (!isTeacher) items = items.filter(item => item.route !== '/teaching');
    return items;
  }
}
