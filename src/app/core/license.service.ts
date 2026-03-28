import { Injectable } from '@angular/core';
import { LocalStorageService, LS } from './local-storage.service';
import {
  InviteLicenseActivationResult,
  InviteLicenseValidation,
  SupabaseService
} from './supabase.service';

@Injectable({ providedIn: 'root' })
export class LicenseService {
  readonly defaultAppKey = 'musician_manager';

  constructor(
    private readonly supabase: SupabaseService,
    private readonly ls: LocalStorageService
  ) {}

  normalizeAppKey(appKey?: string | null): string {
    const normalized = `${appKey || ''}`.trim().toLowerCase();
    return normalized || this.defaultAppKey;
  }

  async validateInvite(inviteRef: string, appKey?: string | null): Promise<InviteLicenseValidation> {
    const normalizedRef = `${inviteRef || ''}`.trim();
    const normalizedApp = this.normalizeAppKey(appKey);
    const result = await this.supabase.validateInviteLicense(normalizedRef, normalizedApp);
    if (result.valid) {
      this.ls.setString(LS.LICENSE_REF, normalizedRef);
      this.ls.setString(LS.LICENSE_APP, normalizedApp);
    }
    return result;
  }

  async activateInvite(
    inviteRef: string,
    appKey?: string | null,
    activationContext: Record<string, unknown> = {}
  ): Promise<InviteLicenseActivationResult> {
    const normalizedRef = `${inviteRef || ''}`.trim();
    const normalizedApp = this.normalizeAppKey(appKey);
    const user = await this.supabase.getCurrentUser();
    const result = await this.supabase.activateInviteLicense(
      normalizedRef,
      normalizedApp,
      user?.id || null,
      null,
      activationContext
    );
    this.ls.setString(LS.LICENSE_REF, normalizedRef);
    this.ls.setString(LS.LICENSE_APP, normalizedApp);
    return result;
  }
}
