import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export type SupabaseRuntimeConfig = {
  url: string;
  anonKey: string;
};

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private config: SupabaseRuntimeConfig | null = null;

  constructor(private http: HttpClient) {}

  async load(): Promise<void> {
    if (this.config) return;
    try {
      const cfg = await firstValueFrom(this.http.get<SupabaseRuntimeConfig>('assets/supabase.config.json'));
      this.config = cfg;
    } catch {
      this.config = null;
    }
  }

  getSupabaseConfig(): SupabaseRuntimeConfig | null {
    return this.config;
  }
}
