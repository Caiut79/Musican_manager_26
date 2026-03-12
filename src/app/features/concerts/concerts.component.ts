import { Component, OnInit } from '@angular/core';
import { FormArray, FormBuilder, Validators } from '@angular/forms';
import { EventDetail } from '../../models/event-detail';

type ConcertRecord = {
  id: string;
  title: string;
  date: string;
  timeStart: string;
  venue: string;
  address: string;
  lineupType: string;
  agreedFee: number;
  reimbursement: number;
  notes: string;
  bands: string[];
  musicians: string[];
  createdAt: string;
};

@Component({
  selector: 'app-concerts',
  templateUrl: './concerts.component.html',
  styleUrls: ['./concerts.component.scss']
})
export class ConcertsComponent implements OnInit {
  showForm = false;
  copiedId: string | null = null;
  concerts: ConcertRecord[] = [];

  form = this.fb.group({
    title: ['', Validators.required],
    date: ['', Validators.required],
    timeStart: ['', Validators.required],
    venue: [''],
    address: [''],
    lineupType: ['duo'],
    agreedFee: [0, Validators.min(0)],
    reimbursement: [0, Validators.min(0)],
    notes: [''],
    bands: this.fb.array([]),
    musicians: this.fb.array([])
  });

  constructor(private fb: FormBuilder) {}

  ngOnInit(): void {
    this.concerts = JSON.parse(localStorage.getItem('mm_concerts') || '[]');
  }

  get bandsArray(): FormArray {
    return this.form.get('bands') as FormArray;
  }

  get musiciansArray(): FormArray {
    return this.form.get('musicians') as FormArray;
  }

  addBand(): void {
    this.bandsArray.push(this.fb.control('', Validators.required));
  }

  addMusician(): void {
    this.musiciansArray.push(this.fb.control('', Validators.required));
  }

  removeBand(index: number): void {
    this.bandsArray.removeAt(index);
  }

  removeMusician(index: number): void {
    this.musiciansArray.removeAt(index);
  }

  saveConcert(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.value;
    const record: ConcertRecord = {
      id: crypto.randomUUID(),
      title: `${v.title || ''}`.trim(),
      date: `${v.date || ''}`,
      timeStart: `${v.timeStart || ''}`,
      venue: `${v.venue || ''}`.trim(),
      address: `${v.address || ''}`.trim(),
      lineupType: `${v.lineupType || 'duo'}`,
      agreedFee: Number(v.agreedFee || 0),
      reimbursement: Number(v.reimbursement || 0),
      notes: `${v.notes || ''}`.trim(),
      bands: (v.bands || []).map(x => `${x || ''}`.trim()).filter(Boolean),
      musicians: (v.musicians || []).map(x => `${x || ''}`.trim()).filter(Boolean),
      createdAt: new Date().toISOString()
    };
    this.concerts.unshift(record);
    localStorage.setItem('mm_concerts', JSON.stringify(this.concerts));
    this.appendToAgenda(record);
    this.form.reset({
      title: '',
      date: '',
      timeStart: '',
      venue: '',
      address: '',
      lineupType: 'duo',
      agreedFee: 0,
      reimbursement: 0,
      notes: ''
    });
    while (this.bandsArray.length) this.bandsArray.removeAt(0);
    while (this.musiciansArray.length) this.musiciansArray.removeAt(0);
    this.showForm = false;
  }

  copyConfirmationLink(id: string): void {
    const url = `${window.location.origin}/confirm/${id}`;
    navigator.clipboard.writeText(url).then(() => {
      this.copiedId = id;
      setTimeout(() => this.copiedId = null, 1800);
    });
  }

  private appendToAgenda(record: ConcertRecord): void {
    const events: EventDetail[] = JSON.parse(localStorage.getItem('mm_events') || '[]');
    const event: EventDetail = {
      id: record.id,
      title: record.title,
      date: record.date,
      timeStart: record.timeStart,
      type: 'concert',
      venue: record.venue,
      address: record.address,
      grossFee: record.agreedFee,
      netFee: record.agreedFee + record.reimbursement,
      band: record.musicians.map(name => ({ name })),
      status: 'confirmed',
      notes: record.notes,
      createdAt: record.createdAt
    };
    const deduped = events.filter(e => e.id !== event.id);
    deduped.push(event);
    localStorage.setItem('mm_events', JSON.stringify(deduped));
  }
}
