import { Component, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { SupabaseService } from '../../core/supabase.service';
import { EventDetail } from '../../models/event-detail';

type EventItem = { id: string; title: string; date: string; type: 'lesson' | 'concert' | 'dj_set'; counterpart: string };

@Component({
  selector: 'app-agenda',
  templateUrl: './agenda.component.html',
  styleUrls: ['./agenda.component.scss']
})
export class AgendaComponent implements OnInit {
  events: EventItem[] = [];
  formError = '';

  form = this.fb.group({
    title: ['', Validators.required],
    date: ['', Validators.required],
    type: ['lesson' as 'lesson' | 'concert' | 'dj_set', Validators.required]
  });

  lessonColor = localStorage.getItem('lessonColor') || '#2e7d32';
  concertColor = localStorage.getItem('concertColor') || '#1565c0';
  djColor = localStorage.getItem('djColor') || '#8b5cf6';

  constructor(private fb: FormBuilder, private supabase: SupabaseService) {}

  ngOnInit(): void {
    const allEvents: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    this.events = allEvents
      .filter(event => event.type === 'lesson' || event.type === 'concert' || event.type === 'dj_set')
      .map(event => ({
        id: event.id,
        title: event.title,
        date: event.date,
        type: event.type === 'lesson' ? 'lesson' : (event.type === 'dj_set' ? 'dj_set' : 'concert'),
        counterpart: this.resolveCounterpart(event)
      } as EventItem))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  async add(): Promise<void> {
    if (this.form.invalid) return;
    const v = this.form.value;
    this.formError = '';
    if ((v.type === 'concert' || v.type === 'dj_set') && this.hasPerformanceConflict(v.date || '')) {
      this.formError = 'Data già occupata da un evento musica/DJ';
      return;
    }
    const created: EventItem = { id: crypto.randomUUID(), title: v.title!, date: v.date!, type: v.type!, counterpart: '' };
    this.events = [created, ...this.events].sort((a, b) => b.date.localeCompare(a.date));
    const mmEvents: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    mmEvents.unshift({
      id: created.id,
      title: created.title,
      date: created.date,
      timeStart: '',
      venue: '',
      address: '',
      type: created.type,
      band: [],
      grossFee: 0,
      netFee: 0,
      status: 'pending',
      createdAt: new Date().toISOString()
    });
    localStorage.setItem('mm_events', JSON.stringify(mmEvents));
    const musicianId = localStorage.getItem('musicianId');
    if (musicianId) {
      try {
        await this.supabase.addEvent(musicianId, created.title, created.date, created.type);
      } catch {
      }
    }
    this.form.reset({ type: 'lesson' });
  }

  eventColor(type: EventItem['type']): string {
    if (type === 'lesson') return this.lessonColor;
    if (type === 'dj_set') return this.djColor;
    return this.concertColor;
  }

  eventTypeLabel(type: EventItem['type']): string {
    if (type === 'lesson') return 'Lezione';
    if (type === 'dj_set') return 'DJ Set';
    return 'Concerto';
  }

  private resolveCounterpart(event: EventDetail): string {
    if (event.type === 'concert' || event.type === 'dj_set') {
      const bandNames = Array.isArray(event.band) ? event.band.map(x => `${x?.name || ''}`.trim()).filter(Boolean) : [];
      if (bandNames.length) return bandNames.join(', ');
      const venue = `${event.venue || ''}`.trim();
      return venue;
    }
    const venue = `${event.venue || ''}`.trim();
    if (venue) return venue;
    const fromTitle = `${event.title || ''}`.match(/con\s+(.+)$/i);
    return fromTitle?.[1]?.trim() || '';
  }

  private hasPerformanceConflict(date: string): boolean {
    const allEvents: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    return allEvents.some(event => {
      if (event.status === 'cancelled') return false;
      const performance = event.type === 'concert' || event.type === 'dj_set';
      return performance && event.date === date;
    });
  }
}
