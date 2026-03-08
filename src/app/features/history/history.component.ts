import { Component, OnInit } from '@angular/core';
import { EventDetail } from '../../models/event-detail';

@Component({
  selector: 'app-history',
  templateUrl: './history.component.html',
  styleUrls: ['./history.component.scss']
})
export class HistoryComponent implements OnInit {
  allEvents: EventDetail[] = [];
  filterType = 'all';
  filterMonth = '';
  today = new Date().toISOString().split('T')[0];

  eventTypes = [
    { value: 'all',       label: 'Tutti' },
    { value: 'concert',   label: 'Concerti' },
    { value: 'lesson',    label: 'Lezioni' },
    { value: 'rehearsal', label: 'Prove' },
    { value: 'other',     label: 'Altro' },
  ];

  ngOnInit() {
    const stored: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    this.allEvents = stored.filter(e => e.date < this.today)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  get months(): string[] {
    const set = new Set(this.allEvents.map(e => e.date.substring(0, 7)));
    return Array.from(set).sort().reverse();
  }

  get filtered(): EventDetail[] {
    return this.allEvents
      .filter(e => this.filterType === 'all' || e.type === this.filterType)
      .filter(e => !this.filterMonth || e.date.startsWith(this.filterMonth));
  }

  formatDate(d: string): string {
    return new Date(d + 'T00:00:00').toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  }

  typeLabel(t: string): string {
    return this.eventTypes.find(et => et.value === t)?.label || t;
  }

  bandNames(band: { name: string }[]): string {
    return band.map(m => m.name).join(', ');
  }
}
