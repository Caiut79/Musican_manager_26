import { Component, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';

type ContractType = 'musicista' | 'dj' | 'insegnante';
type ContractStatus = 'draft' | 'sent' | 'signed' | 'archived';

interface Contract {
  id: string;
  contractType: ContractType;
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
  status: ContractStatus;
  musicianName: string;
  musicianCode: string;
  djCode: string;
  workerType: string;
  taxRegime: string;
}

@Component({
  selector: 'app-contracts',
  templateUrl: './contracts.component.html',
  styleUrls: ['./contracts.component.scss']
})
export class ContractsComponent implements OnInit {
  contracts: Contract[] = [];
  activeTab: ContractType = 'musicista';
  showCreateForm = false;
  searchQuery = '';
  copiedId: string | null = null;

  form = this.fb.group({
    contractType: ['musicista' as ContractType, Validators.required],
    customerName: ['', Validators.required],
    customerEmail: ['', [Validators.required, Validators.email]],
    customerPhone: [''],
    responsibleName: ['', Validators.required],
    eventTitle: ['', Validators.required],
    eventDate: ['', Validators.required],
    eventLocation: [''],
    agreedFee: [0, [Validators.required, Validators.min(0)]],
    billingMode: ['fuori_fattura' as 'in_fattura' | 'fuori_fattura'],
    notes: [''],
    contractText: ['']
  });

  contractTypes: { value: ContractType; label: string; icon: string }[] = [
    { value: 'musicista', label: 'Musicista', icon: '🎵' },
    { value: 'dj', label: 'DJ', icon: '🎧' },
    { value: 'insegnante', label: 'Insegnante', icon: '🎓' }
  ];

  statusLabels: Record<ContractStatus, string> = {
    draft: 'Bozza',
    sent: 'Inviato',
    signed: 'Firmato',
    archived: 'Archiviato'
  };

  statusIcons: Record<ContractStatus, string> = {
    draft: '📝',
    sent: '📧',
    signed: '✅',
    archived: '📁'
  };

  constructor(private fb: FormBuilder, private router: Router) {}

  ngOnInit(): void {
    this.loadContracts();
    this.form.patchValue({ contractType: this.activeTab });
  }

  private loadContracts(): void {
    const stored = localStorage.getItem('mm_contracts');
    this.contracts = stored ? JSON.parse(stored) : [];
  }

  private persistContracts(): void {
    localStorage.setItem('mm_contracts', JSON.stringify(this.contracts));
  }

  get musicianName(): string {
    return `${localStorage.getItem('mm_firstName') || ''} ${localStorage.getItem('mm_lastName') || ''}`.trim() || 'Musicista';
  }

  get musicianCode(): string {
    return localStorage.getItem('mm_musician_role_code') || localStorage.getItem('mm_affiliation_code') || localStorage.getItem('musicianCode') || '';
  }

  get djCode(): string {
    return localStorage.getItem('mm_dj_code') || '';
  }

  get workerType(): string {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    return profile.workerType || '';
  }

  get taxRegime(): string {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    return profile.taxRegime || 'ordinario';
  }

  get filteredContracts(): Contract[] {
    let list = this.contracts.filter(c => c.contractType === this.activeTab);
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter(c =>
        c.customerName.toLowerCase().includes(q) ||
        c.eventTitle.toLowerCase().includes(q) ||
        c.eventLocation.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  setActiveTab(tab: ContractType): void {
    this.activeTab = tab;
    this.form.patchValue({ contractType: tab });
    this.showCreateForm = false;
  }

  openCreateForm(): void {
    this.form.patchValue({ contractType: this.activeTab });
    this.showCreateForm = true;
  }

  closeCreateForm(): void {
    this.showCreateForm = false;
    this.form.reset({ contractType: this.activeTab, billingMode: 'fuori_fattura', agreedFee: 0, responsibleName: '' });
  }

  createContract(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const v = this.form.value;
    const id = crypto.randomUUID();
    const contract: Contract = {
      id,
      contractType: v.contractType as ContractType,
      customerName: v.customerName!,
      customerEmail: v.customerEmail!,
      customerPhone: v.customerPhone || '',
      responsibleName: v.responsibleName || v.customerName || '',
      eventTitle: v.eventTitle!,
      eventDate: v.eventDate!,
      eventLocation: v.eventLocation || '',
      agreedFee: Number(v.agreedFee) || 0,
      billingMode: v.billingMode as 'in_fattura' | 'fuori_fattura',
      notes: v.notes || '',
      contractText: v.contractText || '',
      signatureData: null,
      signedAt: null,
      createdAt: new Date().toISOString(),
      uniqueLink: `${window.location.origin}/contract/${id}`,
      status: 'draft',
      musicianName: this.musicianName,
      musicianCode: this.musicianCode,
      djCode: this.djCode,
      workerType: this.workerType,
      taxRegime: this.taxRegime
    };
    this.contracts.unshift(contract);
    this.persistContracts();
    this.closeCreateForm();
  }

  deleteContract(id: string): void {
    this.contracts = this.contracts.filter(c => c.id !== id);
    this.persistContracts();
  }

  copyLink(id: string): void {
    const contract = this.contracts.find(c => c.id === id);
    if (!contract) return;
    navigator.clipboard.writeText(contract.uniqueLink).then(() => {
      this.copiedId = id;
      setTimeout(() => this.copiedId = null, 1800);
    });
  }

  sendContract(id: string): void {
    const contract = this.contracts.find(c => c.id === id);
    if (!contract) return;
    contract.status = 'sent';
    this.persistContracts();
  }

  archiveContract(id: string): void {
    const contract = this.contracts.find(c => c.id === id);
    if (!contract) return;
    contract.status = 'archived';
    this.persistContracts();
  }

  viewContract(id: string): void {
    this.router.navigate(['/contract-view', id]);
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '—';
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  isInvalid(name: string): boolean {
    const c = this.form.get(name);
    return !!(c?.invalid && c?.touched);
  }

  contractTypeLabel(type: ContractType): string {
    return this.contractTypes.find(t => t.value === type)?.label || type;
  }

  contractIcon(type: ContractType): string {
    return this.contractTypes.find(t => t.value === type)?.icon || '📄';
  }

  totalDrafts(): number { return this.contracts.filter(c => c.status === 'draft').length; }
  totalSent(): number { return this.contracts.filter(c => c.status === 'sent').length; }
  totalSigned(): number { return this.contracts.filter(c => c.status === 'signed').length; }
  totalArchived(): number { return this.contracts.filter(c => c.status === 'archived').length; }

  downloadContractPdf(id: string): void {
    const c = this.contracts.find(x => x.id === id);
    if (!c) return;
    const body = this.buildPdfHtml(c);
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>Contratto ${c.eventTitle}</title>
<style>
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
</style>
</head>
<body>
${body}
</body>
</html>`);
    win.document.close();
    setTimeout(() => { win.print(); }, 250);
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
          <div class="sig-block">
            <div class="sig-label">Firma responsabile · ${responsibleName}</div>
            <div class="sig-line"><img src="${c.signatureData}" style="max-height:55px;max-width:220px;" /></div>
          </div>
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

  private getDefaultClause(type: string): string {
    if (type === 'dj') {
      return `Il prestatore DJ si impegna a fornire agibilità INPS (Gestione Spettacolo) prima della data dell'evento. In assenza di agibilità valida il contratto è nullo. Il compenso sarà corrisposto secondo le modalità concordate. Entrambe le parti si rispettano le condizioni indicate e si impegnano alla discrezione reciproca.`;
    }
    if (type === 'insegnante') {
      return `Il docente si impegna a fornire l'attività di insegnamento secondo il programma concordato con il cliente. Il compenso sarà corrisposto secondo le modalità indicate. Entrambe le parti si impegnano al rispetto delle condizioni contrattuali.`;
    }
    return `Il presente contratto disciplina la prestazione musicale indicata. Il compenso sarà corrisposto secondo le modalità concordate tra le parti. Entrambe le parti si impegnano al rispetto delle condizioni indicate e alla discrezione reciproca.`;
  }
}
