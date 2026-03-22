import { Component, OnInit } from '@angular/core';

type InvoiceRole = 'musician' | 'teacher';
type CustomerType = 'b2b' | 'privato';

type InvoiceIssuer = {
  displayName: string;
  vatNumber: string;
  fiscalCode: string;
  address: string;
  city: string;
  zip: string;
  country: string;
  sdi: string;
  pec: string;
  iban: string;
};

type InvoiceCustomer = {
  displayName: string;
  vatNumber: string;
  fiscalCode: string;
  address: string;
  city: string;
  zip: string;
  country: string;
  sdi: string;
  pec: string;
};

type InvoiceLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatPercent: number;
};

type InvoiceRecord = {
  id: string;
  role: InvoiceRole;
  customerType: CustomerType;
  number: string;
  issueDate: string;
  currency: 'EUR';
  issuer: InvoiceIssuer;
  customer: InvoiceCustomer;
  lines: InvoiceLine[];
  notes: string;
  stampDuty: boolean;   // bollo €2 su ricevuta privato se imponibile > €77.47
  createdAt: string;
};

type ContactEntry = {
  id: string;
  type: 'band' | 'school' | 'student';
  displayName: string;
  billingName: string;
  billingVatNumber: string;
  billingFiscalCode: string;
  billingSdi: string;
  billingPec: string;
  billingAddress: string;
  billingCity: string;
  billingZip: string;
  billingCountry: string;
  billedToParent: boolean;
  parentName: string;
};

// ─── IVA rates available in Italy ────────────────────────────────────────────
const IVA_OPTIONS = [0, 4, 5, 10, 22];

@Component({
  selector: 'app-invoicing',
  templateUrl: './invoicing.component.html',
  styleUrls: ['./invoicing.component.scss']
})
export class InvoicingComponent implements OnInit {
  invoices: InvoiceRecord[] = [];
  contacts: ContactEntry[] = [];
  enabledRoles: InvoiceRole[] = [];
  activeRole: InvoiceRole = 'musician';
  issuerByRole: Record<InvoiceRole, InvoiceIssuer> = {
    musician: this.emptyIssuer(),
    teacher: this.emptyIssuer()
  };

  showNew = false;
  showSettings = false;
  selectedCustomerContactId = '';
  draftCustomerType: CustomerType = 'b2b';
  draft: InvoiceRecord = this.emptyInvoice('musician');
  savedOk = false;
  settingsSavedOk = false;
  error = '';
  ivaOptions = IVA_OPTIONS;

  // Invoice list filter
  filterRole: 'all' | InvoiceRole = 'all';
  filterType: 'all' | CustomerType = 'all';

  ngOnInit(): void {
    this.contacts = this.readContacts();
    this.enabledRoles = this.resolveEnabledRoles();
    if (this.enabledRoles.length) {
      this.activeRole = this.enabledRoles[0];
    }
    this.issuerByRole = {
      musician: this.loadIssuer('musician'),
      teacher: this.loadIssuer('teacher')
    };
    this.invoices = this.readInvoices();
  }

  get canUseInvoicing(): boolean {
    return this.enabledRoles.length > 0;
  }

  get activeIssuer(): InvoiceIssuer {
    return this.issuerByRole[this.activeRole];
  }

  get customers(): ContactEntry[] {
    return [...this.contacts].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  get filteredInvoices(): InvoiceRecord[] {
    return this.invoices.filter(inv => {
      if (this.filterRole !== 'all' && inv.role !== this.filterRole) return false;
      if (this.filterType !== 'all' && inv.customerType !== this.filterType) return false;
      return true;
    });
  }

  // ─── Annual summary ────────────────────────────────────────────────────────
  get currentYear(): number { return new Date().getFullYear(); }

  get yearlyTaxable(): number {
    return this.round2(this.invoices
      .filter(inv => `${inv.issueDate || ''}`.startsWith(`${this.currentYear}`))
      .reduce((sum, inv) => sum + this.taxableTotalFor(inv), 0));
  }

  get yearlyVat(): number {
    return this.round2(this.invoices
      .filter(inv => `${inv.issueDate || ''}`.startsWith(`${this.currentYear}`))
      .reduce((sum, inv) => sum + this.vatTotalFor(inv), 0));
  }

  get yearlyTotal(): number { return this.round2(this.yearlyTaxable + this.yearlyVat); }

  get yearlyCount(): number {
    return this.invoices.filter(inv => `${inv.issueDate || ''}`.startsWith(`${this.currentYear}`)).length;
  }

  // ─── Role / settings ───────────────────────────────────────────────────────
  setActiveRole(role: InvoiceRole): void {
    if (!this.enabledRoles.includes(role)) return;
    this.activeRole = role;
    this.savedOk = false;
    this.error = '';
    if (this.showNew) {
      this.startNewInvoice();
    }
  }

  saveIssuer(): void {
    const key = this.issuerStorageKey(this.activeRole);
    localStorage.setItem(key, JSON.stringify(this.activeIssuer));
    this.settingsSavedOk = true;
    setTimeout(() => { this.settingsSavedOk = false; }, 1800);
  }

  // ─── New invoice ───────────────────────────────────────────────────────────
  startNewInvoice(): void {
    this.error = '';
    this.savedOk = false;
    this.selectedCustomerContactId = '';
    this.draftCustomerType = 'b2b';
    this.showNew = true;
    const nextNumber = this.computeNextInvoiceNumber(this.activeRole);
    this.draft = this.emptyInvoice(this.activeRole);
    this.draft.customerType = 'b2b';
    this.draft.number = nextNumber;
    this.draft.issueDate = this.todayISO();
    this.draft.issuer = { ...this.activeIssuer };
    this.draft.lines = [
      {
        description: this.activeRole === 'teacher' ? 'Lezioni / prestazione didattica' : 'Prestazione artistica',
        quantity: 1,
        unitPrice: 0,
        vatPercent: 22
      }
    ];
    this.draft.stampDuty = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  closeNewInvoice(): void {
    this.showNew = false;
    this.selectedCustomerContactId = '';
    this.error = '';
  }

  onCustomerTypeChange(): void {
    this.draft.customerType = this.draftCustomerType;
    if (this.draftCustomerType === 'privato') {
      this.draft.customer.vatNumber = '';
      if (!this.draft.customer.sdi) {
        this.draft.customer.sdi = '0000000';
      }
    } else {
      if (this.draft.customer.sdi === '0000000') {
        this.draft.customer.sdi = '';
      }
    }
    this.updateStampDutyDefault();
  }

  onCustomerSelected(): void {
    const id = `${this.selectedCustomerContactId || ''}`.trim();
    if (!id) return;
    const contact = this.contacts.find(c => c.id === id);
    if (!contact) return;
    const name = contact.billedToParent && contact.parentName ? contact.parentName : contact.billingName || contact.displayName;
    // Auto-detect type: B2B if has a VAT number
    if (contact.billingVatNumber) {
      this.draftCustomerType = 'b2b';
    } else {
      this.draftCustomerType = 'privato';
    }
    this.draft.customerType = this.draftCustomerType;
    this.draft.customer = {
      displayName: `${name || ''}`.trim(),
      vatNumber: `${contact.billingVatNumber || ''}`.trim(),
      fiscalCode: `${contact.billingFiscalCode || ''}`.trim(),
      sdi: `${contact.billingSdi || (this.draftCustomerType === 'privato' ? '0000000' : '')}`.trim(),
      pec: `${contact.billingPec || ''}`.trim(),
      address: `${contact.billingAddress || ''}`.trim(),
      city: `${contact.billingCity || ''}`.trim(),
      zip: `${contact.billingZip || ''}`.trim(),
      country: `${contact.billingCountry || 'Italia'}`.trim()
    };
    this.updateStampDutyDefault();
  }

  // ─── Lines ─────────────────────────────────────────────────────────────────
  addLine(): void {
    this.draft.lines = [
      ...this.draft.lines,
      { description: '', quantity: 1, unitPrice: 0, vatPercent: this.defaultVatPercent() }
    ];
  }

  removeLine(idx: number): void {
    this.draft.lines = this.draft.lines.filter((_, i) => i !== idx);
    if (!this.draft.lines.length) this.addLine();
    this.updateStampDutyDefault();
  }

  onLineChange(): void {
    this.updateStampDutyDefault();
  }

  // ─── Totals ────────────────────────────────────────────────────────────────
  get taxableTotal(): number {
    return this.round2(this.draft.lines.reduce((sum, l) => sum + this.lineTaxable(l), 0));
  }

  get vatTotal(): number {
    return this.round2(this.draft.lines.reduce((sum, l) => sum + this.lineVat(l), 0));
  }

  get grandTotal(): number {
    return this.round2(this.taxableTotal + this.vatTotal + (this.draft.stampDuty ? 2 : 0));
  }

  get showStampDutyOption(): boolean {
    // Stamp duty €2 applies on invoices to privato with taxable > €77.47 and IVA = 0
    return this.draftCustomerType === 'privato' && this.taxableTotal > 77.47 && this.vatTotal === 0;
  }

  lineTaxableDisplay(l: InvoiceLine): number { return this.lineTaxable(l); }
  lineVatDisplay(l: InvoiceLine): number { return this.lineVat(l); }
  lineTotalDisplay(l: InvoiceLine): number { return this.round2(this.lineTaxable(l) + this.lineVat(l)); }

  invoiceGrandTotal(inv: InvoiceRecord): number { return this.grandTotalFor(inv); }
  invoiceTaxable(inv: InvoiceRecord): number { return this.taxableTotalFor(inv); }

  // ─── Save & print ──────────────────────────────────────────────────────────
  saveInvoice(): void {
    this.error = '';
    const number = `${this.draft.number || ''}`.trim();
    if (!number) { this.error = 'Inserisci numero fattura'; return; }
    if (!this.draft.customer.displayName.trim()) { this.error = 'Inserisci intestatario cliente'; return; }
    if (this.draftCustomerType === 'b2b' && !this.draft.customer.vatNumber.trim()) {
      this.error = 'Per cliente B2B inserisci la P.IVA'; return;
    }
    const hasLine = this.draft.lines.some(l => `${l.description || ''}`.trim() && Number(l.quantity || 0) > 0);
    if (!hasLine) { this.error = 'Inserisci almeno una riga valida'; return; }
    const now = new Date().toISOString();
    // Force SDI for privato
    if (this.draftCustomerType === 'privato' && !this.draft.customer.sdi) {
      this.draft.customer.sdi = '0000000';
    }
    const record: InvoiceRecord = {
      ...this.draft,
      id: crypto.randomUUID(),
      role: this.activeRole,
      customerType: this.draftCustomerType,
      stampDuty: this.draft.stampDuty,
      issuer: { ...this.draft.issuer },
      customer: { ...this.draft.customer },
      lines: this.draft.lines.map(l => ({
        description: `${l.description || ''}`.trim(),
        quantity: Math.max(0, Number(l.quantity || 0)),
        unitPrice: Math.max(0, Number(l.unitPrice || 0)),
        vatPercent: Math.max(0, Number(l.vatPercent || 0))
      })),
      notes: `${this.draft.notes || ''}`.trim(),
      issueDate: this.draft.issueDate || this.todayISO(),
      currency: 'EUR',
      createdAt: now
    };
    this.invoices = [record, ...this.invoices].sort(
      (a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || (b.createdAt || '').localeCompare(a.createdAt || '')
    );
    localStorage.setItem('mm_invoices', JSON.stringify(this.invoices));
    this.bumpInvoiceSequence(this.activeRole, record.number);
    this.savedOk = true;
    this.openPrintPreview(record);
    this.startNewInvoice();
  }

  deleteInvoice(id: string): void {
    this.invoices = this.invoices.filter(inv => inv.id !== id);
    localStorage.setItem('mm_invoices', JSON.stringify(this.invoices));
  }

  openPrintPreview(inv: InvoiceRecord): void {
    const win = window.open('', '_blank', 'noopener,noreferrer');
    if (!win) return;
    win.document.open();
    win.document.write(this.buildPrintableHtml(inv));
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch { } }, 300);
  }

  // ─── Print HTML ────────────────────────────────────────────────────────────
  private buildPrintableHtml(inv: InvoiceRecord): string {
    const cur = inv.currency;
    const isPrivato = inv.customerType === 'privato';
    const docType = isPrivato ? 'RICEVUTA' : 'FATTURA';
    const rows = inv.lines.map(l => {
      const taxable = this.lineTaxable(l);
      const vat = this.lineVat(l);
      return `
        <tr>
          <td class="desc">${this.escapeHtml(l.description)}</td>
          <td class="num">${this.fmt(l.quantity)}</td>
          <td class="num">${this.money(l.unitPrice, cur)}</td>
          <td class="num">${this.fmt(l.vatPercent)}%</td>
          <td class="num">${this.money(taxable, cur)}</td>
          <td class="num">${this.money(taxable + vat, cur)}</td>
        </tr>`;
    }).join('');
    const taxableTotal = this.taxableTotalFor(inv);
    const vatTotal = this.vatTotalFor(inv);
    const stampDuty = inv.stampDuty ? 2 : 0;
    const grand = this.grandTotalFor(inv);
    const notes = `${inv.notes || ''}`.trim();
    const sdiRow = !isPrivato ? `<div>SDI: <strong>${this.escapeHtml(inv.customer.sdi)}</strong> &nbsp;|&nbsp; PEC: <strong>${this.escapeHtml(inv.customer.pec || '—')}</strong></div>` : '';
    const vatRow = !isPrivato ? `<div>P.IVA: <strong>${this.escapeHtml(inv.customer.vatNumber)}</strong></div>` : '';
    return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8"/>
  <title>${docType} ${this.escapeHtml(inv.number)}</title>
  <style>
    :root{color-scheme:light}
    *{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;margin:0;padding:28px 32px;color:#111827;font-size:13px}
    .wrap{max-width:860px;margin:0 auto}
    /* Header */
    .doc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #7c3aed}
    .doc-type{font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#7c3aed;margin-bottom:4px}
    .doc-number{font-size:22px;font-weight:900;color:#111827;line-height:1}
    .doc-date{font-size:12px;color:#6b7280;margin-top:4px}
    .doc-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700}
    .badge-b2b{background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe}
    .badge-privato{background:#fdf4ff;color:#7e22ce;border:1px solid #e9d5ff}
    .grand-box{text-align:right}
    .grand-label{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin-bottom:2px}
    .grand-amount{font-size:22px;font-weight:900;color:#7c3aed}
    /* Parties */
    .parties{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
    .party-box{border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px}
    .party-label{font-size:9px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#6b7280;margin-bottom:8px}
    .party-name{font-size:14px;font-weight:800;color:#111827;margin-bottom:5px}
    .party-line{font-size:12px;color:#374151;margin:2px 0}
    .party-line span{color:#6b7280}
    /* Lines table */
    table{width:100%;border-collapse:collapse;margin-bottom:12px}
    thead tr{background:#f9fafb}
    th{padding:8px 10px;text-align:left;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;border-bottom:2px solid #e5e7eb}
    td{padding:9px 10px;border-bottom:1px solid #f3f4f6;font-size:12px;vertical-align:top}
    .num{text-align:right;white-space:nowrap}
    .desc{width:38%}
    /* Totals */
    .foot-grid{display:grid;grid-template-columns:1fr 260px;gap:12px}
    .notes-box{border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px}
    .notes-label{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin-bottom:6px}
    .notes-text{font-size:12px;color:#374151}
    .totals-box{border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px}
    .tot-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px;color:#374151;gap:16px}
    .tot-row.divider{border-top:1px solid #e5e7eb;margin-top:6px;padding-top:10px}
    .tot-row.grand-row{font-weight:900;font-size:15px;color:#7c3aed}
    /* Payment */
    .payment-box{border:1px solid #e5e7eb;border-radius:10px;padding:10px 14px;margin-top:10px;font-size:12px;color:#374151}
    .pay-label{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin-bottom:4px}
    .iban-value{font-family:monospace;font-size:12px;color:#111827;font-weight:700}
    /* Footer */
    .doc-footer{margin-top:18px;padding-top:10px;border-top:1px solid #f3f4f6;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between}
    @media print{body{padding:0}.wrap{max-width:none}}
  </style>
</head>
<body>
<div class="wrap">
  <div class="doc-head">
    <div>
      <div class="doc-type">${docType}</div>
      <div class="doc-number">N. ${this.escapeHtml(inv.number)}</div>
      <div class="doc-date">Data emissione: ${this.escapeHtml(inv.issueDate)}</div>
      <div style="margin-top:8px">
        <span class="doc-badge ${isPrivato ? 'badge-privato' : 'badge-b2b'}">${isPrivato ? '👤 Privato' : '🏢 B2B'}</span>
      </div>
    </div>
    <div class="grand-box">
      <div class="grand-label">Totale</div>
      <div class="grand-amount">${this.money(grand, cur)}</div>
    </div>
  </div>

  <div class="parties">
    <div class="party-box">
      <div class="party-label">Emittente</div>
      <div class="party-name">${this.escapeHtml(inv.issuer.displayName)}</div>
      ${inv.issuer.vatNumber ? `<div class="party-line"><span>P.IVA</span> ${this.escapeHtml(inv.issuer.vatNumber)}</div>` : ''}
      ${inv.issuer.fiscalCode ? `<div class="party-line"><span>CF</span> ${this.escapeHtml(inv.issuer.fiscalCode)}</div>` : ''}
      <div class="party-line">${this.escapeHtml(this.joinAddress(inv.issuer.address, inv.issuer.zip, inv.issuer.city, inv.issuer.country))}</div>
      ${inv.issuer.sdi ? `<div class="party-line"><span>SDI</span> ${this.escapeHtml(inv.issuer.sdi)}</div>` : ''}
      ${inv.issuer.pec ? `<div class="party-line"><span>PEC</span> ${this.escapeHtml(inv.issuer.pec)}</div>` : ''}
    </div>
    <div class="party-box">
      <div class="party-label">Cliente ${isPrivato ? '(Privato)' : '(Azienda / P.IVA)'}</div>
      <div class="party-name">${this.escapeHtml(inv.customer.displayName)}</div>
      ${vatRow}
      ${inv.customer.fiscalCode ? `<div class="party-line"><span>CF</span> ${this.escapeHtml(inv.customer.fiscalCode)}</div>` : ''}
      ${inv.customer.address ? `<div class="party-line">${this.escapeHtml(this.joinAddress(inv.customer.address, inv.customer.zip, inv.customer.city, inv.customer.country))}</div>` : ''}
      ${sdiRow}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Descrizione</th>
        <th class="num">Q.tà</th>
        <th class="num">Prezzo unitario</th>
        <th class="num">IVA %</th>
        <th class="num">Imponibile</th>
        <th class="num">Totale</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="foot-grid">
    <div class="notes-box">
      <div class="notes-label">Note</div>
      <div class="notes-text">${notes ? this.escapeHtml(notes) : '—'}</div>
    </div>
    <div class="totals-box">
      <div class="tot-row"><span>Imponibile</span><strong>${this.money(taxableTotal, cur)}</strong></div>
      <div class="tot-row"><span>IVA</span><strong>${this.money(vatTotal, cur)}</strong></div>
      ${stampDuty ? `<div class="tot-row"><span>Imposta di bollo</span><strong>${this.money(stampDuty, cur)}</strong></div>` : ''}
      <div class="tot-row divider grand-row"><span>Totale</span><strong>${this.money(grand, cur)}</strong></div>
    </div>
  </div>

  ${inv.issuer.iban ? `
  <div class="payment-box">
    <div class="pay-label">Coordinate di pagamento</div>
    <div class="iban-value">${this.escapeHtml(inv.issuer.iban)}</div>
  </div>` : ''}

  <div class="doc-footer">
    <span>Documento generato da Musican Manager</span>
    <span>Fattura ${this.escapeHtml(inv.number)} — ${this.escapeHtml(inv.issueDate)}</span>
  </div>
</div>
</body>
</html>`;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────
  private updateStampDutyDefault(): void {
    if (this.showStampDutyOption) {
      this.draft.stampDuty = true;
    } else {
      this.draft.stampDuty = false;
    }
  }

  private resolveEnabledRoles(): InvoiceRole[] {
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    const roleSettings = profile?.roleSettings || {};
    const musicianMode = `${roleSettings?.musician?.fiscalMode || profile?.musicianFiscalMode || ''}`.toLowerCase();
    const teacherMode = `${roleSettings?.teacher?.fiscalMode || profile?.teacherFiscalMode || ''}`.toLowerCase();
    const musicianRoleActive = profile?.isMusician !== false;
    const teacherRoleActive = profile?.isTeacher === true || !!roleSettings?.teacher || !!profile?.teacherFiscalMode;
    const roles: InvoiceRole[] = [];
    if (musicianRoleActive && musicianMode === 'piva') roles.push('musician');
    if (teacherRoleActive && teacherMode === 'piva') roles.push('teacher');
    // Fallback: if no profile set, allow usage
    if (!roles.length && !profile?.firstName) roles.push('musician');
    return roles;
  }

  private loadIssuer(role: InvoiceRole): InvoiceIssuer {
    const raw = localStorage.getItem(this.issuerStorageKey(role));
    const profile = JSON.parse(localStorage.getItem('mm_profile_snapshot') || '{}');
    const firstName = `${profile?.firstName || ''}`.trim();
    const lastName = `${profile?.lastName || ''}`.trim();
    const defaultName = `${firstName} ${lastName}`.trim() || 'Professionista';
    const fallbackVat = role === 'teacher'
      ? `${profile?.teacherVatNumber || profile?.vatNumber || ''}`.trim()
      : `${profile?.musicianVatNumber || profile?.vatNumber || ''}`.trim();
    const base: InvoiceIssuer = { ...this.emptyIssuer(), displayName: defaultName, vatNumber: fallbackVat, country: 'Italia' };
    if (!raw) return base;
    try {
      const p = JSON.parse(raw);
      return {
        displayName: `${p?.displayName || defaultName}`.trim() || defaultName,
        vatNumber: `${p?.vatNumber || fallbackVat}`.trim(),
        fiscalCode: `${p?.fiscalCode || ''}`.trim(),
        address: `${p?.address || ''}`.trim(),
        city: `${p?.city || ''}`.trim(),
        zip: `${p?.zip || ''}`.trim(),
        country: `${p?.country || 'Italia'}`.trim(),
        sdi: `${p?.sdi || ''}`.trim(),
        pec: `${p?.pec || ''}`.trim(),
        iban: `${p?.iban || ''}`.trim()
      };
    } catch {
      return base;
    }
  }

  private emptyIssuer(): InvoiceIssuer {
    return { displayName: '', vatNumber: '', fiscalCode: '', address: '', city: '', zip: '', country: 'Italia', sdi: '', pec: '', iban: '' };
  }

  private emptyCustomer(): InvoiceCustomer {
    return { displayName: '', vatNumber: '', fiscalCode: '', address: '', city: '', zip: '', country: 'Italia', sdi: '', pec: '' };
  }

  private emptyInvoice(role: InvoiceRole): InvoiceRecord {
    return {
      id: '', role, customerType: 'b2b', number: '',
      issueDate: this.todayISO(), currency: 'EUR',
      issuer: this.emptyIssuer(), customer: this.emptyCustomer(),
      lines: [], notes: '', stampDuty: false, createdAt: ''
    };
  }

  private readInvoices(): InvoiceRecord[] {
    const raw = JSON.parse(localStorage.getItem('mm_invoices') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map((x: any): InvoiceRecord => ({
      id: `${x?.id || ''}`,
      role: x?.role === 'teacher' ? 'teacher' : 'musician',
      customerType: x?.customerType === 'privato' ? 'privato' : 'b2b',
      number: `${x?.number || ''}`,
      issueDate: `${x?.issueDate || ''}`,
      currency: 'EUR',
      stampDuty: !!x?.stampDuty,
      issuer: { ...this.emptyIssuer(), ...(x?.issuer || {}) },
      customer: { ...this.emptyCustomer(), ...(x?.customer || {}) },
      lines: Array.isArray(x?.lines) ? x.lines.map((l: any) => ({
        description: `${l?.description || ''}`,
        quantity: Number(l?.quantity || 0),
        unitPrice: Number(l?.unitPrice || 0),
        vatPercent: Number(l?.vatPercent || 0)
      })) : [],
      notes: `${x?.notes || ''}`,
      createdAt: `${x?.createdAt || ''}`
    })).sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  private readContacts(): ContactEntry[] {
    const raw = JSON.parse(localStorage.getItem('mm_contacts') || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map((x: any): ContactEntry => ({
      id: `${x?.id || ''}`,
      type: x?.type === 'school' || x?.type === 'student' ? x.type : 'band',
      displayName: `${x?.displayName || ''}`.trim(),
      billingName: `${x?.billingName || ''}`.trim(),
      billingVatNumber: `${x?.billingVatNumber || ''}`.trim(),
      billingFiscalCode: `${x?.billingFiscalCode || ''}`.trim(),
      billingSdi: `${x?.billingSdi || ''}`.trim(),
      billingPec: `${x?.billingPec || ''}`.trim(),
      billingAddress: `${x?.billingAddress || ''}`.trim(),
      billingCity: `${x?.billingCity || ''}`.trim(),
      billingZip: `${x?.billingZip || ''}`.trim(),
      billingCountry: `${x?.billingCountry || ''}`.trim() || 'Italia',
      billedToParent: !!x?.billedToParent,
      parentName: `${x?.parentName || ''}`.trim()
    })).filter(c => !!c.id && !!c.displayName);
  }

  private issuerStorageKey(role: InvoiceRole): string {
    return role === 'teacher' ? 'mm_invoice_issuer_teacher' : 'mm_invoice_issuer_musician';
  }

  private computeNextInvoiceNumber(role: InvoiceRole): string {
    const year = new Date().getFullYear();
    const key = `mm_invoice_seq_${role}_${year}`;
    const next = Math.max(0, Number(localStorage.getItem(key) || 0)) + 1;
    return `${next.toString().padStart(4, '0')}/${year}`;
  }

  private bumpInvoiceSequence(role: InvoiceRole, number: string): void {
    const year = new Date().getFullYear();
    const key = `mm_invoice_seq_${role}_${year}`;
    const match = `${number || ''}`.trim().match(/^(\d+)\s*\/\s*(\d{4})$/);
    if (!match) return;
    const seq = Number(match[1] || 0);
    if (!seq || Number(match[2] || 0) !== year) return;
    const current = Number(localStorage.getItem(key) || 0);
    if (seq > current) localStorage.setItem(key, `${seq}`);
  }

  private defaultVatPercent(): number {
    const first = this.draft.lines[0];
    if (first && Number.isFinite(Number(first.vatPercent))) return Number(first.vatPercent || 0);
    return 22;
  }

  private todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
  }

  private lineTaxable(line: InvoiceLine): number {
    return this.round2(Math.max(0, Number(line.quantity || 0)) * Math.max(0, Number(line.unitPrice || 0)));
  }

  private lineVat(line: InvoiceLine): number {
    return this.round2(this.lineTaxable(line) * (Math.max(0, Number(line.vatPercent || 0)) / 100));
  }

  private taxableTotalFor(inv: InvoiceRecord): number {
    return this.round2(inv.lines.reduce((sum, l) => sum + this.lineTaxable(l), 0));
  }

  private vatTotalFor(inv: InvoiceRecord): number {
    return this.round2(inv.lines.reduce((sum, l) => sum + this.lineVat(l), 0));
  }

  private grandTotalFor(inv: InvoiceRecord): number {
    return this.round2(this.taxableTotalFor(inv) + this.vatTotalFor(inv) + (inv.stampDuty ? 2 : 0));
  }

  private money(value: number, currency: string): string {
    try {
      return new Intl.NumberFormat('it-IT', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(this.round2(Number(value || 0)));
    } catch {
      return `${this.round2(Number(value || 0)).toFixed(2)} ${currency}`;
    }
  }

  private fmt(value: number): string {
    const n = Number(value || 0);
    return Number.isFinite(n) ? `${this.round2(n)}` : '0';
  }

  private joinAddress(address: string, zip: string, city: string, country: string): string {
    return [`${address || ''}`.trim(), `${zip || ''}`.trim(), `${city || ''}`.trim(), `${country || ''}`.trim()].filter(Boolean).join(' • ');
  }

  private escapeHtml(value: string): string {
    return `${value || ''}`.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  }

  private round2(value: number): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }
}
