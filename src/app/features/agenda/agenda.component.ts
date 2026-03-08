import { Component } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { SupabaseService } from '../../core/supabase.service';

type EventItem = { title: string; date: string; type: 'lesson' | 'concert' };

@Component({
  selector: 'app-agenda',
  templateUrl: './agenda.component.html',
  styleUrls: ['./agenda.component.scss']
})
export class AgendaComponent {
  events: EventItem[] = [];

  form = this.fb.group({
    title: ['', Validators.required],
    date: ['', Validators.required],
    type: ['lesson' as 'lesson' | 'concert', Validators.required]
  });

  lessonColor = localStorage.getItem('lessonColor') || '#2e7d32';
  concertColor = localStorage.getItem('concertColor') || '#1565c0';

  constructor(private fb: FormBuilder, private supabase: SupabaseService) {}

  async add(): Promise<void> {
    if (this.form.invalid) return;
    const v = this.form.value;
    this.events = [...this.events, { title: v.title!, date: v.date!, type: v.type! }];
    const musicianId = localStorage.getItem('musicianId');
    if (musicianId) {
      try {
        await this.supabase.addEvent(musicianId, v.title!, v.date!, v.type!);
      } catch {
      }
    }
    this.form.reset({ type: 'lesson' });
  }
}
