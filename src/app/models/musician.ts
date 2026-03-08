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
  workerType?: 'cooperativa' | 'libero_professionista' | 'insegnante_piva' | 'esente';
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
  isTeacher?: boolean;
  lessonColor?: string | null;
  concertColor?: string | null;
  signatureData?: string;
  createdAt?: string;
};
