import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { EventDetail } from '../../models/event-detail';
import { AppNotification } from '../../models/notification';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  musicianName = '';
  todayEvents: EventDetail[] = [];
  upcomingEvents: EventDetail[] = [];
  notifications: AppNotification[] = [];
  unreadCount = 0;
  today = new Date().toISOString().split('T')[0];

  quickLinks = [
    { label: 'Aggiungi Evento', icon: '🎵', route: '/events' },
    { label: 'Calcola Spese',   icon: '🗺️', route: '/expenses' },
    { label: 'Condividi Profilo', icon: '📡', route: '/communication' },
    { label: 'Contabilità',     icon: '💼', route: '/accounting' },
  ];

  constructor(private router: Router) {}

  ngOnInit() {
    const firstName = localStorage.getItem('mm_firstName') || '';
    const lastName  = localStorage.getItem('mm_lastName') || '';
    this.musicianName = [firstName, lastName].filter(Boolean).join(' ');

    const storedEvents: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    const now = this.today;
    this.todayEvents    = storedEvents.filter(e => e.date === now);
    this.upcomingEvents = storedEvents
      .filter(e => e.date > now)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);

    const storedNotifications: AppNotification[] = JSON.parse(localStorage.getItem('mm_notifications') || '[]');
    this.notifications = storedNotifications.slice(0, 5);
    this.unreadCount   = storedNotifications.filter(n => !n.read).length;
  }

  markAllRead() {
    const all: AppNotification[] = JSON.parse(localStorage.getItem('mm_notifications') || '[]');
    all.forEach(n => n.read = true);
    localStorage.setItem('mm_notifications', JSON.stringify(all));
    this.notifications.forEach(n => n.read = true);
    this.unreadCount = 0;
  }

  go(route: string) {
    this.router.navigate([route]);
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('it-IT', {
      weekday: 'short', day: 'numeric', month: 'short'
    });
  }

  eventTypeLabel(type: string): string {
    const map: Record<string, string> = {
      concert: 'Concerto', lesson: 'Lezione',
      rehearsal: 'Prova', other: 'Altro'
    };
    return map[type] || type;
  }
}
