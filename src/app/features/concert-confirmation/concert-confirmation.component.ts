import { AfterViewInit, Component, ElementRef, ViewChild, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { provinceCodeFromAddressLabel } from '../../core/italian-geo';

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
  signatureData?: string;
  roleSettings?: any;
  exemptReasonUnder18?: boolean;
  exemptReasonStudentUnder25?: boolean;
  exemptReasonPensionerOver65?: boolean;
  exemptReasonEmployee?: boolean;
};

@Component({
  selector: 'app-concert-confirmation',
  templateUrl: './concert-confirmation.component.html',
  styleUrls: ['./concert-confirmation.component.scss']
})
export class ConcertConfirmationComponent implements OnInit, AfterViewInit {
  concert: ConcertRecord | null = null;
  profile: ProfileSnapshot = {};
  todayIso = new Date().toISOString().slice(0, 10);
  signatureDataUrl = '';
  editingSignature = false;
  signatureSaved = false;
  autoPdf = false;
  private drawing = false;
  private lastPoint: { x: number; y: number } | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  @ViewChild('sigCanvas') sigCanvas?: ElementRef<HTMLCanvasElement>;

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    const list: ConcertRecord[] = JSON.parse(localStorage.getItem('mm_concerts') || '[]');
    this.concert = list.find(x => x.id === id) || null;
    this.profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    const storedSig = `${localStorage.getItem('mm_signature') || ''}`.trim();
    this.signatureDataUrl = storedSig || `${this.profile.signatureData || ''}`.trim();
    this.editingSignature = !this.signatureDataUrl;
    this.autoPdf = this.route.snapshot.queryParamMap.get('pdf') === '1';
  }

  ngAfterViewInit(): void {
    if (this.editingSignature) this.initSignatureCanvas();
    if (this.autoPdf) {
      setTimeout(() => this.printPdf(), 280);
    }
  }

  printPdf(): void {
    window.print();
  }

  get fullName(): string {
    return `${this.profile.firstName || ''} ${this.profile.lastName || ''}`.trim() || 'N/D';
  }

  get exemptionEnabled(): boolean {
    const roleSettings = (this.profile as any)?.roleSettings || {};
    if (typeof roleSettings?.musician?.inpsExempt === 'boolean') {
      return roleSettings.musician.inpsExempt === true;
    }
    const musicianRoleFlag = (this.profile as any)?.musicianInpsExemptRole;
    if (typeof musicianRoleFlag === 'boolean') return musicianRoleFlag === true;
    return this.profile.inpsExempt === true;
  }

  get exemptionChecks(): { label: string; selected: boolean }[] {
    const employerType = `${this.profile.exemptEmployerType || ''}`;
    const employerText = `${this.profile.exemptEmployer || ''}`.toLowerCase();
    const reasons = (this.profile as any)?.roleSettings?.musician?.inpsExemptReasons || {};
    const under18 = typeof reasons.under18 === 'boolean' ? reasons.under18 : this.profile.exemptReasonUnder18 === true;
    const student = typeof reasons.studentUnder25 === 'boolean' ? reasons.studentUnder25 : this.profile.exemptReasonStudentUnder25 === true;
    const pensioner = typeof reasons.pensionerOver65 === 'boolean'
      ? reasons.pensionerOver65
      : (this.profile.exemptReasonPensionerOver65 === true || employerType === 'pensionato');
    const otherCoverage = typeof reasons.otherCoverage === 'boolean'
      ? reasons.otherCoverage
      : (this.profile.exemptReasonEmployee === true || employerType === 'dipendente' || employerType === 'altro' || !!employerText);
    return [
      { label: 'Soggetto giovane fino a 18 anni', selected: under18 },
      { label: 'Studente fino a 25 anni', selected: student },
      { label: 'Titolare di pensione oltre 65 anni', selected: pensioner },
      {
        label: 'Svolge attività lavorativa dipendente e/o autonoma con versamenti in altre gestioni',
        selected: otherCoverage
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

  get eventProvinceCode(): string {
    const code = provinceCodeFromAddressLabel(this.eventPlace);
    return code || '';
  }

  get musicianCode(): string {
    return `${localStorage.getItem('musicianCode') || localStorage.getItem('mm_affiliation_code') || ''}`.trim();
  }

  get eventBandLabel(): string {
    if (this.concert?.bands?.length) return this.sanitizeBandLabel(this.concert.bands.join(', '));
    if (this.concert?.musicians?.length) return this.concert.musicians.join(', ');
    const fromNotes = this.sanitizeBandLabel(this.extractBandFromNotes(this.concert?.notes || ''));
    if (fromNotes) return fromNotes;
    return 'N/D';
  }

  get travelOrigin(): string {
    const raw = `${this.concert?.notes || ''}`;
    const match = raw.match(/\[Spese viaggio:[^\]]*•\s*([^→\]]+)\s*→\s*([^\]]+)\]/i);
    return `${match?.[1] || ''}`.trim() || 'N/D';
  }

  get travelDestination(): string {
    const raw = `${this.concert?.notes || ''}`;
    const match = raw.match(/\[Spese viaggio:[^\]]*•\s*([^→\]]+)\s*→\s*([^\]]+)\]/i);
    return `${match?.[2] || ''}`.trim() || 'N/D';
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
    if (!this.eventProvinceCode) return 'Manca la provincia (sigla). Es: Udine (UD)';
    return '';
  }

  startEditSignature(): void {
    this.editingSignature = true;
    this.signatureSaved = false;
    setTimeout(() => this.initSignatureCanvas(), 0);
  }

  clearSignature(): void {
    const canvas = this.sigCanvas?.nativeElement;
    if (!canvas || !this.ctx) return;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.drawSignatureLine(canvas);
    this.signatureSaved = false;
  }

  saveSignature(): void {
    const canvas = this.sigCanvas?.nativeElement;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    if (!dataUrl) return;
    localStorage.setItem('mm_signature', dataUrl);
    const snapshot = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    localStorage.setItem('mm_profile_snapshot', JSON.stringify({ ...snapshot, signatureData: dataUrl }));
    this.signatureDataUrl = dataUrl;
    this.signatureSaved = true;
    this.editingSignature = false;
  }

  onSigMouseDown(event: MouseEvent): void {
    if (!this.ctx) return;
    this.drawing = true;
    this.lastPoint = this.pos(event.clientX, event.clientY);
  }

  onSigMouseMove(event: MouseEvent): void {
    if (!this.drawing || !this.ctx) return;
    const next = this.pos(event.clientX, event.clientY);
    if (!this.lastPoint) { this.lastPoint = next; return; }
    this.stroke(this.lastPoint, next);
    this.lastPoint = next;
  }

  onSigMouseUp(): void {
    this.drawing = false;
    this.lastPoint = null;
  }

  onSigTouchStart(event: TouchEvent): void {
    if (!this.ctx) return;
    event.preventDefault();
    const t = event.touches[0];
    if (!t) return;
    this.drawing = true;
    this.lastPoint = this.pos(t.clientX, t.clientY);
  }

  onSigTouchMove(event: TouchEvent): void {
    if (!this.drawing || !this.ctx) return;
    event.preventDefault();
    const t = event.touches[0];
    if (!t) return;
    const next = this.pos(t.clientX, t.clientY);
    if (!this.lastPoint) { this.lastPoint = next; return; }
    this.stroke(this.lastPoint, next);
    this.lastPoint = next;
  }

  onSigTouchEnd(): void {
    this.onSigMouseUp();
  }

  private initSignatureCanvas(): void {
    const canvas = this.sigCanvas?.nativeElement;
    if (!canvas) return;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
    this.drawSignatureLine(canvas);
    const saved = `${localStorage.getItem('mm_signature') || ''}`.trim() || `${this.profile.signatureData || ''}`.trim();
    if (saved) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = saved;
    }
  }

  private drawSignatureLine(canvas: HTMLCanvasElement): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(24, canvas.height - 22);
    ctx.lineTo(canvas.width - 24, canvas.height - 22);
    ctx.stroke();
    ctx.restore();
  }

  private pos(cX: number, cY: number): { x: number; y: number } {
    const canvas = this.sigCanvas?.nativeElement;
    const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
    const scaleX = canvas ? canvas.width / rect.width : 1;
    const scaleY = canvas ? canvas.height / rect.height : 1;
    return { x: (cX - rect.left) * scaleX, y: (cY - rect.top) * scaleY };
  }

  private stroke(a: { x: number; y: number }, b: { x: number; y: number }): void {
    if (!this.ctx) return;
    this.signatureSaved = false;
    this.ctx.beginPath();
    this.ctx.moveTo(a.x, a.y);
    this.ctx.lineTo(b.x, b.y);
    this.ctx.stroke();
  }

  private extractBandFromNotes(notes: string): string {
    const match = notes.match(/\[Rubrica:\s*([^\]]+)\]/i);
    const raw = `${match?.[1] || ''}`.trim();
    if (!raw) return '';
    return raw.split('|')[0].trim();
  }

  private sanitizeBandLabel(value: string): string {
    return `${value || ''}`
      .replace(/\|.*$/g, '')
      .replace(/•\s*priorit[aà].*$/gi, '')
      .replace(/-\s*priorit[aà].*$/gi, '')
      .trim();
  }

  private normalizeLabel(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();
  }
}
