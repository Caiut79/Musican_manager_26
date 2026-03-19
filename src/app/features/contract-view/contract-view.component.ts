import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { EventDetail } from '../../models/event-detail';

interface Contract {
  id: string;
  contractType: 'musicista' | 'dj' | 'insegnante';
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  responsibleName?: string;
  eventTitle: string;
  eventDate: string;
  eventLocation: string;
  agreedFee: number;
  billingMode: 'in_fattura' | 'fuori_fattura';
  notes: string;
  contractText: string;
  signatureData: string | null;
  signedAt: string | null;
  createdAt: string;
  uniqueLink: string;
  status: 'draft' | 'sent' | 'signed' | 'archived';
  musicianName: string;
  musicianCode: string;
  djCode: string;
  workerType: string;
  taxRegime: string;
}

@Component({
  selector: 'app-contract-view',
  templateUrl: './contract-view.component.html',
  styleUrls: ['./contract-view.component.scss']
})
export class ContractViewComponent implements OnInit {
  contract: Contract | null = null;
  notFound = false;
  alreadySigned = false;
  signSuccess = false;
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

  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) { this.notFound = true; return; }
    const stored = localStorage.getItem('mm_contracts');
    const contracts: Contract[] = stored ? JSON.parse(stored) : [];
    this.contract = contracts.find(c => c.id === id) || null;
    if (!this.contract) { this.notFound = true; return; }
    if (this.contract.status === 'signed') {
      this.alreadySigned = true;
      this.upsertAgendaEventFromContract(this.contract);
    }
  }

  private initSignatureCanvas(canvas: HTMLCanvasElement) {
    this._sigCtx = canvas.getContext('2d') ?? undefined;
    if (!this._sigCtx) return;
    const ctx = this._sigCtx;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1e1b4b';
    this.drawSignatureLine(canvas);
    if (this.contract?.signatureData) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = this.contract!.signatureData!;
    }
  }

  private drawSignatureLine(canvas: HTMLCanvasElement) {
    if (!this._sigCtx) return;
    const ctx = this._sigCtx;
    ctx.save();
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
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
    this._sigCtx.beginPath();
    this._sigCtx.moveTo(p.x, p.y);
  }

  onSigMouseMove(e: MouseEvent) {
    if (!this._signing || !this._sigCtx || !this._sigCanvas) return;
    const p = this.pos(this._sigCanvas.nativeElement, e.clientX, e.clientY);
    this._sigCtx.lineTo(p.x, p.y);
    this._sigCtx.stroke();
  }

  onSigMouseUp() { this._signing = false; }

  onSigTouchStart(e: TouchEvent) {
    e.preventDefault();
    if (!this._sigCtx || !this._sigCanvas) return;
    this._signing = true;
    const t = e.touches[0];
    const p = this.pos(this._sigCanvas.nativeElement, t.clientX, t.clientY);
    this._sigCtx.beginPath();
    this._sigCtx.moveTo(p.x, p.y);
  }

  onSigTouchMove(e: TouchEvent) {
    e.preventDefault();
    if (!this._signing || !this._sigCtx || !this._sigCanvas) return;
    const t = e.touches[0];
    const p = this.pos(this._sigCanvas.nativeElement, t.clientX, t.clientY);
    this._sigCtx.lineTo(p.x, p.y);
    this._sigCtx.stroke();
  }

  onSigTouchEnd() { this._signing = false; }

  clearSignature() {
    if (!this._sigCtx || !this._sigCanvas) return;
    const c = this._sigCanvas.nativeElement;
    this._sigCtx.clearRect(0, 0, c.width, c.height);
    this.drawSignatureLine(c);
  }

  signContract() {
    if (!this._sigCanvas || !this.contract) return;
    const sigData = this._sigCanvas.nativeElement.toDataURL('image/png');
    const stored = localStorage.getItem('mm_contracts');
    const contracts: Contract[] = stored ? JSON.parse(stored) : [];
    const idx = contracts.findIndex(c => c.id === this.contract!.id);
    if (idx < 0) return;
    contracts[idx].signatureData = sigData;
    contracts[idx].signedAt = new Date().toISOString();
    contracts[idx].status = 'signed';
    localStorage.setItem('mm_contracts', JSON.stringify(contracts));
    this.upsertAgendaEventFromContract(contracts[idx]);
    this.contract = { ...contracts[idx] };
    this.signSuccess = true;
  }

  private upsertAgendaEventFromContract(contract: Contract): void {
    const raw = localStorage.getItem('mm_events');
    const events: EventDetail[] = raw ? JSON.parse(raw) : [];
    const marker = `contract:${contract.id}`;
    const existing = events.find(event => `${event.notes || ''}`.includes(marker));
    if (existing) {
      if (existing.status !== 'pending' && !this.hasAnyPayment(existing.id)) {
        existing.status = 'pending';
        localStorage.setItem('mm_events', JSON.stringify(events));
      }
      return;
    }

    const eventType: EventDetail['type'] = contract.contractType === 'insegnante'
      ? 'lesson'
      : (contract.contractType === 'dj' ? 'dj_set' : 'concert');
    const fallbackTitle = contract.contractType === 'insegnante'
      ? 'Lezione da contratto'
      : (contract.contractType === 'dj' ? 'DJ Set da contratto' : 'Concerto da contratto');

    const newEvent: EventDetail = {
      id: crypto.randomUUID(),
      title: contract.eventTitle || fallbackTitle,
      date: contract.eventDate || new Date().toISOString().slice(0, 10),
      timeStart: '',
      timeEnd: '',
      venue: contract.eventLocation || '',
      address: contract.eventLocation || '',
      type: eventType,
      band: [],
      grossFee: Number(contract.agreedFee || 0),
      netFee: Number(contract.agreedFee || 0),
      compensoType: contract.billingMode,
      notes: `${contract.notes ? contract.notes + ' · ' : ''}${marker}`,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    events.push(newEvent);
    localStorage.setItem('mm_events', JSON.stringify(events));
  }

  private hasAnyPayment(eventId: string): boolean {
    const payments: { eventId?: string }[] = JSON.parse(localStorage.getItem('mm_service_payments') || '[]');
    return payments.some(payment => payment.eventId === eventId);
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '—';
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  contractTypeLabel(): string {
    const map: Record<string, string> = { musicista: 'Musicista', dj: 'DJ', insegnante: 'Insegnante' };
    return this.contract ? (map[this.contract.contractType] || this.contract.contractType) : '';
  }

  billingLabel(): string {
    return this.contract?.billingMode === 'in_fattura' ? 'In fattura' : 'Fuori fattura / Privato';
  }

  downloadPdf(): void {
    if (!this.contract) return;
    const c = this.contract;
    const body = this.buildPdfHtml(c);
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>Contratto ${c.eventTitle}</title>
<style>
  ${this.pdfCss()}
</style></head><body>${body}</body></html>`);
    win.document.close();
    setTimeout(() => win.print(), 250);
  }

  private buildPdfHtml(c: Contract): string {
    const typeLabel: Record<string, string> = { musicista: 'Prestazione musicale', dj: 'Prestazione DJ', insegnante: 'Attività di insegnamento' };
    const billingLabel = c.billingMode === 'in_fattura' ? 'In fattura' : 'Fuori fattura / Privato';
    const today = new Date().toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
    const eventDate = c.eventDate ? new Date(c.eventDate + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
    const clauseText = c.contractText || this.getDefaultClause(c.contractType);
    const responsibleName = `${c.responsibleName || c.customerName || 'Responsabile non specificato'}`.trim();
    const sigHtml = c.signatureData
      ? `<div class="sig-grid">
          <div class="sig-block"><div class="sig-label">Firma responsabile · ${responsibleName}</div><div class="sig-line"><img src="${c.signatureData}" style="max-height:56px;max-width:220px;" /></div></div>
        </div>`
      : `<div class="sig-grid">
          <div class="sig-block"><div class="sig-line"></div><div class="sig-label">Firma responsabile · ${responsibleName}</div></div>
        </div>`;
    return `<div class="pdf-shell">
  <div class="pdf-header">
    <div class="brand">Music Manager</div>
    <div class="chip">${typeLabel[c.contractType] || 'Contratto'}</div>
  </div>
  <h1>Contratto professionale</h1>
  <div class="subtitle">Generato il ${today} · Codice ${c.id.substring(0, 8).toUpperCase()}</div>

  <section class="panel">
    <h2>Parti coinvolte</h2>
    <table class="meta-table">
      <tr><td>Prestatore</td><td>${c.musicianName}${c.musicianCode ? ' · Cod. ' + c.musicianCode : ''}${c.djCode ? ' · DJ Cod. ' + c.djCode : ''}</td></tr>
      <tr><td>Cliente</td><td>${c.customerName}${c.customerEmail ? ' · ' + c.customerEmail : ''}${c.customerPhone ? ' · ' + c.customerPhone : ''}</td></tr>
      <tr><td>Responsabile firmatario</td><td>${responsibleName}</td></tr>
    </table>
  </section>

  <section class="panel">
    <h2>Dettagli evento</h2>
    <table class="meta-table">
      <tr><td>Evento</td><td>${c.eventTitle}</td></tr>
      <tr><td>Data</td><td>${eventDate}</td></tr>
      <tr><td>Location</td><td>${c.eventLocation || '—'}</td></tr>
      <tr><td>Compenso</td><td>€ ${(c.agreedFee || 0).toLocaleString('it-IT', { minimumFractionDigits: 0 })} · ${billingLabel}</td></tr>
      ${c.notes ? `<tr><td>Note</td><td>${c.notes}</td></tr>` : ''}
    </table>
  </section>

  <section class="panel">
    <h2>Clausole contrattuali</h2>
    <div class="clause-box">${clauseText.replace(/\n/g, '<br>')}</div>
  </section>

  <section class="panel signature-section">
    <h2>Firma</h2>
    ${sigHtml}
  </section>

  <div class="footer">Documento generato da Music Manager · Le parti dichiarano di aver letto e accettato le condizioni.</div>
</div>`;
  }

  private pdfCss(): string {
    return `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,Arial,sans-serif;background:#f5f3ff;color:#0f172a;padding:28px}
.pdf-shell{max-width:820px;margin:0 auto;background:#fff;border:1px solid #e9d5ff;border-radius:14px;padding:26px 28px}
.pdf-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.brand{font-weight:800;color:#5b21b6;font-size:18px;letter-spacing:.02em}
.chip{background:#ede9fe;color:#6d28d9;border:1px solid #ddd6fe;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:600}
h1{font-size:22px;color:#1f1147;margin-bottom:4px}
.subtitle{color:#64748b;font-size:12px;margin-bottom:16px}
.panel{border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:12px}
h2{font-size:12px;text-transform:uppercase;color:#5b21b6;letter-spacing:.08em;margin-bottom:8px}
.meta-table{width:100%;border-collapse:collapse}
.meta-table td{padding:6px 0;border-bottom:1px dashed #e2e8f0;font-size:12px;vertical-align:top}
.meta-table tr:last-child td{border-bottom:none}
.meta-table td:first-child{width:34%;color:#64748b}
.meta-table td:last-child{font-weight:600;color:#0f172a}
.clause-box{background:#faf5ff;border:1px solid #e9d5ff;border-left:4px solid #7c3aed;border-radius:8px;padding:10px 12px;font-size:11px;line-height:1.7}
.signature-section{margin-top:2px}
.sig-grid{display:flex;gap:24px;margin-top:8px}
.sig-block{flex:1}
.sig-line{border-top:1px solid #a78bfa;height:58px;margin-top:34px}
.sig-label{font-size:10px;color:#6b7280;margin-top:4px}
.footer{margin-top:8px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:10px;color:#64748b;text-align:center}
@media print{body{padding:10px;background:#fff}.pdf-shell{border:none;border-radius:0;padding:0}}
`;
  }

  private getDefaultClause(type: string): string {
    if (type === 'dj') return `Il prestatore DJ si impegna a fornire agibilità INPS (Gestione Spettacolo) prima della data dell'evento. In assenza di agibilità valida il contratto è nullo. Il compenso sarà corrisposto secondo le modalità concordate.`;
    if (type === 'insegnante') return `Il docente si impegna a fornire l'attività di insegnamento secondo il programma concordato. Il compenso sarà corrisposto secondo le modalità indicate. Entrambe le parti si impegnano al rispetto delle condizioni contrattuali.`;
    return `Il presente contratto disciplina la prestazione musicale indicata. Il compenso sarà corrisposto secondo le modalità concordate tra le parti. Entrambe le parti si impegnano al rispetto delle condizioni indicate.`;
  }
}
