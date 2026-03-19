import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, FormArray } from '@angular/forms';
import { EventDetail, BandMember } from '../../models/event-detail';

@Component({
  selector: 'app-events',
  templateUrl: './events.component.html',
  styleUrls: ['./events.component.scss']
})
export class EventsComponent implements OnInit {
  form!: FormGroup;
  events: EventDetail[] = [];
  showForm = false;
  filterType = 'all';
  today = new Date().toISOString().split('T')[0];

  eventTypes = [
    { value: 'concert',   label: 'Concerto' },
    { value: 'dj_set',    label: 'DJ Set' },
    { value: 'lesson',    label: 'Lezione' },
    { value: 'rehearsal', label: 'Prova' },
    { value: 'other',     label: 'Altro' },
  ];

  statusOptions = [
    { value: 'confirmed', label: 'Confermato' },
    { value: 'pending',   label: 'In attesa' },
    { value: 'cancelled', label: 'Annullato' },
  ];

  compensoTypes = [
    { value: 'fuori_fattura', label: 'Fuori fattura (contanti/privato)' },
    { value: 'in_fattura',    label: 'In fattura (fattura emessa)' },
  ];

  constructor(private fb: FormBuilder) {}

  ngOnInit() {
    this.loadEvents();
    this.initForm();
  }

  private loadEvents() {
    this.events = JSON.parse(localStorage.getItem('mm_events') || '[]');
  }

  private initForm() {
    this.form = this.fb.group({
      title:        ['', Validators.required],
      date:         ['', Validators.required],
      timeStart:    ['', Validators.required],
      type:         ['concert', Validators.required],
      venue:        [''],
      address:      [''],
      grossFee:     [0, [Validators.min(0)]],
      netFee:       [0, [Validators.min(0)]],
      compensoType: ['fuori_fattura'],
      status:       ['confirmed'],
      notes:        [''],
      band:         this.fb.array([]),
    });
  }

  get bandArray(): FormArray {
    return this.form.get('band') as FormArray;
  }

  addBandMember() {
    this.bandArray.push(this.fb.group({
      name:       ['', Validators.required],
      instrument: [''],
    }));
  }

  removeBandMember(i: number) { this.bandArray.removeAt(i); }

  submit() {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }

    const v = this.form.value;
    if ((v.type === 'concert' || v.type === 'dj_set') && this.hasPerformanceConflict(`${v.date || ''}`)) {
      window.alert('Data già occupata da un evento musica/DJ');
      return;
    }
    const newEvent: EventDetail = {
      id:           crypto.randomUUID(),
      title:        v.title,
      date:         v.date,
      timeStart:    v.timeStart,
      type:         v.type,
      venue:        v.venue || '',
      address:      v.address || '',
      grossFee:     +v.grossFee,
      netFee:       +v.netFee,
      compensoType: v.compensoType,
      status:       v.status,
      notes:        v.notes || '',
      band:         (v.band as BandMember[]).filter(m => m.name),
      createdAt:    new Date().toISOString(),
    };

    this.events.push(newEvent);
    this.saveEvents();
    this.form.reset({ type: 'concert', status: 'confirmed', grossFee: 0, netFee: 0, compensoType: 'fuori_fattura' });
    while (this.bandArray.length) { this.bandArray.removeAt(0); }
    this.showForm = false;
  }

  deleteEvent(id: string) {
    this.events = this.events.filter(e => e.id !== id);
    this.saveEvents();
  }

  private saveEvents() {
    localStorage.setItem('mm_events', JSON.stringify(this.events));
  }

  get filteredEvents(): EventDetail[] {
    const sorted = [...this.events].sort((a, b) => a.date.localeCompare(b.date));
    if (this.filterType === 'all') return sorted;
    return sorted.filter(e => e.type === this.filterType);
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('it-IT', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }

  typeLabel(type: string): string {
    return this.eventTypes.find(t => t.value === type)?.label || type;
  }

  statusLabel(status: string): string {
    return this.statusOptions.find(s => s.value === status)?.label || status;
  }

  compensoLabel(ct: string | undefined): string {
    if (!ct) return '';
    return ct === 'fuori_fattura' ? '💵 Fuori fattura' : '🧾 In fattura';
  }

  isInvalid(name: string): boolean {
    const c = this.form.get(name);
    return !!(c?.invalid && c?.touched);
  }

  openEventNav(e: EventDetail, app: 'waze' | 'google' | 'apple') {
    const dest = e.address || e.venue;
    if (!dest) return;
    const enc = encodeURIComponent(dest);
    const urls: Record<string, string> = {
      waze:   `https://waze.com/ul?q=${enc}&navigate=yes`,
      google: `https://www.google.com/maps/search/?api=1&query=${enc}`,
      apple:  `http://maps.apple.com/?q=${enc}`,
    };
    window.open(urls[app], '_blank');
  }

  private hasPerformanceConflict(date: string): boolean {
    return this.events.some(event => {
      if (event.status === 'cancelled') return false;
      const performance = event.type === 'concert' || event.type === 'dj_set';
      return performance && event.date === date;
    });
  }
}
