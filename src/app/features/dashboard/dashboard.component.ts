import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { EventDetail } from '../../models/event-detail';
import { AppNotification } from '../../models/notification';

type CalendarCell = {
  date: string;
  day: number;
  currentMonth: boolean;
  events: EventDetail[];
};

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit {
  musicianName = '';
  todayEvents: EventDetail[] = [];
  upcomingEvents: EventDetail[] = [];
  allEvents: EventDetail[] = [];
  calendarView: 'table' | 'agenda' = 'table';
  calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  calendarWeeks: CalendarCell[][] = [];
  selectedDate: string | null = null;
  quickCreateDone = false;
  quickCreateLabel = '';
  notifications: AppNotification[] = [];
  unreadCount = 0;
  today = new Date().toISOString().split('T')[0];

  dayHeaders = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

  quickLinks = [
    { label: 'Nuovo Concerto', icon: 'ti-music',      route: '/concerts',  sub: 'Aggiungi serata' },
    { label: 'Nuova Lezione',  icon: 'ti-school',     route: '/teaching',  sub: 'Agenda lezioni' },
    { label: 'Calcola Spese',  icon: 'ti-map-pin',    route: '/expenses',  sub: 'Rimborsi km' },
    { label: 'Report',         icon: 'ti-chart-bar',  route: '/reports',   sub: 'Statistiche' },
    { label: 'Archivio',       icon: 'ti-archive',    route: '/archive',   sub: 'Documenti' }
  ];

  constructor(private router: Router) {}

  ngOnInit() {
    const firstName = localStorage.getItem('mm_firstName') || '';
    const lastName  = localStorage.getItem('mm_lastName') || '';
    this.musicianName = [firstName, lastName].filter(Boolean).join(' ');

    const storedEvents: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    this.allEvents = [...storedEvents].sort((a, b) => a.date.localeCompare(b.date));
    const now = this.today;
    this.todayEvents    = storedEvents.filter(e => e.date === now);
    this.upcomingEvents = storedEvents
      .filter(e => e.date > now)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
    this.buildCalendar();

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

  go(route: string) { this.router.navigate([route]); }

  openCreatePicker(cell: CalendarCell): void {
    if (!cell.currentMonth) return;
    this.selectedDate = cell.date;
    this.quickCreateDone = false;
    this.quickCreateLabel = '';
  }

  closeCreatePicker(): void {
    this.selectedDate = null;
  }

  chooseCreate(kind: 'concert' | 'proposal' | 'lesson'): void {
    if (!this.selectedDate) return;
    const now = new Date().toISOString();
    const isLesson = kind === 'lesson';
    const isProposal = kind === 'proposal';
    const event: EventDetail = {
      id: crypto.randomUUID(),
      title: isLesson ? 'Nuova lezione' : (isProposal ? 'Proposta concerto (bozza)' : 'Nuovo concerto'),
      date: this.selectedDate,
      timeStart: isLesson ? '16:00' : '21:00',
      venue: '',
      address: '',
      type: isLesson ? 'lesson' : 'concert',
      band: [],
      grossFee: 0,
      netFee: 0,
      compensoType: 'fuori_fattura',
      notes: isProposal ? 'Bozza creata da calendario dashboard' : '',
      status: isProposal ? 'pending' : 'confirmed',
      createdAt: now
    };
    const all: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    all.push(event);
    localStorage.setItem('mm_events', JSON.stringify(all));
    this.allEvents = [...all].sort((a, b) => a.date.localeCompare(b.date));
    this.todayEvents = this.allEvents.filter(e => e.date === this.today);
    this.upcomingEvents = this.allEvents.filter(e => e.date > this.today).slice(0, 5);
    this.buildCalendar();
    this.quickCreateDone = true;
    this.quickCreateLabel = isLesson ? 'Lezione inserita' : (isProposal ? 'Proposta bozza inserita' : 'Concerto inserito');
    setTimeout(() => {
      this.closeCreatePicker();
    }, 900);
  }

  goToday(): void {
    this.calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    this.buildCalendar();
  }

  chipClass(type: string): string {
    const map: Record<string, string> = {
      concert: 'chip-blue', lesson: 'chip-green',
      rehearsal: 'chip-orange', other: 'chip-teal'
    };
    return map[type] || 'chip-gray';
  }

  notifIconClass(type: string): string {
    const map: Record<string, string> = {
      booking_request: 'ni-orange', booking_accepted: 'ni-green',
      booking_rejected: 'ni-red', event_reminder: 'ni-blue', info: 'ni-gray'
    };
    return map[type] || 'ni-gray';
  }

  get monthLabel(): string {
    return this.calendarMonth.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
  }

  get agendaEvents(): EventDetail[] {
    const m = this.calendarMonth.getMonth();
    const y = this.calendarMonth.getFullYear();
    return this.allEvents.filter(e => {
      const d = new Date(`${e.date}T00:00:00`);
      return d.getMonth() === m && d.getFullYear() === y;
    });
  }

  prevMonth(): void {
    this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() - 1, 1);
    this.buildCalendar();
  }

  nextMonth(): void {
    this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() + 1, 1);
    this.buildCalendar();
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('it-IT', {
      weekday: 'short', day: 'numeric', month: 'short'
    });
  }

  formatDayLabel(dateStr: string): string {
    return new Date(`${dateStr}T00:00:00`).toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  eventTypeLabel(type: string): string {
    const map: Record<string, string> = {
      concert: 'Concerto', lesson: 'Lezione',
      rehearsal: 'Prova', other: 'Altro'
    };
    return map[type] || type;
  }

  private buildCalendar(): void {
    const y = this.calendarMonth.getFullYear();
    const m = this.calendarMonth.getMonth();
    const first = new Date(y, m, 1);
    const startDay = first.getDay(); // Sunday=0 first column
    const firstCellDate = new Date(y, m, 1 - startDay);
    const weeks: CalendarCell[][] = [];
    for (let w = 0; w < 6; w++) {
      const row: CalendarCell[] = [];
      for (let d = 0; d < 7; d++) {
        const cur = new Date(firstCellDate.getFullYear(), firstCellDate.getMonth(), firstCellDate.getDate() + (w * 7 + d));
        const iso = cur.toISOString().split('T')[0];
        row.push({
          date: iso,
          day: cur.getDate(),
          currentMonth: cur.getMonth() === m,
          events: this.allEvents.filter(e => e.date === iso)
        });
      }
      weeks.push(row);
    }
    // Remove trailing all-out-of-month rows
    while (weeks.length > 1 && weeks[weeks.length - 1].every(c => !c.currentMonth)) {
      weeks.pop();
    }
    this.calendarWeeks = weeks;
  }
}
