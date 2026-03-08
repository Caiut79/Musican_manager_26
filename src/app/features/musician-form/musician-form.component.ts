import { Component, ViewChild, ElementRef } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { SupabaseService } from '../../core/supabase.service';
import { Musician } from '../../models/musician';
import { Router } from '@angular/router';

const INSTRUMENTS = ['Chitarra', 'Basso', 'Batteria', 'Pianoforte', 'Voce', 'Sax', 'Violino', 'Tromba'];
const LEVELS = ['Principiante', 'Intermedio', 'Avanzato', 'Professionista'];
const STYLES = ['Rock', 'Pop', 'Jazz', 'Blues', 'Classica', 'Metal', 'Funk', 'Soul', 'R&B', 'Hip Hop', 'Elettronica', 'Folk'];
const ENPALS_CATEGORIES = [
  { value: '',       label: '— Seleziona categoria —' },
  { value: 'A1',    label: 'A1 – Artista lirico' },
  { value: 'A2',    label: 'A2 – Orchestrale / Strumentista / Bandista' },
  { value: 'A3',    label: 'A3 – Cantante (pop, rock, jazz…)' },
  { value: 'A4',    label: 'A4 – Musicista solista professionista' },
  { value: 'B1',    label: 'B1 – Insegnante di musica (con esibizioni)' },
  { value: 'altro', label: 'Altra categoria' },
];

@Component({
  selector: 'app-musician-form',
  templateUrl: './musician-form.component.html',
  styleUrls: ['./musician-form.component.scss']
})
export class MusicianFormComponent {
  instruments = INSTRUMENTS;
  levels      = LEVELS;
  styles      = STYLES;
  enpalsCategories = ENPALS_CATEGORIES;

  steps = ['Anagrafica', 'Profilo musicale', 'Social', 'ENPALS & Fiscale', 'Ruolo'];
  currentStep = 0;
  submitting  = false;
  resultCode: string | null = null;
  error: string | null = null;
  signatureSaved = false;

  // ── Signature pad ──────────────────────────────────────────
  private _sigCanvas?: ElementRef<HTMLCanvasElement>;
  private _sigCtx?: CanvasRenderingContext2D;
  private _signing = false;

  @ViewChild('sigCanvas')
  set sigCanvas(el: ElementRef<HTMLCanvasElement> | undefined) {
    this._sigCanvas = el;
    if (el) {
      setTimeout(() => this.initSignatureCanvas(el.nativeElement), 50);
    }
  }
  // ───────────────────────────────────────────────────────────

  form = this.fb.group({
    // Step 0 – Anagrafica
    firstName:  ['', Validators.required],
    lastName:   ['', Validators.required],
    phone:      [''],
    birthDate:  [''],
    birthPlace: [''],
    fiscalCode: [''],
    residence:  [''],
    homeBase:   [''],
    // Step 1 – Profilo musicale
    instrument:      [''],
    level:           [''],
    stylesPlayed:    [[] as string[]],
    searchableStyles:[[] as string[]],
    // Step 2 – Social
    instagram: [''],
    facebook:  [''],
    youtube:   [''],
    tiktok:    [''],
    website:   [''],
    // Step 3 – ENPALS & Fiscale
    empalsPosition:     [''],
    workerType:         [''],
    inpsExempt:         [false],
    exemptEmployer:     [''],
    exemptEmployerType: ['dipendente'],
    inpsNumber:         [''],
    inpsStartDate:      [''],
    inpsEndDate:        [''],
    // Step 4 – Ruolo
    isTeacher:   [false],
    lessonColor: ['#2e7d32'],
    concertColor:['#1565c0'],
  });

  constructor(private fb: FormBuilder, private supabase: SupabaseService, private router: Router) {
    this.loadSavedProfile();
  }

  private loadSavedProfile() {
    const pairs: [string, string][] = [
      ['mm_firstName', 'firstName'], ['mm_lastName', 'lastName'],
      ['mm_homeBase',  'homeBase'],  ['mm_phone',    'phone'],
      ['mm_fiscalCode','fiscalCode'],
    ];
    const patch: Record<string, string> = {};
    pairs.forEach(([lk, fk]) => { const v = localStorage.getItem(lk); if (v) patch[fk] = v; });
    if (Object.keys(patch).length) this.form.patchValue(patch);
  }

  get progressPercent(): number {
    return ((this.currentStep + 1) / this.steps.length) * 100;
  }

  get workerType(): string { return this.form.get('workerType')?.value || ''; }
  get isTeacher(): boolean { return this.form.get('isTeacher')?.value === true; }

  goToStep(i: number): void {
    if (i >= 0 && i < this.steps.length) this.currentStep = i;
  }

  nextStep(): void {
    if (this.currentStep === 0) {
      ['firstName', 'lastName'].forEach(f => this.form.get(f)?.markAsTouched());
      if (this.form.get('firstName')?.invalid || this.form.get('lastName')?.invalid) return;
    }
    this.currentStep = Math.min(this.currentStep + 1, this.steps.length - 1);
  }

  prevStep(): void { this.currentStep = Math.max(this.currentStep - 1, 0); }

  controlInvalid(name: string): boolean {
    const c = this.form.get(name);
    return !!c && c.invalid && (c.touched || c.dirty);
  }

  // ── Signature pad methods ───────────────────────────────────
  private initSignatureCanvas(canvas: HTMLCanvasElement) {
    this._sigCtx = canvas.getContext('2d') ?? undefined;
    if (!this._sigCtx) return;
    const ctx = this._sigCtx;
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.strokeStyle = '#1e1b4b';
    this.drawSignatureLine(canvas);
    const saved = localStorage.getItem('mm_signature');
    if (saved) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = saved;
      this.signatureSaved = true;
    }
  }

  private drawSignatureLine(canvas: HTMLCanvasElement) {
    if (!this._sigCtx) return;
    const ctx = this._sigCtx;
    ctx.save();
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(24, canvas.height - 22);
    ctx.lineTo(canvas.width - 24, canvas.height - 22);
    ctx.stroke();
    ctx.restore();
  }

  private pos(canvas: HTMLCanvasElement, cX: number, cY: number) {
    const r = canvas.getBoundingClientRect();
    return { x: cX - r.left, y: cY - r.top };
  }

  onSigMouseDown(e: MouseEvent) {
    if (!this._sigCtx || !this._sigCanvas) return;
    this._signing = true;
    const p = this.pos(this._sigCanvas.nativeElement, e.clientX, e.clientY);
    this._sigCtx.beginPath(); this._sigCtx.moveTo(p.x, p.y);
  }
  onSigMouseMove(e: MouseEvent) {
    if (!this._signing || !this._sigCtx || !this._sigCanvas) return;
    const p = this.pos(this._sigCanvas.nativeElement, e.clientX, e.clientY);
    this._sigCtx.lineTo(p.x, p.y); this._sigCtx.stroke();
  }
  onSigMouseUp() { this._signing = false; }

  onSigTouchStart(e: TouchEvent) {
    e.preventDefault();
    if (!this._sigCtx || !this._sigCanvas) return;
    this._signing = true;
    const t = e.touches[0];
    const p = this.pos(this._sigCanvas.nativeElement, t.clientX, t.clientY);
    this._sigCtx.beginPath(); this._sigCtx.moveTo(p.x, p.y);
  }
  onSigTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (!this._signing || !this._sigCtx || !this._sigCanvas) return;
    const t = e.touches[0];
    const p = this.pos(this._sigCanvas.nativeElement, t.clientX, t.clientY);
    this._sigCtx.lineTo(p.x, p.y); this._sigCtx.stroke();
  }
  onSigTouchEnd() { this._signing = false; }

  clearSignature() {
    if (!this._sigCtx || !this._sigCanvas) return;
    const c = this._sigCanvas.nativeElement;
    this._sigCtx.clearRect(0, 0, c.width, c.height);
    this.drawSignatureLine(c);
    this.signatureSaved = false;
    localStorage.removeItem('mm_signature');
  }

  saveSignature() {
    if (!this._sigCanvas) return;
    localStorage.setItem('mm_signature', this._sigCanvas.nativeElement.toDataURL('image/png'));
    this.signatureSaved = true;
  }
  // ────────────────────────────────────────────────────────────

  async submit(): Promise<void> {
    this.error = null;
    this.resultCode = null;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      if (this.form.get('firstName')?.invalid || this.form.get('lastName')?.invalid) {
        this.currentStep = 0;
      }
      return;
    }
    this.submitting = true;
    try {
      const v = this.form.value;
      const isExempt = v.workerType === 'esente';
      const persist: [string, string | null | undefined][] = [
        ['lessonColor',   v.lessonColor],  ['concertColor',  v.concertColor],
        ['mm_firstName',  v.firstName],    ['mm_lastName',   v.lastName],
        ['mm_homeBase',   v.homeBase],     ['mm_phone',      v.phone],
        ['mm_fiscalCode', v.fiscalCode],
      ];
      persist.forEach(([k, val]) => { if (val) localStorage.setItem(k, val); });

      const m: Musician = {
        firstName:      v.firstName!,
        lastName:       v.lastName!,
        phone:          v.phone || undefined,
        birthDate:      v.birthDate || undefined,
        birthPlace:     v.birthPlace || undefined,
        fiscalCode:     v.fiscalCode || undefined,
        residence:      v.residence || undefined,
        workerType:     (v.workerType as Musician['workerType']) || undefined,
        empalsPosition: v.empalsPosition || undefined,
        enpalsCategory: v.empalsPosition || undefined,
        exemptEmployer: v.exemptEmployer || undefined,
        exemptEmployerType: (v.exemptEmployerType as Musician['exemptEmployerType']) || undefined,
        homeBase:       v.homeBase || undefined,
        instrument:     v.instrument || undefined,
        level:          v.level || undefined,
        stylesPlayed:   v.stylesPlayed || [],
        searchableStyles: v.searchableStyles || [],
        social: {
          instagram: v.instagram || undefined,
          facebook:  v.facebook  || undefined,
          youtube:   v.youtube   || undefined,
          tiktok:    v.tiktok    || undefined,
          website:   v.website   || undefined,
        },
        inpsExempt: isExempt,
        inpsData: isExempt
          ? { number: v.inpsNumber || undefined, startDate: v.inpsStartDate || undefined, endDate: v.inpsEndDate || undefined }
          : null,
        isTeacher:   v.isTeacher   || false,
        lessonColor: v.lessonColor  || null,
        concertColor:v.concertColor || null,
        signatureData: localStorage.getItem('mm_signature') || undefined,
      };

      const existingId = localStorage.getItem('musicianId') || undefined;
      const { id, code } = await this.supabase.saveMusician(m, existingId);
      if (id)   localStorage.setItem('musicianId',   id);
      if (code) localStorage.setItem('musicianCode', code);
      if (id) await this.supabase.syncAllFromLocalStorage(id);
      this.resultCode = code || null;
    } catch (e: any) {
      this.error = e?.message || 'Errore sconosciuto';
    } finally {
      this.submitting = false;
    }
  }

  goAgenda(): void { this.router.navigateByUrl('/agenda'); }
}
