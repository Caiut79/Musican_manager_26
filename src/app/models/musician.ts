export type SocialProfiles = {
  instagram?: string;
  facebook?: string;
  youtube?: string;
  tiktok?: string;
  website?: string;
};

export type InpsExemption = {
  number?: string;
  startDate?: string;
  endDate?: string;
};

export type RoleTaxSetup = {
  code?: string;
  fiscalMode?: 'cooperativa' | 'piva' | 'associazione';
  supportEntity?: string;
  vatNumber?: string;
  taxRegime?: 'ordinario' | 'forfettario' | 'esente_eaps';
  irpefBracket?: '23' | '33' | '43';
  substituteTaxPercent?: number;
  irapPercent?: number;
  inailPercent?: number;
  cooperativeFeePercent?: number;
  cooperativeTaxPercent?: number;
  eventGrossEstimate?: number;
  inpsExempt?: boolean;
};

export type RoleSettings = {
  musician?: RoleTaxSetup;
  dj?: RoleTaxSetup;
  teacher?: RoleTaxSetup;
};

export type Musician = {
  id?: string;
  code?: string;
  firstName: string;
  lastName: string;
  phone?: string;
  birthDate?: string;
  birthPlace?: string;
  fiscalCode?: string;
  residence?: string;
  workerType?: 'cooperativa' | 'libero_professionista' | 'insegnante_piva' | 'misto_piva_lezioni_cooperativa_musica' | 'esente';
  lessonBillingMode?: 'in_fattura' | 'fuori_fattura';
  musicBillingMode?: 'in_fattura' | 'fuori_fattura';
  taxRegime?: 'ordinario' | 'forfettario';
  vatMode?: 'iva_ordinaria' | 'esente' | 'forfettario';
  irpefBracket?: '23' | '33' | '43';
  substituteTaxPercent?: number;
  estimatedAnnualRevenue?: number;
  estimatedAnnualCosts?: number;
  empalsPosition?: string;
  enpalsCategory?: string;
  exemptEmployer?: string;
  exemptEmployerType?: 'dipendente' | 'pensionato' | 'altro';
  homeBase?: string;
  instrument?: string;
  level?: string;
  stylesPlayed?: string[];
  searchableStyles?: string[];
  social?: SocialProfiles;
  inpsExempt?: boolean;
  inpsData?: InpsExemption | null;
  isMusician?: boolean;
  isTeacher?: boolean;
  isDj?: boolean;
  lessonColor?: string | null;
  concertColor?: string | null;
  djColor?: string | null;
  djCode?: string;
  roleSettings?: RoleSettings;
  signatureData?: string;
  createdAt?: string;
};
