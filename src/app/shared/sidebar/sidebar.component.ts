import { Component, Input, Output, EventEmitter } from '@angular/core';

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

  navItems: NavItem[] = [
    { label: 'Dashboard',     icon: '⊞',  route: '/dashboard' },
    { label: 'Agenda',        icon: '📅', route: '/agenda' },
    { label: 'Eventi',        icon: '🎵', route: '/events' },
    { label: 'Spese',         icon: '🗺️', route: '/expenses' },
    { label: 'Comunicazione', icon: '📡', route: '/communication' },
    { label: 'Storico',       icon: '📋', route: '/history' },
    { label: 'Contabilità',   icon: '💼', route: '/accounting' },
    { label: 'Profilo',       icon: '👤', route: '/profile' },
  ];
}
