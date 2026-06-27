/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Phase = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface ClassLevel {
  id: string;
  name: string;
  phase: Phase;
}

export const CLASSES: ClassLevel[] = [
  { id: '1', name: 'Kelas 1', phase: 'A' },
  { id: '2', name: 'Kelas 2', phase: 'A' },
  { id: '3', name: 'Kelas 3', phase: 'B' },
  { id: '4', name: 'Kelas 4', phase: 'B' },
  { id: '5', name: 'Kelas 5', phase: 'C' },
  { id: '6', name: 'Kelas 6', phase: 'C' },
  { id: '7', name: 'Kelas 7', phase: 'D' },
  { id: '8', name: 'Kelas 8', phase: 'D' },
  { id: '9', name: 'Kelas 9', phase: 'D' },
  { id: '10', name: 'Kelas 10', phase: 'E' },
  { id: '11', name: 'Kelas 11', phase: 'F' },
  { id: '12', name: 'Kelas 12', phase: 'F' },
];

export interface TujuanPembelajaran {
  id: string;
  element: string; // The element/domain of the subject
  statement: string;
  competency: string; 
  content: string;    
  classLevel: string;
  kktp: string[]; // Kriteria Ketercapaian Tujuan Pembelajaran
  materials?: string[]; // Lingkup Materi
  meetings?: { // Rekomendasi Pertemuan
    session: number;
    activity: string;
    modulAjar?: ModulAjar;
  }[];
}

export type LearningModel = 'Problem Based Learning (PBL)' | 'Project Based Learning (PjBL)' | 'Inquiry Learning' | 'Discovery Learning' | 'Cooperative Learning';

export interface ModulAjar {
  title: string;
  tpStatement: string;
  targetStudents: string;
  duration: string;
  ppp: string[]; // Dimensi Profil Lulusan
  media: string[];
  meaningfulUnderstanding: string;
  triggerQuestions: string[];
  model: LearningModel;
  steps?: {
    phase: string;
    activity: string;
  }[];
  meetingActivities?: {
    session: number;
    activityTitle: string;
    steps: {
      phase: string;
      activity: string;
    }[];
  }[];
  assessment: string;
  differentiation: string;
  rubrics?: string;
  lampiran?: string;
  soal?: string;
  materi?: string;
  lkpd?: string;
}

export interface MappingResult {
  cpOriginal: string;
  phase: Phase;
  classes: string[];
  cpPerClass: { [classId: string]: string }; // Breakdown of CP for specific class
  tujuanPembelajaran: TujuanPembelajaran[];
}

export interface ATPItem {
  tpId: string;
  tpStatement: string;
  cp: string; // Capaian Pembelajaran
  element: string;
  competency: string;
  content: string; // Materi
  kktp: string[]; // Indikator Ketercapaian
  jp: number;
  numberOfMeetings: number;
  semester: 1 | 2;
  startWeek: number;
  endWeek: number;
  assessment: string;
  flow: number;
  resources: string[];
  keywords: string[];
  p3: string[]; // Dimensi Profil Lulusan
  classLevel: string;
}

export interface AlurTujuanPembelajaran {
  phase: Phase;
  classes: string[];
  items: ATPItem[];
  rationale: string;
}

export interface SavedPerangkat {
  id?: string;
  userId: string;
  title: string;
  payload: string; // JSON containing { mapelInput, phase, jpPerWeek, selectedClasses, cpContent, mappingResult, atp, modules }
  createdAt: string;
  updatedAt: string;
}
