import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

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

type ProfileSnapshot = {
  firstName?: string;
  lastName?: string;
  birthDate?: string;
  birthPlace?: string;
  residence?: string;
  fiscalCode?: string;
  inpsExempt?: boolean;
  exemptEmployer?: string;
  exemptEmployerType?: 'dipendente' | 'pensionato' | 'altro';
};

@Component({
  selector: 'app-concert-confirmation',
  templateUrl: './concert-confirmation.component.html',
  styleUrls: ['./concert-confirmation.component.scss']
})
export class ConcertConfirmationComponent implements OnInit {
  concert: ConcertRecord | null = null;
  profile: ProfileSnapshot = {};
  todayIso = new Date().toISOString().slice(0, 10);
  signatureDataUrl = '';

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    const list: ConcertRecord[] = JSON.parse(localStorage.getItem('mm_concerts') || '[]');
    this.concert = list.find(x => x.id === id) || null;
    this.profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    this.signatureDataUrl = `${localStorage.getItem('mm_signature') || ''}`.trim();
  }

  printPdf(): void {
    window.print();
  }

  get fullName(): string {
    return `${this.profile.firstName || ''} ${this.profile.lastName || ''}`.trim() || 'N/D';
  }

  get exemptionEnabled(): boolean {
    return this.profile.inpsExempt === true;
  }

  get exemptionChecks(): { label: string; selected: boolean }[] {
    const employerType = `${this.profile.exemptEmployerType || ''}`;
    const employerText = `${this.profile.exemptEmployer || ''}`.toLowerCase();
    return [
      { label: 'Soggetto giovane fino a 18 anni', selected: false },
      { label: 'Studente fino a 25 anni', selected: false },
      { label: 'Titolare di pensione oltre 65 anni', selected: employerType === 'pensionato' },
      {
        label: 'Svolge attività lavorativa dipendente e/o autonoma con versamenti in altre gestioni',
        selected: employerType === 'dipendente' || employerType === 'altro' || !!employerText
      }
    ];
  }

  get eventPlace(): string {
    const address = `${this.concert?.address || ''}`.trim();
    if (address) return address;
    const venue = `${this.concert?.venue || ''}`.trim();
    if (!venue) return 'N/D';
    const band = this.eventBandLabel;
    if (band !== 'N/D' && this.normalizeLabel(venue) === this.normalizeLabel(band)) return 'N/D';
    return venue;
  }

  get eventBandLabel(): string {
    if (this.concert?.bands?.length) return this.concert.bands.join(', ');
    if (this.concert?.musicians?.length) return this.concert.musicians.join(', ');
    const fromNotes = this.extractBandFromNotes(this.concert?.notes || '');
    if (fromNotes) return fromNotes;
    return 'N/D';
  }

  formatItalianDate(raw: string | undefined | null): string {
    const value = `${raw || ''}`.trim();
    if (!value) return 'N/D';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  get eventProvinceHint(): string {
    const place = this.eventPlace;
    if (place === 'N/D') return 'Inserire luogo e provincia';
    return '';
  }

  private extractBandFromNotes(notes: string): string {
    const match = notes.match(/\[Rubrica:\s*([^\]]+)\]/i);
    const raw = `${match?.[1] || ''}`.trim();
    if (!raw) return '';
    return raw.split('|')[0].trim();
  }

  private normalizeLabel(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
  }
}
