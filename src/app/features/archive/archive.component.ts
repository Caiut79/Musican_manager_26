import { Component, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ArchiveEntity, SupabaseService } from '../../core/supabase.service';

@Component({
  selector: 'app-archive',
  templateUrl: './archive.component.html',
  styleUrls: ['./archive.component.scss']
})
export class ArchiveComponent implements OnInit {
  musicianCode = '';
  musicianName = '';
  syncing = false;
  syncOk = false;
  syncError: string | null = null;
  musicianQuery = '';
  bandQuery = '';
  musicians: ArchiveEntity[] = [];
  bands: ArchiveEntity[] = [];
  archiveRemoteAvailable = true;
  private musicianNameByCode = new Map<string, string>();

  form = this.fb.group({
    bandCode: ['', Validators.required]
  });

  constructor(private fb: FormBuilder, private supabase: SupabaseService) {}

  async ngOnInit(): Promise<void> {
    const firstName = localStorage.getItem('mm_firstName') || '';
    const lastName = localStorage.getItem('mm_lastName') || '';
    this.musicianName = `${firstName} ${lastName}`.trim();
    const localCode =
      localStorage.getItem('mm_affiliation_code') ||
      localStorage.getItem('musicianCode') ||
      '';
    this.musicianCode = /^MU\d{4}$/i.test(localCode) ? localCode.toUpperCase() : '';
    await this.refreshLists();
  }

  async refreshLists(): Promise<void> {
    const [musicianRows, allMusicians] = await Promise.all([
      this.supabase.searchArchiveEntities(this.musicianQuery, 'musician'),
      this.supabase.searchArchiveEntities('', 'musician')
    ]);
    this.musicianNameByCode = new Map(
      allMusicians.map(row => [row.entity_code.toUpperCase(), row.display_name || 'Musicista'])
    );
    this.musicians = musicianRows;
    const remoteBands = await this.supabase.searchArchiveEntities(this.bandQuery, 'band');
    if (remoteBands.length) {
      this.bands = remoteBands.filter(b => !!`${b.entity_code || ''}`.trim());
    } else {
      const sourceMusicians = this.musicianQuery
        ? this.musicians
        : await this.supabase.searchArchiveEntities('', 'musician');
      this.bands = this.deriveBandsFromMusicians(sourceMusicians, this.bandQuery);
    }
    this.archiveRemoteAvailable = this.supabase.isArchiveRemoteAvailable();
  }

  async syncCodes(): Promise<void> {
    this.syncError = null;
    this.syncOk = false;
    if (!this.musicianCode) {
      this.syncError = 'Codice musicista non disponibile';
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.syncing = true;
    const bandCode = `${this.form.value.bandCode || ''}`.trim().toUpperCase();
    const ok = await this.supabase.syncArchiveCodes(this.musicianCode, bandCode, this.musicianName);
    if (!ok) {
      this.syncError = 'Sincronizzazione non riuscita. Verifica migrazione archivio su Supabase.';
    } else {
      this.syncOk = true;
      this.form.patchValue({ bandCode: '' });
      await this.refreshLists();
    }
    this.syncing = false;
  }

  private deriveBandsFromMusicians(rows: ArchiveEntity[], query: string): ArchiveEntity[] {
    const normalized = (query || '').trim().toLowerCase();
    const seen = new Set<string>();
    const out: ArchiveEntity[] = [];
    rows.forEach(row => {
      const bandCode = (row.linked_code || '').trim().toUpperCase();
      if (!bandCode || seen.has(bandCode)) return;
      if (normalized && !bandCode.toLowerCase().includes(normalized)) return;
      seen.add(bandCode);
      out.push({
        entity_type: 'band',
        entity_code: bandCode,
        display_name: null,
        linked_code: row.entity_code,
        created_at: row.created_at
      });
    });
    return out;
  }

  linkedMusicianName(code: string | null): string {
    const normalized = `${code || ''}`.trim().toUpperCase();
    if (!normalized) return '—';
    return this.musicianNameByCode.get(normalized) || 'Musicista non identificato';
  }

  formatCreatedAt(iso: string | undefined): string {
    if (!iso) return 'Data non disponibile';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Data non disponibile';
    return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }
}
