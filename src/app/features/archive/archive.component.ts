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
  activeCategory: 'musician' | 'band' = 'musician';
  selectedEntity: ArchiveEntity | null = null;
  archiveRemoteAvailable = true;
  private musicianNameByCode = new Map<string, string>();
  private musicianByCode = new Map<string, ArchiveEntity>();

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
    this.musicianByCode = new Map(
      allMusicians.map(row => [row.entity_code.toUpperCase(), row])
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
    this.reconcileSelection();
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

  archiveBio(entity: ArchiveEntity): string | null {
    return this.cleanText(entity.profile_bio)
      || this.cleanText(this.linkedMusicianEntity(entity)?.profile_bio)
      || null;
  }

  archiveExperience(entity: ArchiveEntity): string | null {
    return this.cleanText(entity.profile_experience)
      || this.cleanText(this.linkedMusicianEntity(entity)?.profile_experience)
      || null;
  }

  archiveFeePreview(entity: ArchiveEntity): string | null {
    const source = entity.entity_type === 'musician' ? entity : this.linkedMusicianEntity(entity);
    const min = Number(source?.expected_fee_min || 0);
    const max = Number(source?.expected_fee_max || 0);
    if (min > 0 && max > 0) return `${min}€ – ${max}€`;
    if (min > 0) return `Da ${min}€`;
    if (max > 0) return `Fino a ${max}€`;
    return null;
  }

  archiveFeeNotes(entity: ArchiveEntity): string | null {
    return this.cleanText(entity.expected_fee_notes)
      || this.cleanText(this.linkedMusicianEntity(entity)?.expected_fee_notes)
      || null;
  }

  archiveRoleLabel(entity: ArchiveEntity): string | null {
    return this.cleanText(entity.profile_role_label)
      || this.cleanText(this.linkedMusicianEntity(entity)?.profile_role_label)
      || null;
  }

  get currentResults(): ArchiveEntity[] {
    return this.activeCategory === 'musician' ? this.musicians : this.bands;
  }

  get selectedDetailEntity(): ArchiveEntity | null {
    return this.selectedEntity;
  }

  get selectedProfileSource(): ArchiveEntity | null {
    if (!this.selectedEntity) return null;
    return this.selectedEntity.entity_type === 'musician'
      ? this.selectedEntity
      : this.linkedMusicianEntity(this.selectedEntity);
  }

  setCategory(category: 'musician' | 'band'): void {
    if (this.activeCategory === category) return;
    this.activeCategory = category;
    this.reconcileSelection();
  }

  openEntity(entity: ArchiveEntity): void {
    this.selectedEntity = entity;
  }

  isSelected(entity: ArchiveEntity): boolean {
    return !!this.selectedEntity
      && this.selectedEntity.entity_type === entity.entity_type
      && this.selectedEntity.entity_code === entity.entity_code;
  }

  selectedHeadline(): string {
    return this.selectedEntity?.display_name || (this.selectedEntity?.entity_type === 'band' ? 'Band' : 'Musicista');
  }

  selectedLinkedLabel(): string {
    if (!this.selectedEntity) return '—';
    return this.selectedEntity.entity_type === 'band'
      ? this.linkedMusicianName(this.selectedEntity.linked_code)
      : (this.selectedEntity.linked_code || '—');
  }

  private linkedMusicianEntity(entity: ArchiveEntity): ArchiveEntity | null {
    const code = `${entity.linked_code || ''}`.trim().toUpperCase();
    return code ? this.musicianByCode.get(code) || null : null;
  }

  private cleanText(value: string | null | undefined): string | null {
    const normalized = `${value || ''}`.trim();
    return normalized ? normalized : null;
  }

  private reconcileSelection(): void {
    const current = this.currentResults;
    if (!current.length) {
      this.selectedEntity = null;
      return;
    }
    if (!this.selectedEntity || this.selectedEntity.entity_type !== this.activeCategory) {
      this.selectedEntity = current[0];
      return;
    }
    const match = current.find(item => item.entity_code === this.selectedEntity?.entity_code);
    this.selectedEntity = match || current[0];
  }
}
