/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BookOpen, 
  ChevronRight, 
  Sparkles, 
  FileText, 
  CheckCircle2, 
  Loader2, 
  Plus, 
  Trash2, 
  Copy, 
  Download,
  Save,
  AlertCircle,
  MousePointer2,
  Users,
  Layout,
  Clock,
  Eye,
  LogOut,
  ShieldCheck,
  UserPlus,
  Printer,
} from 'lucide-react';
import { CLASSES, MappingResult, Phase, TujuanPembelajaran, LearningModel, ModulAjar, AlurTujuanPembelajaran, ATPItem } from './types';
import { generateTP, generateMaterials, generateModulAjar, generateATP, generateModulAjarFromATP, generateLampiran, generateSoal, generateMateri, generateLKPD, generateKelengkapanModulOtomatis } from './services/openai';
import { auth, googleProvider, db } from './lib/firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, getDocFromServer, query, where, orderBy } from 'firebase/firestore';
import { SavedPerangkat } from './types';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function getCorrectProsemWeeks(items: any[], jpPerWeek: number, meetingsPerWeek: number) {
  // Sort items by flow
  const sorted = [...items].sort((a, b) => (a.flow || 0) - (b.flow || 0));
  
  let currentSem1End = 0;
  let currentSem2End = 0;
  
  return sorted.map((item) => {
    const jp = Number(item.jp) || 0;
    const weeksNeeded = Math.max(1, Math.ceil((jp / jpPerWeek) * meetingsPerWeek));
    
    let start = 1;
    let end = 1;
    
    if (item.semester === 2) {
      start = currentSem2End + 1;
      end = start + weeksNeeded - 1;
      currentSem2End = end;
    } else {
      start = currentSem1End + 1;
      end = start + weeksNeeded - 1;
      currentSem1End = end;
    }
    
    return {
      ...item,
      startWeek: start,
      endWeek: end
    };
  });
}

const safeLocalStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn("localStorage is not accessible:", e);
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn("localStorage is not accessible:", e);
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn("localStorage is not accessible:", e);
    }
  }
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showAccessManager, setShowAccessManager] = useState(false);
  const [authorizedEmails, setAuthorizedEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  
  const [cpText, setCpText] = useState(() => safeLocalStorage.getItem('draft_cpText') || '');
  const [phase, setPhase] = useState<Phase>((safeLocalStorage.getItem('draft_phase') as Phase) || 'A');
  const [selectedClasses, setSelectedClasses] = useState<string[]>(() => {
    try {
      const saved = safeLocalStorage.getItem('draft_selectedClasses');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.error("Failed to parse selectedClasses from localStorage:", e);
    }
    return ['1', '2'];
  });
  const [loading, setLoading] = useState(false);
  const [generatingForTpId, setGeneratingForTpId] = useState<string | null>(null);
  const [generatingModul, setGeneratingModul] = useState(false);
  const [result, setResult] = useState<MappingResult | null>(null);
  const [atp, setAtp] = useState<AlurTujuanPembelajaran | null>(null);
  const [generatingAtp, setGeneratingAtp] = useState(false);
  const [activeResultTab, setActiveResultTab] = useState<'tp' | 'atp' | 'prota' | 'prosem' | 'modul'>('tp');
  const [error, setError] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<{ className: string, content: string } | null>(null);
  const [selectedTpDetail, setSelectedTpDetail] = useState<TujuanPembelajaran | null>(null);
  const [selectingModelFor, setSelectingModelFor] = useState<{ tp: TujuanPembelajaran, session: number, activity: string } | null>(null);
  const [currentModul, setCurrentModul] = useState<ModulAjar | null>(null);
  const [modules, setModules] = useState<Record<string, ModulAjar>>({});
  const [schoolName, setSchoolName] = useState(() => safeLocalStorage.getItem('draft_schoolName') || '');
  const [subject, setSubject] = useState(() => safeLocalStorage.getItem('draft_subject') || '');
  const [teacherName, setTeacherName] = useState(() => safeLocalStorage.getItem('draft_teacherName') || '');
  const [principalName, setPrincipalName] = useState(() => safeLocalStorage.getItem('draft_principalName') || '');
  const [jpPerWeek, setJpPerWeek] = useState(() => safeLocalStorage.getItem('draft_jpPerWeek') || '3');
  const [meetingsPerWeek, setMeetingsPerWeek] = useState(() => safeLocalStorage.getItem('draft_meetingsPerWeek') || '1');
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [paperSize, setPaperSize] = useState<'a4' | 'f4'>('a4');
  const [isPreviewingProsem, setIsPreviewingProsem] = useState(false);
  const [printProsemClassLevel, setPrintProsemClassLevel] = useState<string>('all');
  const [isPreviewingLengkap, setIsPreviewingLengkap] = useState(false);
  const [printLengkapClassLevel, setPrintLengkapClassLevel] = useState<string>('all');

  const [copied, setCopied] = useState(false);
  const [showPanduan, setShowPanduan] = useState(false);
  const [showTentang, setShowTentang] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [isDraftSaved, setIsDraftSaved] = useState(false);

  // States for saved perangkat
  const [viewMode, setViewMode] = useState<'create' | 'saved'>('create');
  const [savedPerangkats, setSavedPerangkats] = useState<SavedPerangkat[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [isSavingPerangkat, setIsSavingPerangkat] = useState(false);

  // States for bulk modul generation
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [generatingProgress, setGeneratingProgress] = useState(0);
  const [totalToGenerate, setTotalToGenerate] = useState(0);
  const [generatingExtraId, setGeneratingExtraId] = useState<string | null>(null);
  const [generatingAutoExtraId, setGeneratingAutoExtraId] = useState<string | null>(null);

  // States for bulk extras generation
  const [isGeneratingAllExtras, setIsGeneratingAllExtras] = useState(false);
  const [extrasProgress, setExtrasProgress] = useState(0);
  const [totalExtrasToGenerate, setTotalExtrasToGenerate] = useState(0);
  const [currentExtraTargetName, setCurrentExtraTargetName] = useState<string>('');

  // Sandbox-safe notification and confirmation helpers
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const triggerAlert = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    try {
      setToast({ message, type });
      // Clear after 4 seconds
      setTimeout(() => {
        setToast(prev => prev?.message === message ? null : prev);
      }, 4000);
    } catch (e) {
      console.error("Failed to show toast:", e);
    }
  };

  const triggerConfirm = (message: string, onConfirm: () => void) => {
    try {
      const result = window.confirm(message);
      if (result) {
        onConfirm();
      }
    } catch (e) {
      console.warn("confirm() blocked by sandbox, showing custom dialog.");
      setConfirmDialog({ message, onConfirm });
    }
  };

  const handleGenerateExtraOtomatis = async (tpId: string) => {
    const modul = modules[tpId];
    if (!modul) return;
    setGeneratingAutoExtraId(tpId);
    setError(null);
    try {
      const resultExtras = await generateKelengkapanModulOtomatis(modul);
      
      setModules(prev => {
        const currentMod = prev[tpId];
        return {
          ...prev,
          [tpId]: {
            ...currentMod,
            lampiran: resultExtras.lampiran || currentMod.lampiran,
            soal: resultExtras.soal || currentMod.soal,
            materi: resultExtras.materi || currentMod.materi,
            lkpd: resultExtras.lkpd || currentMod.lkpd
          }
        };
      });
    } catch (err: any) {
      setError(err.message || "Gagal menghasilkan kelengkapan secara otomatis.");
    } finally {
      setGeneratingAutoExtraId(null);
    }
  };

  const handleGenerateExtra = async (tpId: string, type: 'lampiran' | 'soal' | 'materi' | 'lkpd') => {
    const modul = modules[tpId];
    if (!modul) return;
    setGeneratingExtraId(`${tpId}-${type}`);
    setError(null);
    try {
      let extraResult = '';
      if (type === 'lampiran') extraResult = await generateLampiran(modul);
      else if (type === 'soal') extraResult = await generateSoal(modul);
      else if (type === 'materi') extraResult = await generateMateri(modul);
      else if (type === 'lkpd') extraResult = await generateLKPD(modul);

      setModules(prev => ({
        ...prev,
        [tpId]: {
          ...prev[tpId],
          [type]: extraResult
        }
      }));
    } catch (err: any) {
      setError(err.message || "Gagal menghasilkan dokumen.");
    } finally {
      setGeneratingExtraId(null);
    }
  };

  useEffect(() => {
    safeLocalStorage.setItem('draft_cpText', cpText);
    safeLocalStorage.setItem('draft_phase', phase);
    safeLocalStorage.setItem('draft_selectedClasses', JSON.stringify(selectedClasses));
    safeLocalStorage.setItem('draft_schoolName', schoolName);
    safeLocalStorage.setItem('draft_subject', subject);
    safeLocalStorage.setItem('draft_teacherName', teacherName);
    safeLocalStorage.setItem('draft_principalName', principalName);
    safeLocalStorage.setItem('draft_jpPerWeek', jpPerWeek);
    safeLocalStorage.setItem('draft_meetingsPerWeek', meetingsPerWeek);
    
    if (cpText || schoolName || subject) {
      setIsDraftSaved(true);
      const timer = setTimeout(() => setIsDraftSaved(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [cpText, phase, selectedClasses, schoolName, subject, teacherName, principalName, jpPerWeek]);

  useEffect(() => {
    if (cooldownSeconds > 0) {
      const timer = setTimeout(() => setCooldownSeconds(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldownSeconds]);

  const CP_EXAMPLES = [
    {
      mapel: "Bahasa Indonesia",
      fase: "A (Kelas 1-2)",
      teks: "Peserta didik memiliki kemampuan berbahasa untuk berkomunikasi dan bernalar, sesuai dengan tujuan, kepada teman sebaya dan orang dewasa di sekitar tentang diri dan lingkungannya. Peserta didik menunjukkan minat serta mampu memahami dan menyampaikan pesan; mengekspresikan perasaan dan gagasan; berpartisipasi dalam percakapan dan diskusi sederhana dalam bahasa Indonesia secara santun."
    },
    {
      mapel: "Matematika",
      fase: "B (Kelas 3-4)",
      teks: "Pada akhir fase B, peserta didik dapat menunjukkan pemahaman dan intuisi bilangan (number sense) pada bilangan cacah sampai 10.000. Mereka dapat membaca, menulis, menentukan nilai tempat, membandingkan, mengurutkan, menggunakan nilai tempat, melakukan komposisi dan dekomposisi bilangan tersebut. Mereka juga dapat menyelesaikan masalah berkaitan dengan uang menggunakan ribuan sebagai satuan. Peserta didik dapat melakukan operasi penjumlahan dan pengurangan bilangan cacah sampai 1.000."
    },
    {
      mapel: "IPAS",
      fase: "C (Kelas 5-6)",
      teks: "Peserta didik menganalisis hubungan antara bentuk serta fungsi bagian tubuh pada manusia (pancaindra). Peserta didik dapat membuat simulasi menggunakan bagan/alat bantu sederhana tentang siklus hidup makhluk hidup. Peserta didik dapat mengidentifikasi masalah yang berkaitan dengan pelestarian sumber daya alam di lingkungan sekitarnya dan kaitannya dengan upaya pelestarian makhluk hidup."
    }
  ];

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'authorized_users', 'connection_test'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // jently.f.tamailang@gmail.com is hardcoded as admin
        if (currentUser.email === 'jently.f.tamailang@gmail.com') {
          setIsAuthorized(true);
          fetchAuthorizedEmails();
        } else {
          try {
            const docRef = doc(db, 'authorized_users', currentUser.email!.toLowerCase().trim());
            const docSnap = await getDoc(docRef);
            setIsAuthorized(docSnap.exists());
          } catch (err: any) {
            console.error("Firestore Auth Error:", err);
            setError("Gagal memverifikasi hak akses. Harap periksa koneksi atau hubungi admin.");
          }
        }
      } else {
        setIsAuthorized(null);
      }
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  const fetchAuthorizedEmails = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, 'authorized_users'));
      const emails = querySnapshot.docs.map(doc => doc.id);
      setAuthorizedEmails(emails);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'authorized_users');
    }
  };

  const handleAddEmail = async () => {
    if (!newEmail.trim() || !newEmail.includes('@')) return;
    setEmailLoading(true);
    try {
      const emailPath = `authorized_users/${newEmail.toLowerCase().trim()}`;
      await setDoc(doc(db, 'authorized_users', newEmail.toLowerCase().trim()), {
        addedAt: new Date().toISOString(),
        addedBy: user?.email
      });
      setNewEmail('');
      fetchAuthorizedEmails();
    } catch (err) {
      const emailPath = `authorized_users/${newEmail.toLowerCase().trim()}`;
      handleFirestoreError(err, OperationType.WRITE, emailPath);
    } finally {
      setEmailLoading(false);
    }
  };

  const handleDeleteEmail = async (email: string) => {
    triggerConfirm(`Hapus ${email} dari daftar akses?`, async () => {
      try {
        await deleteDoc(doc(db, 'authorized_users', email));
        fetchAuthorizedEmails();
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `authorized_users/${email}`);
      }
    });
  };

  const fetchSavedPerangkats = async () => {
    if (!user) return;
    setLoadingSaved(true);
    try {
      const q = query(
        collection(db, 'perangkat_ajar'), 
        where('userId', '==', user.uid)
      );
      const querySnapshot = await getDocs(q);
      const items: SavedPerangkat[] = [];
      querySnapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as SavedPerangkat);
      });
      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setSavedPerangkats(items);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'perangkat_ajar');
    } finally {
      setLoadingSaved(false);
    }
  };

  useEffect(() => {
    if (user && viewMode === 'saved') {
      fetchSavedPerangkats();
    }
  }, [user, viewMode]);

  const handleSavePerangkat = async () => {
    if (!user || !result) return;
    setIsSavingPerangkat(true);
    try {
      const payloadString = JSON.stringify({
        subject,
        phase,
        jpPerWeek,
        selectedClasses,
        cpText,
        mappingResult: result,
        atp,
        currentModul,
        modules,
        schoolName,
        teacherName,
        principalName
      });
      
      const title = `${subject || 'Belum dinamai'} - Fase ${phase} (${selectedClasses.join(', ')})`;
      const newDocRef = doc(collection(db, 'perangkat_ajar'));
      const now = new Date().toISOString();
      const docData = {
        userId: user.uid,
        title,
        payload: payloadString,
        createdAt: now,
        updatedAt: now
      };

      await setDoc(newDocRef, docData);
      triggerAlert('Perangkat pembelajaran berhasil disimpan!', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'perangkat_ajar');
      triggerAlert('Gagal menyimpan perangkat: ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setIsSavingPerangkat(false);
    }
  };

  const handleLoadPerangkat = (item: SavedPerangkat) => {
    try {
      const data = JSON.parse(item.payload);
      setSubject(data.subject || '');
      setPhase(data.phase || 'A');
      setJpPerWeek(data.jpPerWeek || 3);
      setSelectedClasses(data.selectedClasses || []);
      setCpText(data.cpText || '');
      setResult(data.mappingResult || null);
      setAtp(data.atp || null);
      setCurrentModul(data.currentModul || null);
      setModules(data.modules || {});
      setSchoolName(data.schoolName || '');
      setTeacherName(data.teacherName || '');
      setPrincipalName(data.principalName || '');
      
      setViewMode('create');
      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      triggerAlert('Gagal memuat dokumen tersimpan: format data tidak valid.', 'error');
    }
  };

  const handleDeletePerangkat = async (id: string) => {
    triggerConfirm('Apakah anda yakin ingin menghapus perangkat ini?', async () => {
      try {
        await deleteDoc(doc(db, 'perangkat_ajar', id));
        fetchSavedPerangkats();
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `perangkat_ajar/${id}`);
      }
    });
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error("Login error:", err);
      setError(`Gagal masuk: ${err.message || 'Harap periksa koneksi internet Anda.'}`);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setResult(null);
      setCurrentModul(null);
    } catch (err: any) {
      console.error("Logout error:", err);
      setError(`Gagal keluar: ${err.message || 'Terjadi kesalahan sistem.'}`);
    }
  };

  const handlePhaseChange = (newPhase: Phase) => {
    setPhase(newPhase);
    // Reset classes based on phase
    const classesInPhase = CLASSES.filter(c => c.phase === newPhase).map(c => c.id);
    setSelectedClasses(classesInPhase);
  };

  const toggleClass = (classId: string) => {
    setSelectedClasses(prev => 
      prev.includes(classId) 
        ? prev.filter(id => id !== classId) 
        : [...prev, classId]
    );
  };

  const [isQuotaError, setIsQuotaError] = useState(false);

  const handleGenerate = async () => {
    if (!user) return;

    if (!cpText.trim()) {
      setError('Harap masukkan teks Capaian Pembelajaran (CP).');
      return;
    }
    if (selectedClasses.length === 0) {
      setError('Harap pilih setidaknya satu kelas.');
      return;
    }

    setLoading(true);
    setError(null);
    setIsQuotaError(false);
    setResult(null);
    setAtp(null);
    setActiveResultTab('tp');
    try {
      const data = await generateTP(cpText, phase, selectedClasses, subject);
      setResult(data);
    } catch (err: any) {
      const msg = err.message || 'Terjadi kesalahan sistem.';
      setError(msg);
      const isQuota = msg.toLowerCase().includes('kuota') || 
                      msg.toLowerCase().includes('quota') || 
                      msg.toLowerCase().includes('limit') || 
                      msg.toLowerCase().includes('429') || 
                      msg.toLowerCase().includes('kecepatan ai');
      
      if (isQuota) {
        setIsQuotaError(true);
        const secondsMatch = msg.match(/retry in (\d+)/);
        if (secondsMatch) {
          setCooldownSeconds(parseInt(secondsMatch[1]) + 2);
        } else {
          setCooldownSeconds(30);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateAtp = async () => {
    if (!result) return;
    setGeneratingAtp(true);
    setError(null);
    setIsQuotaError(false);
    try {
      const atpResult = await generateATP(result, parseInt(jpPerWeek) || 3, parseInt(meetingsPerWeek) || 1, subject);
      setAtp(atpResult);
      setActiveResultTab('atp');
    } catch (err: any) {
      const msg = err.message || "Gagal menyusun ATP.";
      setError(msg);
      if (msg.toLowerCase().includes('kuota') || msg.toLowerCase().includes('limit') || msg.toLowerCase().includes('429')) {
        setIsQuotaError(true);
        setCooldownSeconds(30);
      }
    } finally {
      setGeneratingAtp(false);
    }
  };

  const handleGenerateTpDetails = async (tp: TujuanPembelajaran, numberOfMeetings?: number) => {
    if (!user) return;
    
    if (tp.materials && tp.meetings && (!numberOfMeetings || tp.meetings.length === numberOfMeetings)) {
      setSelectedTpDetail(tp);
      return;
    }

    setGeneratingForTpId(tp.id);
    setError(null);
    setIsQuotaError(false);
    try {
      const details = await generateMaterials(tp, parseInt(jpPerWeek) || 3, numberOfMeetings, subject);
      
      // Update result state with new details
      setResult(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          tujuanPembelajaran: prev.tujuanPembelajaran.map(item => 
            item.id === tp.id ? { ...item, ...details } : item
          )
        };
      });

      setSelectedTpDetail({ ...tp, ...details });
    } catch (err: any) {
      const msg = err.message || "Gagal merekomendasikan materi.";
      setError(msg);
      const isQuota = msg.toLowerCase().includes('kuota') || 
                      msg.toLowerCase().includes('quota') || 
                      msg.toLowerCase().includes('limit') || 
                      msg.toLowerCase().includes('429') || 
                      msg.toLowerCase().includes('kecepatan ai');
                      
      if (isQuota) {
        setIsQuotaError(true);
        const secondsMatch = msg.match(/retry in (\d+)/);
        if (secondsMatch) {
          setCooldownSeconds(parseInt(secondsMatch[1]) + 2);
        } else {
          setCooldownSeconds(30);
        }
      }
    } finally {
      setGeneratingForTpId(null);
    }
  };

  const handleGenerateModul = async (model: LearningModel) => {
    if (!selectingModelFor || !user) return;

    setGeneratingModul(true);
    setError(null);
    setIsQuotaError(false);
    try {
      const modul = await generateModulAjar(
        selectingModelFor.tp,
        selectingModelFor.session,
        selectingModelFor.activity,
        model,
        parseInt(jpPerWeek) || 3,
        subject
      );
      
      // Persist to state
      setResult(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          tujuanPembelajaran: prev.tujuanPembelajaran.map(tp => {
            if (tp.id === selectingModelFor.tp.id && tp.meetings) {
              return {
                ...tp,
                meetings: tp.meetings.map(m => 
                  m.session === selectingModelFor.session ? { ...m, modulAjar: modul } : m
                )
              };
            }
            return tp;
          })
        };
      });

      setCurrentModul(modul);
      setSelectingModelFor(null);
      setActiveResultTab('modul');
    } catch (err: any) {
      const msg = err.message || "Gagal membuat modul ajar.";
      setError(msg);
      const isQuota = msg.toLowerCase().includes('kuota') || 
                      msg.toLowerCase().includes('quota') || 
                      msg.toLowerCase().includes('limit') || 
                      msg.toLowerCase().includes('429') || 
                      msg.toLowerCase().includes('kecepatan ai');
                      
      if (isQuota) {
        setIsQuotaError(true);
        const secondsMatch = msg.match(/retry in (\d+)/);
        if (secondsMatch) {
          setCooldownSeconds(parseInt(secondsMatch[1]) + 2);
        } else {
          setCooldownSeconds(30);
        }
      }
    } finally {
      setGeneratingModul(false);
    }
  };

  const handleGenerateAllModules = async () => {
    if (!atp || !result) return;
    setIsGeneratingAll(true);
    setTotalToGenerate(atp.items.length);
    setGeneratingProgress(0);
    setError(null);
    setIsQuotaError(false);
    
    // Convert current map to mutable object if any
    const currModules = { ...modules };
    let successCount = 0;

    for (const item of atp.items) {
      if (currModules[item.tpId]) {
         successCount++;
         setGeneratingProgress(successCount);
         continue; // already generated
      }
      
      try {
        const modul = await generateModulAjarFromATP(
          item,
          result.phase,
          Number(jpPerWeek) || 3,
          subject
        );
        currModules[item.tpId] = modul;
        setModules({ ...currModules });
        successCount++;
        setGeneratingProgress(successCount);
        
        // Slight delay to avoid hammering the API too hard
        await new Promise(r => setTimeout(r, 1000));
      } catch (err: any) {
        console.error("Error generating modul for tpId", item.tpId, err);
        const msg = err.message || "";
        if (msg.includes('429') || msg.toLowerCase().includes('quota')) {
            setError("Generate terhenti: Kuota OpenAI API Anda habis atau terkena rate limit. Silakan coba lagi nanti.");
            setIsQuotaError(true);
            break;
        }
      }
    }
    
    setIsGeneratingAll(false);
    if (successCount > 0) {
      triggerAlert(`Selesai memproses modul ajar (${successCount}/${atp.items.length}).`, 'success');
    }
  };

  const handleGenerateAllExtras = async () => {
    const tpIds = Object.keys(modules);
    if (tpIds.length === 0) {
      setError("Silakan buat atau pilih setidaknya satu Modul Ajar terlebih dahulu.");
      return;
    }

    setIsGeneratingAllExtras(true);
    setTotalExtrasToGenerate(tpIds.length);
    setExtrasProgress(0);
    setError(null);
    setIsQuotaError(false);

    // Copy modules state to mutate safely
    const updatedModules = { ...modules };
    let successCount = 0;

    for (let i = 0; i < tpIds.length; i++) {
      const tpId = tpIds[i];
      const modul = updatedModules[tpId];
      if (!modul) continue;

      setCurrentExtraTargetName(modul.title || `Modul ${i + 1}`);
      setExtrasProgress(i);

      // Pacing delay (pelan dan profesional)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      try {
        const resultExtras = await generateKelengkapanModulOtomatis(modul);
        
        updatedModules[tpId] = {
          ...modul,
          lampiran: resultExtras.lampiran || modul.lampiran,
          soal: resultExtras.soal || modul.soal,
          materi: resultExtras.materi || modul.materi,
          lkpd: resultExtras.lkpd || modul.lkpd
        };

        // Update state progressively so UI reflects the changes instantly
        setModules({ ...updatedModules });
        successCount++;
        setExtrasProgress(i + 1);
      } catch (err: any) {
        console.error(`Gagal membuat kelengkapan untuk ${modul.title}:`, err);
        const msg = err.message || "";
        if (msg.includes('429') || msg.toLowerCase().includes('quota')) {
          setError("Proses Smart AI terhenti: Kuota OpenAI API Anda habis atau terkena rate limit. Silakan coba lagi nanti.");
          setIsQuotaError(true);
          break;
        }
      }
    }

    setIsGeneratingAllExtras(false);
    setCurrentExtraTargetName('');

    if (successCount > 0) {
      triggerAlert(`Selesai melengkapi ${successCount} Modul Ajar dengan Smart AI!`, 'success');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadFile = (content: string, fileName: string, contentType: string) => {
    // Add UTF-8 BOM for better encoding recognition in Excel/Word
    const blob = new Blob(["\ufeff", content], { type: contentType }); 
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 150);
  };

  const addIdentityToLKPD = (html: string | undefined, activityName: string, subjectName: string): string => {
    if (!html) return '';
    
    const lowercase = html.toLowerCase();
    const hasIdentity = lowercase.includes("identitas") || 
                        lowercase.includes("nama kelompok") || 
                        (lowercase.includes("nama:") && lowercase.includes("kelas:"));
                        
    if (hasIdentity) {
      return html;
    }

    const identityBlock = `
<div style="border: 2px solid #5A5A40; border-radius: 6px; padding: 12px; margin-bottom: 20px; background-color: #fbfbf8; font-family: 'Times New Roman', serif;">
  <p style="text-align: center; font-weight: bold; font-size: 13.5pt; margin-top: 0; margin-bottom: 12px; text-transform: uppercase; color: #5A5A40; border-bottom: 1px solid #5A5A40; padding-bottom: 4px;">
    LEMBAR KERJA PESERTA DIDIK (LKPD) - IDENTITAS SISWA
  </p>
  <table style="width: 100%; border-collapse: collapse; margin-top: 5px; margin-bottom: 5px; border: none !important;">
    <tr style="border: none !important;">
      <td style="width: 25%; font-weight: bold; padding: 6px 0; border: none !important;">Nama Siswa / Kelompok</td>
      <td style="width: 5%; padding: 6px 0; border: none !important;">:</td>
      <td style="width: 70%; border-bottom: 1px dotted #5A5A40 !important; border-top: none !important; border-left: none !important; border-right: none !important; padding: 6px 0;">....................................................................................</td>
    </tr>
    <tr style="border: none !important;">
      <td style="font-weight: bold; padding: 6px 0; border: none !important;">Kelas / No. Presensi</td>
      <td style="padding: 6px 0; border: none !important;">:</td>
      <td style="border-bottom: 1px dotted #5A5A40 !important; border-top: none !important; border-left: none !important; border-right: none !important; padding: 6px 0;">....................................................................................</td>
    </tr>
    <tr style="border: none !important;">
      <td style="font-weight: bold; padding: 6px 0; border: none !important;">Hari, Tanggal Kerja</td>
      <td style="padding: 6px 0; border: none !important;">:</td>
      <td style="border-bottom: 1px dotted #5A5A40 !important; border-top: none !important; border-left: none !important; border-right: none !important; padding: 6px 0;">....................................................................................</td>
    </tr>
    <tr style="border: none !important;">
      <td style="font-weight: bold; padding: 6px 0; border: none !important;">Mata Pelajaran & Topik</td>
      <td style="padding: 6px 0; border: none !important;">:</td>
      <td style="font-style: italic; padding: 6px 0; border: none !important;">\${subjectName || '................'} - \${activityName}</td>
    </tr>
  </table>
</div>
<br/>
`;

    return identityBlock + html;
  };

  const extractContentForMeeting = (html: string | undefined, sessionNum: number, maxSession: number): string => {
    if (!html) return '';

    const patterns = [
      `pertemuan\\s*(ke-)?\\s*${sessionNum}\\b`,
      `sesi\\s*(pertemuan)?\\s*${sessionNum}\\b`
    ];

    let foundIndex = -1;
    for (const pattern of patterns) {
      const rx = new RegExp(pattern, 'i');
      const matched = html.match(rx);
      if (matched && matched.index !== undefined) {
        foundIndex = matched.index;
        break;
      }
    }

    // Check roman numerals fallback
    if (foundIndex === -1) {
      const romanLookup = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
      const roman = romanLookup[sessionNum];
      if (roman) {
        const rxRoman = new RegExp(`pertemuan\\s*${roman}\\b`, 'i');
        const matchedRoman = html.match(rxRoman);
        if (matchedRoman && matchedRoman.index !== undefined) {
          foundIndex = matchedRoman.index;
        }
      }
    }

    if (foundIndex === -1) {
      // Fallback: if single session or first session, return full if no matching found
      if (sessionNum === 1) {
        return html;
      }
      return '';
    }

    // Backtrack to find preceding header/block tag start if any
    let startIndex = foundIndex;
    const searchWindow = html.substring(Math.max(0, foundIndex - 100), foundIndex);
    const tagMatch = searchWindow.match(/<h[1-6][^>]*>$|<p[^>]*>$|<div[^>]*>$|<p\s.*>$|<div\s.*>$/i);
    if (tagMatch && tagMatch.index !== undefined) {
      startIndex = foundIndex - (100 - tagMatch.index);
    } else {
      const lastBracket = searchWindow.lastIndexOf('<');
      if (lastBracket !== -1 && (searchWindow.substring(lastBracket).startsWith('<h3>') || searchWindow.substring(lastBracket).startsWith('<h4>') || searchWindow.substring(lastBracket).startsWith('<h2>') || searchWindow.substring(lastBracket).startsWith('<p>') || searchWindow.substring(lastBracket).startsWith('<div>'))) {
        startIndex = foundIndex - (100 - lastBracket);
      }
    }

    // Find bound for the next session
    let nextIndex = -1;
    const nextSessionNum = sessionNum + 1;
    if (nextSessionNum <= maxSession + 1) {
      for (let s = nextSessionNum; s <= maxSession + 3; s++) {
        const nextPatterns = [
          `pertemuan\\s*(ke-)?\\s*${s}\\b`,
          `sesi\\s*(pertemuan)?\\s*${s}\\b`
        ];
        for (const pattern of nextPatterns) {
          const rx = new RegExp(pattern, 'i');
          const matched = html.match(rx);
          if (matched && matched.index !== undefined && matched.index > foundIndex) {
            nextIndex = matched.index;
            break;
          }
        }
        if (nextIndex !== -1) break;

        const romanLookup = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
        const roman = romanLookup[s];
        if (roman) {
          const rxRoman = new RegExp(`pertemuan\\s*${roman}\\b`, 'i');
          const matchedRoman = html.match(rxRoman);
          if (matchedRoman && matchedRoman.index !== undefined && matchedRoman.index > foundIndex) {
            nextIndex = matchedRoman.index;
            break;
          }
        }
        if (nextIndex !== -1) break;
      }
    }

    let endIdx = html.length;
    if (nextIndex !== -1) {
      // Backtrack nextIndex to preceding tag start as well
      let nextStartIdx = nextIndex;
      const nextSearchWindow = html.substring(Math.max(0, nextIndex - 100), nextIndex);
      const nextTagMatch = nextSearchWindow.match(/<h[1-6][^>]*>$|<p[^>]*>$|<div[^>]*>$|<p\s.*>$|<div\s.*>$/i);
      if (nextTagMatch && nextTagMatch.index !== undefined) {
        nextStartIdx = nextIndex - (100 - nextTagMatch.index);
      } else {
        const nextLastBracket = nextSearchWindow.lastIndexOf('<');
        if (nextLastBracket !== -1 && (nextSearchWindow.substring(nextLastBracket).startsWith('<h3>') || nextSearchWindow.substring(nextLastBracket).startsWith('<h4>') || nextSearchWindow.substring(nextLastBracket).startsWith('<h2>'))) {
          nextStartIdx = nextIndex - (100 - nextLastBracket);
        }
      }
      endIdx = nextStartIdx;
    }

    return html.substring(startIndex, endIdx);
  };

  const handleDownloadTPDoc = () => {
    if (!result) return;
    
    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Pemetaan TP - Fase ${phase}</title>
        <style>
          body { font-family: 'Times New Roman', Times, serif; padding: 20px; }
          h1, h2 { text-align: center; text-transform: uppercase; margin-bottom: 5px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { border: 1px solid black; padding: 8px; text-align: left; vertical-align: top; font-size: 11pt; }
          th { background-color: #f2f2f2; font-weight: bold; }
          .header-info { margin-bottom: 20px; }
          h3 { background-color: #eee; padding: 5px; margin-top: 25px; border: 1px solid #000; }
                  @page { size: 21.59cm 33.02cm; margin: 2.54cm; }           @page WordSection1 { size: 21.59cm 33.02cm; margin: 2.54cm; }
          div.WordSection1 { page: WordSection1; }
        </style>
      </head>
      <body><div class="WordSection1">
        <h1>PEMETAAN TUJUAN PEMBELAJARAN</h1>
        <h2>Fase ${phase}</h2>
        
        <div class="header-info">
          <p><b>Sekolah:</b> ${schoolName || '................................'}</p>
          <p><b>Mata Pelajaran:</b> ${subject || '................................'}</p>
        </div>

        ${[...(result.classes || [])].sort((a,b) => parseInt(a)-parseInt(b)).map(classId => {
          const className = CLASSES.find(c => c.id === classId)?.name || `Kelas ${classId}`;
          const cp = result.cpPerClass?.[classId] || "";
          const tps = result.tujuanPembelajaran?.filter(tp => tp.classLevel === classId) || [];
          return `
            <h3>${className}</h3>
            <p><b>Ringkasan CP:</b> ${cp}</p>
            <table>
              <thead>
                <tr>
                  <th style="width: 50%">Tujuan Pembelajaran</th>
                  <th style="width: 50%">KKTP (Kriteria)</th>
                </tr>
              </thead>
              <tbody>
                ${tps.map(tp => `
                  <tr>
                    <td>${tp.statement}</td>
                    <td>${tp.kktp?.map(k => renderKKTPWithBloomBadgeHtml(k)).join('') || ''}</td>
                  </tr>
                `).join('')}
                ${tps.length === 0 ? '<tr><td colspan="2" style="text-align:center">Data tidak tersedia</td></tr>' : ''}
              </tbody>
            </table>
          `;
        }).join('') || ''}
      </div></body>
      </html>
    `;
    const sanitizedFileName = `Pemetaan_TP_Fase_${phase}.doc`.replace(/[^a-zA-Z0-9.-]/g, '_');
    downloadFile(htmlContent, sanitizedFileName, 'application/msword;charset=utf-8');
  };

  const handleDownloadATP = () => {
    if (!atp) return;

    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Alur Tujuan Pembelajaran - Fase ${atp.phase}</title>
        <style>
          body { font-family: 'Times New Roman', Times, serif; padding: 20px; font-size: 11pt; }
          h1, h2 { text-align: center; text-transform: uppercase; margin-bottom: 5px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; table-layout: fixed; }
          th, td { border: 1px solid black; padding: 6px; text-align: left; vertical-align: top; word-wrap: break-word; font-size: 10pt; }
          th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
          .header-info { margin-bottom: 20px; }
          .footer-table { width: 100%; margin-top: 50px; font-size: 11pt; }
          .rationale-box { margin-bottom: 20px; padding: 10px; border: 1px solid #ccc; background-color: #f9f9f9; }
        </style>
      </head>
      <body><div class="WordSection1">
        <h1>ALUR TUJUAN PEMBELAJARAN (ATP)</h1>
        <h2>Fase ${atp.phase}</h2>
        
        <div class="header-info">
          <p><b>Sekolah:</b> ${schoolName || '................................'}</p>
          <p><b>Mata Pelajaran:</b> ${subject || '................................'}</p>
          <p><b>Penyusun:</b> ${teacherName || '................................'}</p>
        </div>

        <div class="rationale-box">
          <p><b>Rasionalisasi:</b></p>
          <p>${atp.rationale}</p>
        </div>

        ${Array.from(new Set(atp.items.map(i => i.classLevel))).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })).map(classLevel => {
          const classItems = atp.items.filter(item => item.classLevel === classLevel).sort((a,b) => a.flow - b.flow);
          return `
          <h2 style="text-align: left; margin-top: 30px;">Tujuan Pembelajaran Kelas ${classLevel}</h2>
          <table>
            <thead>
              <tr>
                <th style="width: 5%">No</th>
                <th style="width: 15%">Capaian Pembelajaran (CP)</th>
                <th style="width: 15%">Tujuan Pembelajaran (TP)</th>
                <th style="width: 15%">Indikator Ketercapaian (KKTP)</th>
                <th style="width: 10%">Materi</th>
                <th style="width: 5%">JP / Pertemuan</th>
                <th style="width: 10%">Asesmen</th>
                <th style="width: 15%">Sumber Belajar & Dimensi Profil Lulusan</th>
              </tr>
            </thead>
            <tbody>
              ${classItems.map((item, index) => `
                <tr>
                  <td align="center">${index + 1}</td>
                  <td>${item.cp}</td>
                  <td>${item.tpStatement}</td>
                  <td>
                    ${item.kktp?.map(k => renderKKTPWithBloomBadgeHtml(k)).join('') || ''}
                  </td>
                  <td>${item.content}</td>
                  <td align="center">${item.jp} JP<br>(${item.numberOfMeetings} Perte.)</td>
                  <td>${item.assessment}</td>
                  <td>
                    <b>Sumber:</b><br>${item.resources?.join(', ') || ''}<br><br>
                    <b>Dimensi Profil Lulusan:</b><br>${item.p3?.join(', ') || ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          `;
        }).join('')}

        <table class="footer-table">
          <tr>
            <td width="50%" align="center" style="border:none">
              Mengetahui,<br>Kepala Sekolah<br><br><br><br><br>
              <b>${principalName || '................................'}</b><br>
              NIP. ................................
            </td>
            <td width="50%" align="center" style="border:none">
              ${new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}<br>Guru Mata Pelajaran<br><br><br><br><br>
              <b>${teacherName || '................................'}</b><br>
              NIP. ................................
            </td>
          </tr>
        </table>
      </div></body>
      </html>
    `;
    const sanitizedFileName = `ATP_Fase_${atp.phase}_${(subject || 'Mapel').replace(/[^a-zA-Z0-9]/g, '_')}.doc`;
    downloadFile(htmlContent, sanitizedFileName, 'application/msword;charset=utf-8');
  };

  const handleDownloadProta = () => {
    if (!atp) return;
    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Program Tahunan - Fase ${atp.phase}</title>
        <style>
          body { font-family: 'Times New Roman', Times, serif; padding: 20px; font-size: 11pt; }
          h1, h2, h3 { text-align: center; text-transform: uppercase; margin-bottom: 5px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; table-layout: fixed; }
          th, td { border: 1px solid black; padding: 6px; text-align: left; vertical-align: top; word-wrap: break-word; font-size: 10pt; }
          th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
        </style>
      </head>
      <body><div class="WordSection1">
        <h1>PROGRAM TAHUNAN (PROTA)</h1>
        <h2>Fase ${atp.phase}</h2>
        <br/>
        <p><b>Mata Pelajaran:</b> ${subject || '................................'}</p>
        <p><b>Sekolah:</b> ${schoolName || '................................'}</p>
        <br/>
        ${Array.from(new Set(atp.items.map(i => i.classLevel))).sort((a,b) => String(a).localeCompare(String(b), undefined, { numeric: true })).map(classLevel => {
          const items = atp.items.filter(i => i.classLevel === classLevel).sort((a,b) => a.flow - b.flow);
          const sem1 = items.filter(i => i.semester === 1);
          const sem2 = items.filter(i => i.semester === 2);
          return `
            <h3 style="background-color:#eee; border:1px solid #000; font-size: 13pt; margin-top:20px; padding: 5px; text-align: left;">Kelas ${classLevel}</h3>
            <table>
               <thead>
                  <tr><th style="width:10%">Semester</th><th style="width:70%">Tujuan Pembelajaran</th><th style="width:20%">Alokasi Waktu</th></tr>
               </thead>
               <tbody>
                  <tr>
                     <td rowspan="${Math.max(sem1.length, 1)}" align="center"><b>I (Ganjil)</b></td>
                     ${sem1.length > 0 ? `<td>${sem1[0].tpStatement}</td><td align="center">${sem1[0].jp} JP</td>` : '<td colspan="2">Belum ada data</td>'}
                  </tr>
                  ${sem1.slice(1).map(item => `<tr><td>${item.tpStatement}</td><td align="center">${item.jp} JP</td></tr>`).join('')}
                  <tr>
                     <td rowspan="${Math.max(sem2.length, 1)}" align="center"><b>II (Genap)</b></td>
                     ${sem2.length > 0 ? `<td>${sem2[0].tpStatement}</td><td align="center">${sem2[0].jp} JP</td>` : '<td colspan="2">Belum ada data</td>'}
                  </tr>
                  ${sem2.slice(1).map(item => `<tr><td>${item.tpStatement}</td><td align="center">${item.jp} JP</td></tr>`).join('')}
               </tbody>
            </table>
          `;
        }).join('')}
      </div></body>
      </html>
    `;
    const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Prota_Fase_${atp.phase}_${subject}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadProsem = () => {
    if (!atp) return;
    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Program Semester - Fase ${atp.phase}</title>
        <style>
          body { font-family: 'Times New Roman', Times, serif; padding: 20px; font-size: 11pt; }
          h1, h2, h3 { text-align: center; text-transform: uppercase; margin-bottom: 5px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; table-layout: fixed; }
          th, td { border: 1px solid black; padding: 6px; text-align: left; vertical-align: top; word-wrap: break-word; font-size: 10pt; }
          th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
        </style>
      </head>
      <body><div class="WordSection1">
        <h1>PROGRAM SEMESTER (PROSEM)</h1>
        <h2>Fase ${atp.phase}</h2>
        <br/>
        <p><b>Mata Pelajaran:</b> ${subject || '................................'}</p>
        <p><b>Sekolah:</b> ${schoolName || '................................'}</p>
        <br/>
        ${Array.from(new Set(atp.items.map(i => i.classLevel))).sort((a,b) => String(a).localeCompare(String(b), undefined, { numeric: true })).map(classLevel => {
          const rawItems = atp.items.filter(i => i.classLevel === classLevel).sort((a,b) => a.flow - b.flow);
          const items = getCorrectProsemWeeks(rawItems, parseInt(jpPerWeek) || 3, parseInt(meetingsPerWeek) || 1);
          return `
            <h3 style="background-color:#eee; border:1px solid #000; font-size: 13pt; margin-top:20px; padding: 5px; text-align: left;">Kelas ${classLevel}</h3>
            <table>
               <thead>
                  <tr><th style="width:5%">No</th><th style="width:55%">Capaian / Tujuan Pembelajaran</th><th style="width:10%">JP</th><th style="width:30%">Alokasi Waktu (Minggu Efektif)</th></tr>
               </thead>
               <tbody>
                  ${items.map((di, idx) => `
                     <tr>
                        <td align="center">${idx + 1}</td>
                        <td>${di.tpStatement}</td>
                        <td align="center">${di.jp}</td>
                        <td align="center">Semester ${di.semester}<br/>Minggu ke-${di.startWeek} ${di.endWeek > di.startWeek ? `s.d ${di.endWeek}` : ''}</td>
                     </tr>
                  `).join('')}
               </tbody>
            </table>
          `;
        }).join('')}
      </div></body>
      </html>
    `;
    const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Prosem_Fase_${atp.phase}_${subject}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadProsemClass = (classLevel: string) => {
    if (!atp) return;
    const rawItems = atp.items.filter(i => i.classLevel === classLevel).sort((a,b) => a.flow - b.flow);
    const items = getCorrectProsemWeeks(rawItems, parseInt(jpPerWeek) || 3, parseInt(meetingsPerWeek) || 1);
    
    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Program Semester Kelas ${classLevel} - Fase ${atp.phase}</title>
        <style>
          body { font-family: 'Times New Roman', Times, serif; padding: 20px; font-size: 11pt; }
          h1, h2, h3 { text-align: center; text-transform: uppercase; margin-bottom: 5px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; table-layout: fixed; }
          th, td { border: 1px solid black; padding: 6px; text-align: left; vertical-align: top; word-wrap: break-word; font-size: 10pt; }
          th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
        </style>
      </head>
      <body><div class="WordSection1">
        <h1>PROGRAM SEMESTER (PROSEM)</h1>
        <h2>Kelas ${classLevel} - Fase ${atp.phase}</h2>
        <br/>
        <p><b>Mata Pelajaran:</b> ${subject || '................................'}</p>
        <p><b>Sekolah:</b> ${schoolName || '................................'}</p>
        <br/>
        <h3 style="background-color:#eee; border:1px solid #000; font-size: 13pt; margin-top:20px; padding: 5px; text-align: left;">Kelas ${classLevel}</h3>
        <table>
           <thead>
              <tr><th style="width:5%">No</th><th style="width:55%">Capaian / Tujuan Pembelajaran</th><th style="width:10%">JP</th><th style="width:30%">Alokasi Waktu (Minggu Efektif)</th></tr>
           </thead>
           <tbody>
              ${items.map((di, idx) => `
                 <tr>
                    <td align="center">${idx + 1}</td>
                    <td>${di.tpStatement}</td>
                    <td align="center">${di.jp}</td>
                    <td align="center">Semester ${di.semester}<br/>Minggu ke-${di.startWeek} ${di.endWeek > di.startWeek ? `s.d ${di.endWeek}` : ''}</td>
                 </tr>
              `).join('')}
           </tbody>
        </table>
      </div></body>
      </html>
    `;
    const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Prosem_Kelas_${classLevel}_Fase_${atp.phase}_${subject}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadJurnalDoc = () => {
    if (!atp || !atp.items) return;

    let htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Jurnal Mengajar - Fase ${atp.phase}</title>
        <style>
          @page WordSection1 { size: portrait; margin: 2.54cm; }
          @page WordSection2 { size: landscape; margin: 2.54cm; }
          div.WordSection1 { page: WordSection1; }
          div.WordSection2 { page: WordSection2; }
          body { font-family: 'Times New Roman', serif; font-size: 11pt; color: black; line-height: 1.3; }
          h1, h2 { text-align: center; text-transform: uppercase; margin-bottom: 10px; font-weight: bold; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 10px; table-layout: fixed; }
          th, td { border: 1px solid #000; padding: 4px; text-align: left; font-size: 9pt; word-wrap: break-word; }
          th { background-color: #f2f2e6; font-weight: bold; text-align: center; }
          
          .footer-table { width: 100%; margin-top: 20px; font-size: 10pt; border: none; }
          .footer-table td { border: none; }
        </style>
      </head>
      <body><div class="WordSection2">
        <h1>JURNAL MENGAJAR GURU</h1>
        <h2>Fase ${atp.phase}</h2>
        <br/>
        
        <div class="header-info">
          <p><b>Sekolah&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</b> ${schoolName || '................................'}</p>
          <p><b>Mata Pelajaran&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</b> ${subject || '................................'}</p>
          <p><b>Fase/Kelas&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</b> ${atp.phase} / ${selectedClasses.join(', ') || '................................'}</p>
          <p><b>Guru Mata Pelajaran :</b> ${teacherName || '................................'}</p>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width:5%;">No</th>
              <th style="width:15%;">Hari/Tanggal</th>
              <th style="width:8%;">Jam Ke</th>
              <th style="width:10%;">Kelas</th>
              <th style="width:18%;">Topik / Modul</th>
              <th style="width:25%;">Tujuan Pembelajaran & Aktivitas Pokok</th>
              <th style="width:19%;">Keterangan / Kehadiran</th>
            </tr>
          </thead>
          <tbody>
    `;

    let globalCounter = 1;
    atp.items.forEach((item) => {
      const mod = modules[item.tpId];
      if (mod && mod.meetingActivities?.length) {
        mod.meetingActivities.forEach((ma) => {
           htmlContent += `
             <tr>
               <td align="center">${globalCounter++}</td>
               <td></td>
               <td></td>
               <td>${item.classLevel}</td>
               <td><b>${ma.activityTitle || mod.title || 'Modul '+globalCounter}</b></td>
               <td>
                 <b>TP:</b> ${item.tpStatement}<br/><br/>
                 <b>Aktivitas:</b><br/>${ma.steps?.map(s => `- ${s.activity}`).join('<br/>') || ''}
               </td>
               <td></td>
             </tr>
           `;
        });
      } else {
        htmlContent += `
          <tr>
            <td align="center">${globalCounter++}</td>
            <td></td>
            <td></td>
            <td>${item.classLevel}</td>
            <td><b>${mod?.title || 'Topik '+globalCounter}</b></td>
            <td><b>TP:</b> ${item.tpStatement}</td>
            <td></td>
          </tr>
        `;
      }
    });

    htmlContent += `
          </tbody>
        </table>

        <!-- FOOTER TTD -->
        <table class="footer-table">
          <tr>
            <td style="width:50%; text-align:center;">Mengetahui,<br/>Kepala Sekolah<br/><br/><br/><br/><b><u>${principalName || '................................'}</u></b><br/>NIP. ................................</td>
            <td style="width:50%; text-align:center;">${new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}<br/>Guru Mata Pelajaran<br/><br/><br/><br/><b><u>${teacherName || '................................'}</u></b><br/>NIP. ................................</td>
          </tr>
        </table>
      </div></body>
      </html>
    `;

    const blob = new Blob(['\\ufeff', htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Jurnal_Mengajar_Fase_${atp.phase}_${subject?.replace(/[^a-zA-Z0-9]/g, '_')}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadDaftarNilaiDoc = () => {
    if (!atp || !atp.items) return;

    let htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Daftar Nilai - Fase ${atp.phase}</title>
        <style>
          @page WordSection1 { size: portrait; margin: 2.54cm; }
          @page WordSection2 { size: landscape; margin: 2.54cm; }
          div.WordSection1 { page: WordSection1; }
          div.WordSection2 { page: WordSection2; }
          body { font-family: 'Times New Roman', serif; font-size: 11pt; color: black; line-height: 1.3; }
          h1, h2 { text-align: center; text-transform: uppercase; margin-bottom: 10px; font-weight: bold; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; table-layout: fixed; }
          th, td { border: 1px solid #000; padding: 5px; text-align: left; vertical-align: middle; font-size: 10pt; word-wrap: break-word; }
          th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
          .header-info { margin-bottom: 20px; font-size: 11pt; }
          .header-info p { margin: 2px 0; }
          .footer-table { width: 100%; margin-top: 30px; font-size: 11pt; border: none; }
          .footer-table td { border: none; }
        </style>
      </head>
      <body><div class="WordSection2">
    `;

    let fileContentHasEntry = false;

    // Generate table per each meeting activity
    atp.items.forEach((item) => {
      const mod = modules[item.tpId];
      if (mod && mod.meetingActivities?.length) {
        mod.meetingActivities.forEach((ma) => {
           fileContentHasEntry = true;
           htmlContent += `
             <br clear="all" style="page-break-before:always" />
             <h1>DAFTAR NILAI HARIAN / FORMATIF</h1>
             <h2>Pertemuan: ${ma.activityTitle || mod.title}</h2>
             <br/>
             <div class="header-info">
                <p><b>Mata Pelajaran:</b> ${subject || '................................'}</p>
                <p><b>Fase/Kelas:</b> ${atp.phase} / ${item.classLevel}</p>
                <p><b>Tujuan Pembelajaran:</b> ${item.tpStatement}</p>
             </div>
             <table>
               <thead>
                 <tr>
                   <th rowspan="2" style="width:5%;">No</th>
                   <th rowspan="2" style="width:25%;">Nama Siswa</th>
                   <th rowspan="2" style="width:10%;">L/P</th>
                   <th colspan="4">Kriteria Penilaian / KKTP</th>
                   <th rowspan="2" style="width:10%;">Nilai Akhir</th>
                   <th rowspan="2" style="width:15%;">Keterangan</th>
                 </tr>
                 <tr>
                    <th style="width:8%; font-size: 9px;">Kriteria 1</th>
                    <th style="width:8%; font-size: 9px;">Kriteria 2</th>
                    <th style="width:8%; font-size: 9px;">Kriteria 3</th>
                    <th style="width:8%; font-size: 9px;">Kriteria 4</th>
                 </tr>
               </thead>
               <tbody>
           `;
           
           for(let i=1; i<=30; i++) {
             htmlContent += `
                <tr>
                   <td align="center" style="height: 25px;">${i}</td>
                   <td></td>
                   <td></td>
                   <td></td>
                   <td></td>
                   <td></td>
                   <td></td>
                   <td></td>
                   <td></td>
                </tr>
             `;
           }

           htmlContent += `
               </tbody>
             </table>
             <table class="footer-table">
               <tr>
                 <td style="width:50%; text-align:center;">Mengetahui,<br/>Kepala Sekolah<br/><br/><br/><br/><b><u>${principalName || '................................'}</u></b><br/>NIP. ................................</td>
                 <td style="width:50%; text-align:center;">${new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}<br/>Guru Mata Pelajaran<br/><br/><br/><br/><b><u>${teacherName || '................................'}</u></b><br/>NIP. ................................</td>
               </tr>
             </table>
           `;
        });
      }
    });

    if (!fileContentHasEntry) {
        htmlContent += `
            <h1>DAFTAR NILAI HARIAN / FORMATIF</h1>
             <br/>
             <div class="header-info">
                <p><b>Mata Pelajaran:</b> ${subject || '................................'}</p>
                <p><b>Fase/Kelas:</b> ${atp.phase}</p>
             </div>
             <table>
               <thead>
                 <tr>
                   <th rowspan="2" style="width:5%;">No</th>
                   <th rowspan="2" style="width:25%;">Nama Siswa</th>
                   <th rowspan="2" style="width:10%;">L/P</th>
                   <th colspan="4">Kriteria Penilaian / KKTP</th>
                   <th rowspan="2" style="width:10%;">Nilai Akhir</th>
                   <th rowspan="2" style="width:15%;">Keterangan</th>
                 </tr>
                 <tr>
                    <th style="width:8%; font-size: 9px;">Kriteria 1</th>
                    <th style="width:8%; font-size: 9px;">Kriteria 2</th>
                    <th style="width:8%; font-size: 9px;">Kriteria 3</th>
                    <th style="width:8%; font-size: 9px;">Kriteria 4</th>
                 </tr>
               </thead>
               <tbody>
        `;
        for(let i=1; i<=30; i++) {
             htmlContent += `
                <tr>
                   <td align="center" style="height: 25px;">${i}</td>
                   <td></td>
                   <td></td>
                   <td></td>
                   <td></td>
                   <td></td>
                   <td></td>
                   <td></td>
                   <td></td>
                </tr>
             `;
        }
        htmlContent += `
               </tbody>
             </table>
             <table class="footer-table">
               <tr>
                 <td style="width:50%; text-align:center;">Mengetahui,<br/>Kepala Sekolah<br/><br/><br/><br/><b><u>${principalName || '................................'}</u></b><br/>NIP. ................................</td>
                 <td style="width:50%; text-align:center;">${new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}<br/>Guru Mata Pelajaran<br/><br/><br/><br/><b><u>${teacherName || '................................'}</u></b><br/>NIP. ................................</td>
               </tr>
             </table>
           `;
    }

    htmlContent += `</div></body></html>`;

    const blob = new Blob(['\ufeff', htmlContent], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Daftar_Nilai_Fase_${atp.phase}_${subject?.replace(/[^a-zA-Z0-9]/g, '_')}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  const formatActivityTextToBlocks = (text: string): string[] => {
    if (!text) return [];
    
    // First, standard splitting by newlines
    let rawLines = text.split(/\r?\n/);
    
    // If it's a giant single line but contains inline numbered steps like "1. ... 2. ..."
    // we split by looking ahead at digit-dot sequences (e.g. "1. ", "2. ")
    if (rawLines.length <= 1) {
      rawLines = text.split(/(?=\b\d+\.[\s\xA0])/g);
    }
    
    const cleaned = rawLines
      .map(line => line.trim())
      .filter(line => line.length > 0);
      
    return cleaned.length > 0 ? cleaned : [text];
  };

  const renderActivityTextHtml = (text: string): string => {
    const blocks = formatActivityTextToBlocks(text);
    const listItems = blocks.map(block => {
      const cleanedText = block.replace(/^(\d+\.|-|•|\*)\s*/, '');
      return `<li style="margin-bottom:6px; text-align:justify; line-height:1.4;">${cleanedText}</li>`;
    }).join('');
    return `<ol style="margin-top: 0; margin-bottom: 0; padding-left: 20px;">${listItems}</ol>`;
  };

  const renderActivityTextJsx = (text: string) => {
    const blocks = formatActivityTextToBlocks(text);
    return (
      <ol className="list-decimal space-y-2 pl-5 m-0 text-justify text-xs sm:text-sm">
        {blocks.map((block, idx) => {
          const cleanedText = block.replace(/^(\d+\.|-|•|\*)\s*/, '');
          return (
            <li key={idx} className="leading-relaxed m-0">
              {cleanedText}
            </li>
          );
        })}
      </ol>
    );
  };

  const renderKKTPWithBloomBadgeHtml = (text: string): string => {
    if (!text) return '';
    const match = text.match(/^\[(C\d)[^\]]*\]\s*(.*)$/i);
    if (match) {
      const code = match[1].toUpperCase();
      const levelLabel = text.substring(1, text.indexOf(']'));
      const rest = match[2];
      
      let color = "#0284c7"; 
      let bg = "#f0f9ff";
      if (code === "C2") { color = "#059669"; bg = "#ecfdf5"; } 
      else if (code === "C3") { color = "#d97706"; bg = "#fffbeb"; } 
      else if (code === "C4") { color = "#4f46e5"; bg = "#eef2ff"; } 
      else if (code === "C5") { color = "#7c3aed"; bg = "#f5f3ff"; } 
      else if (code === "C6") { color = "#db2777"; bg = "#fdf2f8"; } 
      
      return `<div style="margin-bottom:6px; line-height:1.4;"><span style="display:inline-block; padding:2px 6px; font-size:8pt; font-weight:bold; color:${color}; background-color:${bg}; border:1px solid ${color}30; border-radius:4px; margin-right:6px; text-transform:uppercase;">${levelLabel}</span><span style="font-size:10pt;">${rest}</span></div>`;
    }
    return `<div style="margin-bottom:4px; font-size:10pt; line-height:1.4;">${text}</div>`;
  };

  const renderKKTPWithBloomBadgeJsx = (text: string) => {
    if (!text) return null;
    const match = text.match(/^\[(C\d)[^\]]*\]\s*(.*)$/i);
    if (match) {
      const code = match[1].toUpperCase();
      const levelLabel = text.substring(1, text.indexOf(']'));
      const rest = match[2];
      
      let badgeStyle = "bg-sky-50 text-sky-700 border-sky-100";
      if (code === "C2") badgeStyle = "bg-emerald-50 text-emerald-700 border-emerald-100";
      else if (code === "C3") badgeStyle = "bg-amber-50 text-amber-700 border-amber-100";
      else if (code === "C4") badgeStyle = "bg-indigo-50 text-indigo-700 border-indigo-100";
      else if (code === "C5") badgeStyle = "bg-purple-50 text-purple-700 border-purple-100";
      else if (code === "C6") badgeStyle = "bg-rose-50 text-rose-700 border-rose-100";
      
      return (
        <div className="flex flex-col sm:flex-row sm:items-start gap-1 pb-1">
          <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-extrabold rounded border ${badgeStyle} whitespace-nowrap uppercase tracking-wider h-fit mt-0.5`}>
            {levelLabel}
          </span>
          <span className="text-[#141414]/80 text-xs sm:text-sm leading-relaxed text-justify">{rest}</span>
        </div>
      );
    }
    return <span className="text-[#141414]/80 text-xs sm:text-sm leading-relaxed text-justify">{text}</span>;
  };

  const renderKegiatanPembelajaranTable = (steps: any[]) => {
    if (!steps || steps.length === 0) {
      return `
        <table style="width:100%; border-collapse:collapse; margin-top:10px; margin-bottom:15px; border:1px solid black; table-layout:auto;">
          <thead>
            <tr style="background-color:#F5F5F0;">
              <th style="border:1px solid black; padding:8px; width:8%; text-align:center; font-weight:bold; font-size:10.5pt;">No.</th>
              <th style="border:1px solid black; padding:8px; width:22%; font-weight:bold; font-size:10.5pt; text-align:left;">Kegiatan / Fase</th>
              <th style="border:1px solid black; padding:8px; font-weight:bold; font-size:10.5pt; text-align:left;">Rincian Aktivitas Pembelajaran</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="border:1px solid black; padding:8px; text-align:center; vertical-align:top; font-size:10pt;">1</td>
              <td style="border:1px solid black; padding:8px; font-weight:bold; vertical-align:top; font-size:10pt; color:#5A5A40;">Pendahuluan (15 Menit)</td>
              <td style="border:1px solid black; padding:8px; vertical-align:top; font-size:10pt; text-align:justify;">
                ${renderActivityTextHtml(`1. Guru membuka pelajaran dengan mengucapkan salam hangat dan mengajak siswa berdoa bersama dipimpin ketua kelas (3 Menit).
                2. Guru memeriksa kehadiran siswa dan merapikan ruang kelas (2 Menit).
                3. Guru melakukan apersepsi terkait materi sebelumnya dan menyajikan pertanyaan pemantik (5 Menit).
                4. Guru menjelaskan kompetensi dan tujuan pembelajaran yang akan dicapai pada hari ini (5 Menit).`)}
              </td>
            </tr>
            <tr>
              <td style="border:1px solid black; padding:8px; text-align:center; vertical-align:top; font-size:10pt;">2</td>
              <td style="border:1px solid black; padding:8px; font-weight:bold; vertical-align:top; font-size:10pt; color:#5A5A40;">Kegiatan Inti (75 Menit)</td>
              <td style="border:1px solid black; padding:8px; vertical-align:top; font-size:10pt; text-align:justify;">
                ${renderActivityTextHtml(`1. Guru menyampaikan penjelasan ringkas/pengantar mengenai lingkup materi menggunakan alat peraga atau slide presentasi (15 Menit).
                2. Guru membagi siswa ke dalam beberapa kelompok diskusi beranggotakan 4-5 orang secara objektif (5 Menit).
                3. Setiap kelompok berdiskusi secara kritis memecahkan masalah kontekstual yang telah disediakan di dalam LKPD (30 Menit).
                4. Guru melakukan bimbingan dan scaffolding aktif kepada kelompok-kelompok yang membutuhkan arahan tambahan (10 Menit).
                5. Perwakilan kelompok mempresentasikan hasil diskusinya di depan kelas secara santun, dilanjutkan sesi tanya jawab antarkelompok (15 Menit).`)}
              </td>
            </tr>
            <tr>
              <td style="border:1px solid black; padding:8px; text-align:center; vertical-align:top; font-size:10pt;">3</td>
              <td style="border:1px solid black; padding:8px; font-weight:bold; vertical-align:top; font-size:10pt; color:#5A5A40;">Penutup (10 Menit)</td>
              <td style="border:1px solid black; padding:8px; vertical-align:top; font-size:10pt; text-align:justify;">
                ${renderActivityTextHtml(`1. Guru bersama-sama siswa mendiskusikan refleksi atas kemajuan pembelajaran hari ini (4 Menit).
                2. Guru membimbing siswa dalam merangkum dan menyimpulkan poin-poin materi esensial secara mendalam (4 Menit).
                3. Guru menyampaikan rubrik penugasan mandiri dan materi untuk sesi pertemuan berikutnya, dilanjutkan doa penutup (2 Menit).`)}
              </td>
            </tr>
          </tbody>
        </table>
      `;
    }

    return `
      <table style="width:100%; border-collapse:collapse; margin-top:10px; margin-bottom:15px; border:1px solid black; table-layout:auto;">
        <thead>
          <tr style="background-color:#F5F5F0;">
            <th style="border:1px solid black; padding:8px; width:8%; text-align:center; font-weight:bold; font-size:10.5pt;">No.</th>
            <th style="border:1px solid black; padding:8px; width:22%; font-weight:bold; font-size:10.5pt; text-align:left;">Kegiatan / Fase</th>
            <th style="border:1px solid black; padding:8px; font-weight:bold; font-size:10.5pt; text-align:left;">Rincian Aktivitas Pembelajaran</th>
          </tr>
        </thead>
        <tbody>
          ${steps.map((s, i) => `
            <tr>
              <td style="border:1px solid black; padding:8px; text-align:center; vertical-align:top; font-size:10pt;">${i+1}</td>
              <td style="border:1px solid black; padding:8px; font-weight:bold; vertical-align:top; font-size:10pt; color:#5A5A40;">${s.phase}</td>
              <td style="border:1px solid black; padding:8px; vertical-align:top; font-size:10pt; text-align:justify;">${renderActivityTextHtml(s.activity || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  };

  const handleDownloadModulDoc = (modulToDownload: ModulAjar) => {
    if (!modulToDownload) return;
    
    // Per pertemuan jika ada meetingActivities, jika tidak kita fallback ke single
    const meetings = modulToDownload.meetingActivities?.length ? modulToDownload.meetingActivities : [{
       session: 1,
       activityTitle: modulToDownload.title || "Semua Sesi",
       steps: modulToDownload.steps || []
    }];

    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Modul Ajar - ${modulToDownload.title}</title>
        <style>
          body { font-family: 'Times New Roman', serif; line-height: 1.4; color: #000; padding: 20px; font-size: 11pt; }
          h1 { text-align: center; font-size: 16pt; text-transform: uppercase; margin-bottom: 5px; font-weight: bold; }
          h2 { text-align: center; font-size: 14pt; margin-top: 0; margin-bottom: 20px; font-weight: bold; }
          .section-title { font-weight: bold; font-size: 12pt; border-bottom: 1.5px solid #000; margin-top: 20px; margin-bottom: 10px; text-transform: uppercase; }
          
          /* Table Styles */
          table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 10px; table-layout: fixed; }
          th, td { border: 1px solid #000; padding: 5px; text-align: left; font-size: 9pt; word-wrap: break-word; }
          th { background-color: #f2f2e6; font-weight: bold; text-align: center; }
          
          /* Special Landscape Table */
          @page { size: landscape; }
          .table-landscape { width: 100%; page-break-inside: avoid; }
          
          .info-table { border: none !important; }
          .info-table td { border: none !important; padding: 3px; vertical-align: top; font-size: 11pt; }
          .footer-table { width: 100%; margin-top: 40px; font-size: 11pt; border: none; }
          .footer-table td { border: none; }
          .page-break { page-break-before: always; }
          ul, ol { margin-top: 5px; margin-bottom: 10px; padding-left: 20px; }
          li { margin-bottom: 3px; font-size: 10pt; }
        </style>
      </head>
      <body><div class="WordSection1">
        ${meetings.map((ma, index) => `
          ${index > 0 ? '<br clear="all" class="page-break" />' : ''}
          <h1>MODUL AJAR (RPP)</h1>
          <h2>${modulToDownload.title} - Pertemuan ${ma.session}</h2>
          
          <table class='info-table'>
            <tr><td width="20%"><b>Nama Sekolah</b></td><td width="80%">: ${schoolName || '................................'}</td></tr>
            <tr><td><b>Mata Pelajaran</b></td><td>: ${subject || '................................'}</td></tr>
            <tr><td><b>Fase / Kelas</b></td><td>: ${phase} / ${modulToDownload.targetStudents}</td></tr>
            <tr><td><b>Model Belajar</b></td><td>: ${modulToDownload.model}</td></tr>
            <tr><td><b>Topik / Aktivitas</b></td><td>: ${ma.activityTitle || modulToDownload.title}</td></tr>
            <tr><td><b>Alokasi Waktu</b></td><td>: ${modulToDownload.duration}</td></tr>
          </table>

          <div class='section-title'>I. INFORMASI UMUM</div>
          <p><b>Dimensi Profil Lulusan:</b></p>
          <ul>${modulToDownload.ppp?.map(p => `<li>${p}</li>`).join('') || ''}</ul>
          <p><b>Sarana dan Prasarana:</b></p>
          <ul>${modulToDownload.media?.map(m => `<li>${m}</li>`).join('') || ''}</ul>

          <div class='section-title'>II. KOMPONEN INTI</div>
          <p><b>Tujuan Pembelajaran:</b></p>
          <div>${modulToDownload.tpStatement?.split('\n').filter(s => s.trim()).map(s => `<p>• ${s.replace(/^[0-9.-]+\s*/, '')}</p>`).join('') || ''}</div>
          <p><b>Pemahaman Bermakna:</b></p>
          <p><i>"${modulToDownload.meaningfulUnderstanding || ''}"</i></p>
          <p><b>Pertanyaan Pemantik:</b></p>
          <ul>${modulToDownload.triggerQuestions?.map(q => `<li>${q}</li>`).join('') || ''}</ul>

          <div class='section-title'>III. KEGIATAN PEMBELAJARAN</div>
          ${ma.steps && ma.steps.length > 0 ? `
            <table>
              <thead>
                <tr>
                  <th style="width:10%;">No.</th>
                  <th style="width:25%;">Fase</th>
                  <th style="width:65%;">Aktivitas</th>
                </tr>
              </thead>
              <tbody>
                ${ma.steps.map((s, i) => `
                  <tr>
                    <td style="text-align:center;">${i+1}</td>
                    <td style="font-weight:bold;">${s.phase}</td>
                    <td>${renderActivityTextHtml(s.activity || '')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p><i>Kegiatan pembelajaran belum tersedia.</i></p>'}

          <div class='section-title'>IV. ASESMEN & DIFERENSIASI</div>
          <p><b>Rencana Asesmen:</b> ${modulToDownload.assessment || ''}</p>
          <p><b>Strategi Diferensiasi:</b> ${modulToDownload.differentiation || ''}</p>
          
          <div class='section-title'>V. RUBRIK PENILAIAN</div>
          ${modulToDownload.rubrics ? `<div style="margin-top:10px;">${modulToDownload.rubrics}</div>` : '<p><i>Rubrik belum tersedia.</i></p>'}


          <table class="footer-table" style="page-break-inside: avoid;">
            <tr>
              <td width="50%" align="center">
                Mengetahui,<br>Kepala Sekolah<br><br><br><br><br>
                <b><u>${principalName || '................................'}</u></b><br>
                NIP. ................................
              </td>
              <td width="50%" align="center">
                ${new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}<br>Guru Mata Pelajaran<br><br><br><br><br>
                <b><u>${teacherName || '................................'}</u></b><br>
                NIP. ................................
              </td>
            </tr>
          </table>
        `).join('')}

        ${modulToDownload.lampiran || modulToDownload.soal || modulToDownload.materi || modulToDownload.lkpd ? '<br clear="all" style="page-break-before:always" /><h1>LAMPIRAN DAN MATERI PENDUKUNG</h1>' : ''}
        ${modulToDownload.lampiran ? `<h2>Lampiran</h2><div style="white-space: pre-wrap;">${modulToDownload.lampiran}</div><hr/>` : ''}
        ${modulToDownload.soal ? `<h2>Soal Evaluasi</h2><div style="white-space: pre-wrap;">${modulToDownload.soal}</div><hr/>` : ''}
        ${modulToDownload.materi ? `<h2>Materi Ajar</h2><div style="white-space: pre-wrap;">${modulToDownload.materi}</div><hr/>` : ''}
        ${modulToDownload.lkpd ? `<h2>Lembar Kerja Peserta Didik (LKPD)</h2><div style="white-space: pre-wrap;">${addIdentityToLKPD(modulToDownload.lkpd, modulToDownload.title, subject)}</div><hr/>` : ''}

      </div></body>
      </html>
    `;
    const sanitizedFileName = `Modul_Ajar_${(modulToDownload.title || 'Modul').replace(/[^a-zA-Z0-9]/g, '_')}.doc`;
    downloadFile(htmlContent, sanitizedFileName, 'application/msword;charset=utf-8');
  };

  const handleDownloadLampiranLengkapDoc = (modulToDownload: ModulAjar) => {
    if (!modulToDownload) return;

    const meetings = modulToDownload.meetingActivities?.length ? modulToDownload.meetingActivities : [{
       session: 1,
       activityTitle: modulToDownload.title || "Semua Sesi",
       steps: modulToDownload.steps || []
    }];

    const maxSession = meetings.length;

    const htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Lampiran Lengkap - ${modulToDownload.title}</title>
        <style>
          body { font-family: 'Times New Roman', Times, serif; line-height: 1.5; color: black; padding: 20px; }
          h1 { text-align: center; font-size: 18pt; text-transform: uppercase; margin-bottom: 5px; font-weight: bold; }
          h2 { text-align: center; font-size: 14pt; margin-top: 20px; margin-bottom: 20px; font-weight: bold; border-bottom: 2px solid #5A5A40; padding-bottom: 5px; }
          h3 { font-size: 12pt; font-weight: bold; margin-top: 25px; margin-bottom: 10px; text-transform: uppercase; color: #5A5A40; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
          h4 { font-size: 11pt; font-weight: bold; margin-top: 15px; margin-bottom: 5px; }
          p { margin-bottom: 8px; font-size: 11pt; }
          .cover { text-align: center; margin-top: 50px; margin-bottom: 80px; }
          .cover-title { font-size: 20pt; font-weight: bold; text-transform: uppercase; margin-bottom: 10px; }
          .cover-subtitle { font-size: 14pt; font-style: italic; margin-bottom: 40px; }
          .info-table { width: 100%; border-collapse: collapse; margin: 30px auto; }
          .info-table td { padding: 6px; vertical-align: top; font-size: 11pt; border: none; }
          .section-block { margin-bottom: 35px; padding: 15px; border: 1px solid #e1e1d0; background-color: #fbfbf8; border-radius: 6px; }
          .page-break { page-break-before: always; clear: both; }
          
          /* Professional Table Styling */
          table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 10px; table-layout: fixed; }
          th, td { border: 1px solid #000; padding: 4px; text-align: left; font-size: 9pt; word-wrap: break-word; }
          th { background-color: #f2f2e6; font-weight: bold; text-align: center; }
          
          li { margin-bottom: 3px; font-size: 10pt; }
          
          .footer-table { width: 100%; margin-top: 20px; font-size: 10pt; border: none; }
          .footer-table td { border: none; }
        </style>
      </head>
      <body><div class="WordSection1">
        <!-- COVER PAGE -->
        <div class="cover">
          <br><br>
          <div class="cover-title">LAMPIRAN & BAHAN AJAR LENGKAP</div>
          <div class="cover-subtitle">Penyusunan Kurikulum Merdeka Terintegrasi Smart AI</div>
          <br><br>
          
          <table class="info-table" style="max-width: 600px; margin: 0 auto; text-align: left;">
            <tr><td width="200"><b>Nama Sekolah</b></td><td>: ${schoolName || '................................'}</td></tr>
            <tr><td><b>Mata Pelajaran</b></td><td>: ${subject || '................................'}</td></tr>
            <tr><td><b>Fase / Kelas</b></td><td>: ${phase} / ${modulToDownload.targetStudents}</td></tr>
            <tr><td><b>Judul Modul</b></td><td>: ${modulToDownload.title}</td></tr>
            <tr><td><b>Alokasi Waktu</b></td><td>: ${modulToDownload.duration}</td></tr>
            <tr><td><b>Model Belajar</b></td><td>: ${modulToDownload.model}</td></tr>
          </table>
          
          <br><br><br><br>
          <div style="font-size: 11pt; color: #555;">Dibuat secara profesional menggunakan modul "Pembelajaran Mendalam" (Deep Learning)</div>
        </div>

        <div class="page-break"></div>
        <div class="WordSection2">
          ${meetings.map((ma, idx) => `
            <div class="section-block">
              <h3>MODUL PERTEMUAN ${ma.session}: ${ma.activityTitle}</h3>
              ${ma.steps?.length ? `
                <table style="width:100%; border-collapse:collapse; margin-top:10px; table-layout:fixed;">
                  <thead>
                    <tr style="background-color:#f2f2e6;">
                      <th style="border:1px solid #000; padding:4px; width:10%">Fase</th>
                      <th style="border:1px solid #000; padding:4px;">Aktivitas</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${ma.steps.map(s => `
                      <tr>
                        <td style="border:1px solid #000; padding:4px; font-weight:bold;">${s.phase}</td>
                        <td style="border:1px solid #000; padding:4px;">${renderActivityTextHtml(s.activity || '')}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              ` : ''}

              <!-- SECTION E: DAFTAR NILAI HARIAN -->
              <h3>E. DAFTAR NILAI HARIAN / FORMATIF</h3>
              <table style="width:100%; border-collapse:collapse; margin-top:10px; table-layout:fixed;">
                <thead>
                  <tr style="background-color:#f2f2e6;">
                    <th style="border:1px solid #000; padding:4px; width:5%; text-align:center;">No</th>
                    <th style="border:1px solid #000; padding:4px; width:25%;">Nama Siswa</th>
                    <th style="border:1px solid #000; padding:4px; width:8%; text-align:center;">L/P</th>
                    <th style="border:1px solid #000; padding:4px; width:25%; text-align:center;">KKTP</th>
                    <th style="border:1px solid #000; padding:4px; width:12%; text-align:center;">Nilai</th>
                    <th style="border:1px solid #000; padding:4px; width:25%;">Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  ${Array.from({length: 15}).map((_, i) => `
                    <tr>
                      <td style="border:1px solid #000; padding:4px; text-align:center; height:25px;">${i+1}</td>
                      <td style="border:1px solid #000; padding:4px;"></td>
                      <td style="border:1px solid #000; padding:4px;"></td>
                      <td style="border:1px solid #000; padding:4px;"></td>
                      <td style="border:1px solid #000; padding:4px;"></td>
                      <td style="border:1px solid #000; padding:4px;"></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>

              <!-- SECTION F: RUBRIK PENILAIAN -->
              <h3>F. RUBRIK PENILAIAN AKTIVITAS</h3>
              <table style="width:100%; border-collapse:collapse; margin-top:10px; table-layout:fixed;">
                <thead>
                  <tr style="background-color:#f2f2e6;">
                    <th style="border:1px solid #000; padding:4px; width:20%;">Aspek</th>
                    <th style="border:1px solid #000; padding:4px; width:20%;">Sangat Baik (4)</th>
                    <th style="border:1px solid #000; padding:4px; width:20%;">Baik (3)</th>
                    <th style="border:1px solid #000; padding:4px; width:20%;">Cukup (2)</th>
                    <th style="border:1px solid #000; padding:4px; width:20%;">Perlu Bimbingan (1)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style="border:1px solid #000; padding:4px;">Penguasaan Materi</td>
                    <td style="border:1px solid #000; padding:4px;">Menunjukkan pemahaman konsep secara mendalam dan menyeluruh.</td>
                    <td style="border:1px solid #000; padding:4px;">Menunjukkan pemahaman konsep dengan baik.</td>
                    <td style="border:1px solid #000; padding:4px;">Memahami konsep dasar namun belum menyeluruh.</td>
                    <td style="border:1px solid #000; padding:4px;">Belum memahami konsep dasar.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          `).join('')}
        </div>

        ${meetings.map((ma, idx) => {
          const currentSession = ma.session;
          
          const sessionMateri = extractContentForMeeting(modulToDownload.materi, currentSession, maxSession);
          const sessionLkpd = extractContentForMeeting(modulToDownload.lkpd, currentSession, maxSession);
          const sessionSoal = extractContentForMeeting(modulToDownload.soal, currentSession, maxSession);
          const sessionLampiran = extractContentForMeeting(modulToDownload.lampiran, currentSession, maxSession);

          const hasMateri = !!sessionMateri || (idx === 0 && !!modulToDownload.materi);
          const hasLkpd = !!sessionLkpd || (idx === 0 && !!modulToDownload.lkpd);
          const hasSoal = !!sessionSoal || !!modulToDownload.soal; // If any questions/soal are available, always make sure we place them!
          const hasLampiran = !!sessionLampiran || (idx === 0 && !!modulToDownload.lampiran);
          
          return `
            <br clear="all" style="page-break-before:always" />
            <div style="border-bottom: 3px double #5A5A40; padding-bottom: 10px; margin-bottom: 25px;">
               <h1>PERTEMUAN KE-${currentSession}</h1>
               <p style="text-align: center; font-style: italic; font-size: 12pt; margin-top: 5px;">
                 Topik / Aktivitas: <b>${ma.activityTitle || modulToDownload.title}</b>
               </p>
            </div>

            <!-- SECTION A: MATERI AJAR -->
            ${hasMateri ? `
              <div class="section-block">
                <h3>A. BAHAN AJAR / MATERI PELAJARAN</h3>
                <div>${sessionMateri || (idx === 0 ? modulToDownload.materi : '') || '<p style="color:#777;">Bahan Ajar sedang disiapkan.</p>'}</div>
              </div>
            ` : ''}

            <!-- SECTION B: LEMBAR KERJA PESERTA DIDIK (LKPD) -->
            ${hasLkpd ? `
              <div class="section-block">
                <h3>B. LEMBAR KERJA PESERTA DIDIK (LKPD)</h3>
                <div>${addIdentityToLKPD(sessionLkpd || (idx === 0 ? modulToDownload.lkpd : ''), ma.activityTitle || modulToDownload.title, subject) || '<p style="color:#777;">LKPD sedang disiapkan.</p>'}</div>
              </div>
            ` : ''}

            <!-- SECTION C: ASESMEN & SOAL EVALUASI -->
            ${hasSoal ? `
              <div class="section-block">
                <h3>C. INSTRUMEN SOAL EVALUASI / ASESMEN</h3>
                <div>${sessionSoal || (idx === maxSession - 1 || maxSession === 1 ? modulToDownload.soal : '') || (idx === 0 ? modulToDownload.soal : '') || '<p style="color:#777;">Soal Evaluasi sedang disiapkan.</p>'}</div>
              </div>
            ` : ''}

            <!-- SECTION D: RUBRIK PENILAIAN & LAMPIRAN LAIN -->
            ${hasLampiran ? `
              <div class="section-block">
                <h3>D. RUBRIK PENILAIAN, REFLEKSI GURU & SISWA</h3>
                <div>${sessionLampiran || (idx === 0 ? modulToDownload.lampiran : '') || '<p style="color:#777;">Rubrik rubrik sedang disiapkan.</p>'}</div>
              </div>
            ` : ''}

            <!-- SECTION E: DAFTAR NILAI HARIAN -->
            <div class="section-block">
              <h3>E. DAFTAR NILAI HARIAN / FORMATIF</h3>
              <table style="width:100%; border-collapse:collapse; margin-top:10px; table-layout:fixed;">
                <thead>
                  <tr>
                    <th style="width:5%; border:1px solid #000; padding:5px; text-align:center;">No</th>
                    <th style="width:25%; border:1px solid #000; padding:5px;">Nama Siswa</th>
                    <th style="width:8%; border:1px solid #000; padding:5px; text-align:center;">L/P</th>
                    <th style="width:25%; border:1px solid #000; padding:5px; text-align:center;">KKTP</th>
                    <th style="width:12%; border:1px solid #000; padding:5px; text-align:center;">Nilai</th>
                    <th style="width:25%; border:1px solid #000; padding:5px;">Keterangan</th>
                  </tr>
                </thead>
                <tbody>
                  ${Array.from({length: 20}).map((_, i) => `
                    <tr>
                      <td style="border:1px solid #000; padding:5px; text-align:center; height:25px;">${i+1}</td>
                      <td style="border:1px solid #000; padding:5px;"></td>
                      <td style="border:1px solid #000; padding:5px;"></td>
                      <td style="border:1px solid #000; padding:5px;"></td>
                      <td style="border:1px solid #000; padding:5px;"></td>
                      <td style="border:1px solid #000; padding:5px;"></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `;
        }).join('')}

        <!-- SIGNATURES BLOCK AT THE END OF ALL MEETINGS -->
        <br><br>
        <table class="footer-table" style="page-break-inside: avoid;">
          <tr>
            <td width="50%" align="center">
              Mengetahui,<br>Kepala Sekolah<br><br><br><br><br>
              <b>${principalName || '................................'}</b><br>
              NIP. ................................
            </td>
            <td width="50%" align="center">
              ${new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}<br>Guru Mata Pelajaran<br><br><br><br><br>
              <b>${teacherName || '................................'}</b><br>
              NIP. ................................
            </td>
          </tr>
        </table>

      </div></body>
      </html>
    `;
    const sanitizedFileName = `Lampiran_Lengkap_MperPertemuan_${(modulToDownload.title || 'Modul').replace(/[^a-zA-Z0-9]/g, '_')}.doc`;
    downloadFile(htmlContent, sanitizedFileName, 'application/msword;charset=utf-8');
  };

  const handleDownloadLengkap = () => {
    if (!result) return;
    
    let htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Dokumen Lengkap Kurikulum - Fase ${phase}</title>
        <style>
          body { font-family: 'Times New Roman', Times, serif; padding: 20px; font-size: 11pt; color: black; line-height: 1.5; }
          h1 { text-align: center; text-transform: uppercase; margin-bottom: 5px; font-size: 16pt; }
          h2 { text-align: center; margin-top: 0; margin-bottom: 20px; font-size: 14pt; }
          h3 { background-color: #eee; padding: 5px; margin-top: 25px; border: 1px solid #000; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; table-layout: fixed; }
          th, td { border: 1px solid black; padding: 8px; text-align: left; vertical-align: top; word-wrap: break-word; font-size: 11pt; }
          th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
          .header-info { margin-bottom: 20px; }
          .footer-table { width: 100%; margin-top: 50px; font-size: 11pt; border: none; }
          .footer-table td { border: none; }
          .rationale-box { margin-bottom: 20px; padding: 10px; border: 1px solid #ccc; background-color: #f9f9f9; }
          .page-break { page-break-before: always; clear: both; mt-10; }
          .section-title { font-weight: bold; font-size: 12pt; border-bottom: 1px solid black; margin-top: 20px; margin-bottom: 10px; text-transform: uppercase; }
          .info-table td { padding: 3px; border: none; }
          .step-box { margin-bottom: 10px; padding: 10px; border: 1px solid #ccc; background-color: #fcfcfc; }
          ul { margin-top: 5px; padding-left: 20px; }
          li { margin-bottom: 3px; }
        </style>
      </head>
      <body><div class="WordSection1">
    `;

    htmlContent += `
        <div style="text-align: center; margin-bottom: 50px; margin-top: 100px;">
          <h1 style="font-size: 24pt;">DOKUMEN KURIKULUM LENGKAP</h1>
          <h2 style="font-size: 18pt;">FASE ${phase}</h2>
          <br><br>
          <p style="font-size: 14pt;"><b>Mata Pelajaran:</b> ${subject || '................................'}</p>
          <p style="font-size: 14pt;"><b>Sekolah:</b> ${schoolName || '................................'}</p>
          <p style="font-size: 14pt;"><b>Penyusun:</b> ${teacherName || '................................'}</p>
        </div>
        <br clear="all" style="page-break-before:always" />

        <h1>PEMETAAN TUJUAN PEMBELAJARAN</h1>
        <h2>Fase ${phase}</h2>
        <div class="header-info">
          <p><b>Sekolah:</b> ${schoolName || '................................'}</p>
          <p><b>Mata Pelajaran:</b> ${subject || '................................'}</p>
        </div>
    `;

    [...(result.classes || [])].sort((a,b) => parseInt(a)-parseInt(b)).forEach(classId => {
      const className = CLASSES.find(c => c.id === classId)?.name || `Kelas ${classId}`;
      const cp = result.cpPerClass?.[classId] || "";
      const tps = result.tujuanPembelajaran?.filter(tp => tp.classLevel === classId) || [];
      htmlContent += `
        <h3>${className}</h3>
        <p><b>Ringkasan CP:</b> ${cp}</p>
        <table>
          <thead>
            <tr>
              <th style="width: 50%">Tujuan Pembelajaran</th>
              <th style="width: 50%">KKTP (Kriteria)</th>
            </tr>
          </thead>
          <tbody>
            ${tps.map(tp => `
              <tr>
                <td>${tp.statement}</td>
                <td>${tp.kktp?.map(k => renderKKTPWithBloomBadgeHtml(k)).join('') || ''}</td>
              </tr>
            `).join('')}
            ${tps.length === 0 ? '<tr><td colspan="2" style="text-align:center">Data tidak tersedia</td></tr>' : ''}
          </tbody>
        </table>
      `;
    });

    if (atp) {
      htmlContent += `
        <br clear="all" style="page-break-before:always" />
        <h1>ALUR TUJUAN PEMBELAJARAN (ATP)</h1>
        <h2>Fase ${atp.phase}</h2>
        
        <div class="header-info">
          <p><b>Sekolah:</b> ${schoolName || '................................'}</p>
          <p><b>Mata Pelajaran:</b> ${subject || '................................'}</p>
          <p><b>Penyusun:</b> ${teacherName || '................................'}</p>
        </div>

        <div class="rationale-box">
          <p><b>Rasionalisasi:</b></p>
          <p>${atp.rationale}</p>
        </div>
      `;

      const classesInAtp = Array.from(new Set(atp.items.map(i => i.classLevel))).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
      classesInAtp.forEach(classLevel => {
        const classItems = atp.items.filter(item => item.classLevel === classLevel).sort((a,b) => a.flow - b.flow);
        htmlContent += `
        <h2 style="text-align: left; margin-top: 30px; font-size: 12pt; text-transform: uppercase;">Tujuan Pembelajaran Kelas ${classLevel}</h2>
        <table>
          <thead>
            <tr>
              <th style="width: 5%">No</th>
              <th style="width: 15%">Capaian Pembelajaran (CP)</th>
              <th style="width: 15%">Tujuan Pembelajaran (TP)</th>
              <th style="width: 15%">Indikator Ketercapaian (KKTP)</th>
              <th style="width: 10%">Materi</th>
              <th style="width: 5%">JP / Pertemuan</th>
              <th style="width: 10%">Asesmen</th>
              <th style="width: 15%">Sumber Belajar & Dimensi Profil Lulusan</th>
            </tr>
          </thead>
          <tbody>
            ${classItems.map((item, index) => `
              <tr>
                <td align="center">${index + 1}</td>
                <td>${item.cp}</td>
                <td>${item.tpStatement}</td>
                <td>
                  ${item.kktp?.map(k => renderKKTPWithBloomBadgeHtml(k)).join('') || ''}
                </td>
                <td>${item.content}</td>
                <td align="center">${item.jp} JP<br>(${item.numberOfMeetings} Perte.)</td>
                <td>${item.assessment}</td>
                <td>
                  <b>Sumber:</b><br>${item.resources?.join(', ') || ''}<br><br>
                  <b>Dimensi Profil Lulusan:</b><br>${item.p3?.join(', ') || ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        `;
      });
    }

    if (atp) {
      const classesInAtp = Array.from(new Set(atp.items.map(i => i.classLevel))).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
      
      // Prota
      htmlContent += `
        <br clear="all" style="page-break-before:always" />
        <h1>PROGRAM TAHUNAN (PROTA)</h1>
        <h2>Fase ${atp.phase}</h2>
      `;
      classesInAtp.forEach(classLevel => {
         const items = atp.items.filter(i => i.classLevel === classLevel).sort((a,b) => a.flow - b.flow);
         const sem1 = items.filter(i => i.semester === 1);
         const sem2 = items.filter(i => i.semester === 2);
         
         htmlContent += `
            <h3 style="background-color:#eee; border:1px solid #000; font-size: 13pt; margin-top:20px; padding: 5px;">Kelas ${classLevel}</h3>
            <table>
               <thead>
                  <tr><th style="width:10%">Semester</th><th style="width:70%">Tujuan Pembelajaran</th><th style="width:20%">Alokasi Waktu</th></tr>
               </thead>
               <tbody>
                  <tr>
                     <td rowspan="${Math.max(sem1.length, 1)}" align="center"><b>I (Ganjil)</b></td>
                     ${sem1.length > 0 ? `<td>${sem1[0].tpStatement}</td><td align="center">${sem1[0].jp} JP</td>` : '<td colspan="2">Belum ada data</td>'}
                  </tr>
                  ${sem1.slice(1).map(item => `<tr><td>${item.tpStatement}</td><td align="center">${item.jp} JP</td></tr>`).join('')}
                  <tr>
                     <td rowspan="${Math.max(sem2.length, 1)}" align="center"><b>II (Genap)</b></td>
                     ${sem2.length > 0 ? `<td>${sem2[0].tpStatement}</td><td align="center">${sem2[0].jp} JP</td>` : '<td colspan="2">Belum ada data</td>'}
                  </tr>
                  ${sem2.slice(1).map(item => `<tr><td>${item.tpStatement}</td><td align="center">${item.jp} JP</td></tr>`).join('')}
               </tbody>
            </table>
         `;
      });
      
      // Prosem
      htmlContent += `
        <br clear="all" style="page-break-before:always" />
        <h1>PROGRAM SEMESTER (PROSEM)</h1>
        <h2>Fase ${atp.phase}</h2>
      `;
      classesInAtp.forEach(classLevel => {
         const items = atp.items.filter(i => i.classLevel === classLevel).sort((a,b) => a.flow - b.flow);
         const distItems = getCorrectProsemWeeks(items, parseInt(jpPerWeek) || 3, parseInt(meetingsPerWeek) || 1);
         
         htmlContent += `
            <h3 style="background-color:#eee; border:1px solid #000; font-size: 13pt; margin-top:20px; padding: 5px;">Kelas ${classLevel}</h3>
            <table>
               <thead>
                  <tr><th style="width:5%">No</th><th style="width:55%">Capaian / Tujuan Pembelajaran</th><th style="width:10%">JP</th><th style="width:30%">Alokasi Waktu (Minggu Efektif)</th></tr>
               </thead>
               <tbody>
                  ${distItems.map((di, idx) => {
                     const sem = di.semester;
                     return `
                        <tr>
                           <td align="center">${idx + 1}</td>
                           <td>${di.tpStatement}</td>
                           <td align="center">${di.jp}</td>
                           <td align="center">Semester ${sem}<br/>Minggu ke-${di.startWeek} ${di.endWeek > di.startWeek ? `s.d ${di.endWeek}` : ''}</td>
                        </tr>
                     `;
                  }).join('')}
               </tbody>
            </table>
         `;
      });
      
      // Modules mapping
      const savedModuleTps = atp.items.filter(item => modules[item.tpId]);
      if (savedModuleTps.length > 0) {
         htmlContent += `
            <br clear="all" style="page-break-before:always" />
            <h1>LAMPIRAN MODUL AJAR (RPP)</h1>
            <h2>Berdasarkan ATP Fase ${atp.phase}</h2>
         `;
         savedModuleTps.forEach(item => {
            const mod = modules[item.tpId];
            
            // Per pertemuan jika ada meetingActivities, jika tidak kita fallback ke single
            const meetings = mod.meetingActivities?.length ? mod.meetingActivities : [{
               session: 1,
               activityTitle: "Semua Sesi",
               steps: mod.steps || []
            }];

            meetings.forEach((ma, idx) => {
               const maxSession = meetings.length;
               const currentSession = ma.session || idx + 1;
               
               const sessionMateri = extractContentForMeeting(mod.materi, currentSession, maxSession);
               const sessionLkpd = extractContentForMeeting(mod.lkpd, currentSession, maxSession);
               const sessionSoal = extractContentForMeeting(mod.soal, currentSession, maxSession);
               const sessionLampiran = extractContentForMeeting(mod.lampiran, currentSession, maxSession);

               const hasMateri = !!sessionMateri || (idx === 0 && !!mod.materi);
               const hasLkpd = !!sessionLkpd || (idx === 0 && !!mod.lkpd);
               const hasSoal = !!sessionSoal || !!mod.soal; // If any questions/soal are available, always make sure we place them!
               const hasLampiran = !!sessionLampiran || (idx === 0 && !!mod.lampiran);

               htmlContent += `
               <br clear="all" style="page-break-before:always" />
               <h1>MODUL AJAR (RPP)</h1>
               <h2>${mod.title} - Pertemuan ${ma.session}</h2>
               
               <table class='info-table' style="width: auto; border: none; margin-bottom: 20px;">
                 <tr><td width="150" style="border: none;"><b>Nama Sekolah</b></td><td style="border: none;">: ${schoolName || '................................'}</td></tr>
                 <tr><td style="border: none;"><b>Mata Pelajaran</b></td><td style="border: none;">: ${subject || '................................'}</td></tr>
                 <tr><td style="border: none;"><b>Fase / Kelas</b></td><td style="border: none;">: ${phase} / ${mod?.targetStudents || item.classLevel}</td></tr>
                 <tr><td style="border: none;"><b>Model Belajar</b></td><td style="border: none;">: ${mod?.model || '................................'}</td></tr>
                 <tr><td style="border: none;"><b>Alokasi Waktu</b></td><td style="border: none;">: ${item.jp / item.numberOfMeetings} JP (Topik: ${ma.activityTitle})</td></tr>
               </table>

               <div class='section-title'>I. INFORMASI UMUM</div>
               <p><b>Dimensi Profil Lulusan:</b></p>
               <ul>${mod?.ppp?.map(p => `<li>${p}</li>`).join('') || '<li>Beriman, bertakwa kepada Tuhan YME, dan berakhlak mulia</li><li>Berkebinekaan global</li><li>Bergotong royong</li><li>Mandiri</li><li>Bernalar kritis</li><li>Kreatif</li>'}</ul>
               <p><b>Sarana dan Prasarana:</b></p>
               <ul>${mod?.media?.map(x => `<li>${x}</li>`).join('') || '<li>Buku Siswa</li><li>Buku Guru</li><li>Papan Tulis, Spidol, Proyektor, Laptop</li>'}</ul>

               <div class='section-title'>II. KOMPONEN INTI</div>
               <p><b>Tujuan Pembelajaran:</b></p>
               <div><p>• ${item.tpStatement}</p></div>
               <p><b>Kriteria Ketercapaian (KKTP):</b></p>
               <div>${item.kktp?.map(k => renderKKTPWithBloomBadgeHtml(k)).join('') || ''}</div>
               <p><b>Pemahaman Bermakna:</b></p>
               <p><i>"${mod?.meaningfulUnderstanding || 'Siswa dapat memahami dan mengaplikasikan konsep yang diajarkan dalam kehidupan sehari-hari.'}"</i></p>
               <p><b>Pertanyaan Pemantik:</b></p>
               <ul>${mod?.triggerQuestions?.map(q => `<li>${q}</li>`).join('') || '<li>Apa yang kalian ketahui tentang materi ini?</li><li>Mengapa materi ini penting untuk dipelajari?</li>'}</ul>

               <div class='section-title'>III. KEGIATAN PEMBELAJARAN</div>
               ${renderKegiatanPembelajaranTable(ma.steps || [])}
               <div class='section-title'>IV. ASESMEN & DIFERENSIASI</div>
               <p><b>Rencana Asesmen:</b> ${mod?.assessment || item.assessment }</p>
               <p><b>Strategi Diferensiasi:</b> ${mod?.differentiation || 'Diferensiasi proses: Siswa yang kesulitan akan diberikan bimbingan lebih intensif. Diferensiasi produk: Siswa dibebaskan menyajikan hasil karya berupa tulisan, gambar, atau presentasi.'}</p>

               <table class="footer-table" style="page-break-inside: avoid;">
                 <tr>
                   <td width="50%" align="center" style="border: none;">
                     Mengetahui,<br>Kepala Sekolah<br><br><br><br><br>
                     <b>${principalName || '................................'}</b><br>
                     NIP. ................................
                   </td>
                   <td width="50%" align="center" style="border: none;">
                     ${new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}<br>Guru Mata Pelajaran<br><br><br><br><br>
                     <b>${teacherName || '................................'}</b><br>
                     NIP. ................................
                   </td>
                 </tr>
               </table>
               `;

               if (hasMateri || hasLkpd || hasSoal || hasLampiran) {
                  htmlContent += `
                  <br clear="all" style="page-break-before:always" />
                  <div style="border-bottom: 3px double #000; padding-bottom: 10px; margin-bottom: 25px;">
                     <h1>LAMPIRAN PERTEMUAN KE-${currentSession}</h1>
                     <p style="text-align: center; font-style: italic; font-size: 12pt; margin-top: 5px;">
                       Topik / Aktivitas: <b>${ma.activityTitle || mod.title}</b>
                     </p>
                  </div>`;
                  
                  if (hasMateri) {
                     htmlContent += `<h3>A. BAHAN AJAR / MATERI PELAJARAN</h3>
                       <div style="white-space: pre-wrap;">${sessionMateri || (idx === 0 ? mod.materi : '') || '<p style="color:#777;">Bahan Ajar sedang disiapkan.</p>'}</div>`;
                  }
                  if (hasLkpd) {
                     htmlContent += `<h3>B. LEMBAR KERJA PESERTA DIDIK (LKPD)</h3>
                       <div style="white-space: pre-wrap;">${addIdentityToLKPD(sessionLkpd || (idx === 0 ? mod.lkpd : ''), ma.activityTitle || mod.title, subject) || '<p style="color:#777;">LKPD sedang disiapkan.</p>'}</div>`;
                  }
                  if (hasSoal) {
                     htmlContent += `<h3>C. INSTRUMEN SOAL EVALUASI / ASESMEN</h3>
                       <div style="white-space: pre-wrap;">${sessionSoal || (idx === maxSession - 1 || maxSession === 1 ? mod.soal : '') || (idx === 0 ? mod.soal : '') || '<p style="color:#777;">Soal Evaluasi sedang disiapkan.</p>'}</div>`;
                  }
                  if (hasLampiran) {
                     htmlContent += `<h3>D. RUBRIK PENILAIAN, REFLEKSI GURU & SISWA</h3>
                       <div style="white-space: pre-wrap;">${sessionLampiran || (idx === 0 ? mod.lampiran : '') || '<p style="color:#777;">Rubrik rubrik sedang disiapkan.</p>'}</div>`;
                  }
               }
            });
         });
      } else {
         htmlContent += `
           <br clear="all" style="page-break-before:always" />
           <h1>MODUL AJAR (RPP)</h1>
           <p style="text-align: center; margin-top: 50px; font-style: italic;">
             (Tidak ada Modul Ajar yang disertakan karena Anda belum merinci modul apa pun di aplikasi. Silakan kembali ke aplikasi dan buat melalui fitur Generate Semua Modul AI Sekaligus.)
           </p>
         `;
      }
    }

    if (atp && atp.items && atp.items.length > 0) {
      htmlContent += `
        <br clear="all" style="page-break-before:always" />
        <h1>JURNAL MENGAJAR GURU</h1>
        <h2>Fase ${atp.phase}</h2>
        <br/>
        
        <div class="header-info">
          <p><b>Sekolah&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</b> ${schoolName || '................................'}</p>
          <p><b>Mata Pelajaran&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</b> ${subject || '................................'}</p>
          <p><b>Fase/Kelas&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</b> ${atp.phase} / ${selectedClasses.join(', ') || '................................'}</p>
          <p><b>Guru Mata Pelajaran :</b> ${teacherName || '................................'}</p>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width:4%;">No</th>
              <th style="width:12%;">Hari/Tanggal</th>
              <th style="width:6%;">Jam Ke</th>
              <th style="width:7%;">Kelas</th>
              <th style="width:16%;">Topik / Modul</th>
              <th style="width:35%;">Tujuan Pembelajaran & Aktivitas Pokok</th>
              <th style="width:20%;">Keterangan / Kehadiran</th>
            </tr>
          </thead>
          <tbody>
      `;

      let globalCounter = 1;
      atp.items.forEach((item) => {
        const mod = modules[item.tpId];
        if (mod && mod.meetingActivities?.length) {
          mod.meetingActivities.forEach((ma) => {
             htmlContent += `
               <tr>
                 <td align="center">${globalCounter++}</td>
                 <td></td>
                 <td></td>
                 <td>${item.classLevel}</td>
                 <td><b>${ma.activityTitle || mod.title || 'Modul '+globalCounter}</b></td>
                 <td>
                   <b>TP:</b> ${item.tpStatement}<br/><br/>
                   <b>Aktivitas:</b><br/>${ma.steps?.map(s => `- ${s.activity}`).join('<br/>') || ''}
                 </td>
                 <td></td>
               </tr>
             `;
          });
        } else {
          htmlContent += `
            <tr>
              <td align="center">${globalCounter++}</td>
              <td></td>
              <td></td>
              <td>${item.classLevel}</td>
              <td><b>${mod?.title || 'Topik '+globalCounter}</b></td>
              <td><b>TP:</b> ${item.tpStatement}</td>
              <td></td>
            </tr>
          `;
        }
      });

      htmlContent += `
          </tbody>
        </table>
      `;
    }

    htmlContent += `
        <table class="footer-table" style="page-break-inside: avoid;">
          <tr>
            <td width="50%" align="center" style="border: none;">
              Mengetahui,<br>Kepala Sekolah<br><br><br><br><br>
              <b>${principalName || '................................'}</b><br>
              NIP. ................................
            </td>
            <td width="50%" align="center" style="border: none;">
              ${new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}<br>Guru Mata Pelajaran<br><br><br><br><br>
              <b>${teacherName || '................................'}</b><br>
              NIP. ................................
            </td>
          </tr>
        </table>
      </div></body>
      </html>
    `;
    
    const sanitizedFileName = `Dokumen_Lengkap_Fase_${phase}_${(subject || 'Mapel').replace(/[^a-zA-Z0-9]/g, '_')}.doc`;
    downloadFile(htmlContent, sanitizedFileName, 'application/msword;charset=utf-8');
  };

  const handleDownloadLengkapClass = (classId: string) => {
    if (!result) return;
    const className = CLASSES.find(c => c.id === classId)?.name || `Kelas ${classId}`;
    
    let htmlContent = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Dokumen Lengkap Kurikulum Kelas ${classId} - Fase ${phase}</title>
        <style>
          body { font-family: 'Times New Roman', Times, serif; padding: 20px; font-size: 11pt; color: black; line-height: 1.5; }
          h1 { text-align: center; text-transform: uppercase; margin-bottom: 5px; font-size: 16pt; }
          h2 { text-align: center; margin-top: 0; margin-bottom: 20px; font-size: 14pt; }
          h3 { background-color: #eee; padding: 5px; margin-top: 25px; border: 1px solid #000; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; table-layout: fixed; }
          th, td { border: 1px solid black; padding: 8px; text-align: left; vertical-align: top; word-wrap: break-word; font-size: 11pt; }
          th { background-color: #f2f2f2; font-weight: bold; text-align: center; }
          .header-info { margin-bottom: 20px; }
          .footer-table { width: 100%; margin-top: 50px; font-size: 11pt; border: none; }
          .footer-table td { border: none; }
          .rationale-box { margin-bottom: 20px; padding: 10px; border: 1px solid #ccc; background-color: #f9f9f9; }
          .page-break { page-break-before: always; clear: both; mt-10; }
          .section-title { font-weight: bold; font-size: 12pt; border-bottom: 1px solid black; margin-top: 20px; margin-bottom: 10px; text-transform: uppercase; }
          .info-table td { padding: 3px; border: none; }
          .step-box { margin-bottom: 10px; padding: 10px; border: 1px solid #ccc; background-color: #fcfcfc; }
          ul { margin-top: 5px; padding-left: 20px; }
          li { margin-bottom: 3px; }
        </style>
      </head>
      <body><div class="WordSection1">
    `;

    htmlContent += `
        <div style="text-align: center; margin-bottom: 50px; margin-top: 100px;">
          <h1 style="font-size: 24pt;">DOKUMEN KURIKULUM LENGKAP</h1>
          <h2 style="font-size: 18pt;">FASE ${phase} - ${className.toUpperCase()}</h2>
          <br><br>
          <p style="font-size: 14pt;"><b>Mata Pelajaran:</b> ${subject || '................................'}</p>
          <p style="font-size: 14pt;"><b>Sekolah:</b> ${schoolName || '................................'}</p>
          <p style="font-size: 14pt;"><b>Penyusun:</b> ${teacherName || '................................'}</p>
        </div>
        <br clear="all" style="page-break-before:always" />

        <h1>PEMETAAN TUJUAN PEMBELAJARAN</h1>
        <h2>Fase ${phase} - ${className}</h2>
        <div class="header-info">
          <p><b>Sekolah:</b> ${schoolName || '................................'}</p>
          <p><b>Mata Pelajaran:</b> ${subject || '................................'}</p>
        </div>
    `;

    const cp = result.cpPerClass?.[classId] || "";
    const tps = result.tujuanPembelajaran?.filter(tp => tp.classLevel === classId) || [];
    htmlContent += `
      <h3>${className}</h3>
      <p><b>Ringkasan CP:</b> ${cp}</p>
      <table>
        <thead>
          <tr>
            <th style="width: 50%">Tujuan Pembelajaran</th>
            <th style="width: 50%">KKTP (Kriteria)</th>
          </tr>
        </thead>
        <tbody>
          ${tps.map(tp => `
            <tr>
              <td>${tp.statement}</td>
              <td>${tp.kktp?.map(k => renderKKTPWithBloomBadgeHtml(k)).join('') || ''}</td>
            </tr>
          `).join('')}
          ${tps.length === 0 ? '<tr><td colspan="2" style="text-align:center">Data tidak tersedia</td></tr>' : ''}
        </tbody>
      </table>
    `;

    if (atp) {
      htmlContent += `
        <br clear="all" style="page-break-before:always" />
        <h1>ALUR TUJUAN PEMBELAJARAN (ATP)</h1>
        <h2>Fase ${atp.phase} - ${className}</h2>
        
        <div class="header-info">
          <p><b>Sekolah:</b> ${schoolName || '................................'}</p>
          <p><b>Mata Pelajaran:</b> ${subject || '................................'}</p>
          <p><b>Penyusun:</b> ${teacherName || '................................'}</p>
        </div>

        <div class="rationale-box">
          <p><b>Rasionalisasi:</b></p>
          <p>${atp.rationale}</p>
        </div>
      `;

      const classItems = atp.items.filter(item => item.classLevel === classId).sort((a,b) => a.flow - b.flow);
      htmlContent += `
      <h2 style="text-align: left; margin-top: 30px; font-size: 12pt; text-transform: uppercase;">Tujuan Pembelajaran Kelas ${classId}</h2>
      <table>
        <thead>
          <tr>
            <th style="width: 5%">No</th>
            <th style="width: 15%">Capaian Pembelajaran (CP)</th>
            <th style="width: 15%">Tujuan Pembelajaran (TP)</th>
            <th style="width: 15%">Indikator Ketercapaian (KKTP)</th>
            <th style="width: 10%">Materi</th>
            <th style="width: 5%">JP / Pertemuan</th>
            <th style="width: 10%">Asesmen</th>
            <th style="width: 15%">Sumber Belajar & Dimensi Profil Lulusan</th>
          </tr>
        </thead>
        <tbody>
          ${classItems.map((item, index) => `
            <tr>
              <td align="center">${index + 1}</td>
              <td>${item.cp}</td>
              <td>${item.tpStatement}</td>
              <td>
                ${item.kktp?.map(k => renderKKTPWithBloomBadgeHtml(k)).join('') || ''}
              </td>
              <td>${item.content}</td>
              <td align="center">${item.jp} JP<br>(${item.numberOfMeetings} Perte.)</td>
              <td>${item.assessment}</td>
              <td>
                <b>Sumber:</b><br>${item.resources?.join(', ') || ''}<br><br>
                <b>Dimensi Profil Lulusan:</b><br>${item.p3?.join(', ') || ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      `;

      // Prota
      htmlContent += `
        <br clear="all" style="page-break-before:always" />
        <h1>PROGRAM TAHUNAN (PROTA)</h1>
        <h2>Fase ${atp.phase} - ${className}</h2>
      `;
      const items = atp.items.filter(i => i.classLevel === classId).sort((a,b) => a.flow - b.flow);
      const sem1 = items.filter(i => i.semester === 1);
      const sem2 = items.filter(i => i.semester === 2);
      
      htmlContent += `
         <h3 style="background-color:#eee; border:1px solid #000; font-size: 13pt; margin-top:20px; padding: 5px;">Kelas ${classId}</h3>
         <table>
            <thead>
               <tr><th style="width:10%">Semester</th><th style="width:70%">Tujuan Pembelajaran</th><th style="width:20%">Alokasi Waktu</th></tr>
            </thead>
            <tbody>
               <tr>
                  <td rowspan="${Math.max(sem1.length, 1)}" align="center"><b>I (Ganjil)</b></td>
                  ${sem1.length > 0 ? `<td>${sem1[0].tpStatement}</td><td align="center">${sem1[0].jp} JP</td>` : '<td colspan="2">Belum ada data</td>'}
               </tr>
               ${sem1.slice(1).map(item => `<tr><td>${item.tpStatement}</td><td align="center">${item.jp} JP</td></tr>`).join('')}
               <tr>
                  <td rowspan="${Math.max(sem2.length, 1)}" align="center"><b>II (Genap)</b></td>
                  ${sem2.length > 0 ? `<td>${sem2[0].tpStatement}</td><td align="center">${sem2[0].jp} JP</td>` : '<td colspan="2">Belum ada data</td>'}
               </tr>
               ${sem2.slice(1).map(item => `<tr><td>${item.tpStatement}</td><td align="center">${item.jp} JP</td></tr>`).join('')}
            </tbody>
         </table>
      `;

      // Prosem
      htmlContent += `
        <br clear="all" style="page-break-before:always" />
        <h1>PROGRAM SEMESTER (PROSEM)</h1>
        <h2>Fase ${atp.phase} - ${className}</h2>
      `;
      const distItems = getCorrectProsemWeeks(items, parseInt(jpPerWeek) || 3, parseInt(meetingsPerWeek) || 1);
      
      htmlContent += `
         <h3 style="background-color:#eee; border:1px solid #000; font-size: 13pt; margin-top:20px; padding: 5px;">Kelas ${classId}</h3>
         <table>
            <thead>
               <tr><th style="width:5%">No</th><th style="width:55%">Capaian / Tujuan Pembelajaran</th><th style="width:10%">JP</th><th style="width:30%">Alokasi Waktu (Minggu Efektif)</th></tr>
            </thead>
            <tbody>
               ${distItems.map((di, idx) => {
                  const sem = di.semester;
                  return `
                     <tr>
                        <td align="center">${idx + 1}</td>
                        <td>${di.tpStatement}</td>
                        <td align="center">${di.jp}</td>
                        <td align="center">Semester ${sem}<br/>Minggu ke-${di.startWeek} ${di.endWeek > di.startWeek ? `s.d ${di.endWeek}` : ''}</td>
                     </tr>
                  `;
               }).join('')}
            </tbody>
         </table>
      `;

      // Modules mapping
      const savedModuleTps = atp.items.filter(item => item.classLevel === classId && modules[item.tpId]);
      if (savedModuleTps.length > 0) {
         htmlContent += `
            <br clear="all" style="page-break-before:always" />
            <h1>LAMPIRAN MODUL AJAR (RPP)</h1>
            <h2>Berdasarkan ATP Fase ${atp.phase} - ${className}</h2>
         `;
         savedModuleTps.forEach(item => {
            const mod = modules[item.tpId];
            
            const meetings = mod.meetingActivities?.length ? mod.meetingActivities : [{
               session: 1,
               activityTitle: "Semua Sesi",
               steps: mod.steps || []
            }];

            meetings.forEach((ma, idx) => {
               const maxSession = meetings.length;
               const currentSession = ma.session || idx + 1;
               
               const sessionMateri = extractContentForMeeting(mod.materi, currentSession, maxSession);
               const sessionLkpd = extractContentForMeeting(mod.lkpd, currentSession, maxSession);
               const sessionSoal = extractContentForMeeting(mod.soal, currentSession, maxSession);
               const sessionLampiran = extractContentForMeeting(mod.lampiran, currentSession, maxSession);

               const hasMateri = !!sessionMateri || (idx === 0 && !!mod.materi);
               const hasLkpd = !!sessionLkpd || (idx === 0 && !!mod.lkpd);
               const hasSoal = !!sessionSoal || !!mod.soal;
               const hasLampiran = !!sessionLampiran || (idx === 0 && !!mod.lampiran);

               htmlContent += `
               <br clear="all" style="page-break-before:always" />
               <h1>MODUL AJAR (RPP)</h1>
               <h2>${mod.title} - Pertemuan ${ma.session}</h2>
               
               <table class='info-table' style="width: auto; border: none; margin-bottom: 20px;">
                 <tr><td width="150" style="border: none;"><b>Nama Sekolah</b></td><td style="border: none;">: ${schoolName || '................................'}</td></tr>
                 <tr><td style="border: none;"><b>Mata Pelajaran</b></td><td style="border: none;">: ${subject || '................................'}</td></tr>
                 <tr><td style="border: none;"><b>Fase / Kelas</b></td><td style="border: none;">: ${phase} / ${mod?.targetStudents || item.classLevel}</td></tr>
                 <tr><td style="border: none;"><b>Model Belajar</b></td><td style="border: none;">: ${mod?.model || '................................'}</td></tr>
                 <tr><td style="border: none;"><b>Alokasi Waktu</b></td><td style="border: none;">: ${item.jp / item.numberOfMeetings} JP (Topik: ${ma.activityTitle})</td></tr>
               </table>

               <div class='section-title'>I. INFORMASI UMUM</div>
               <p><b>Dimensi Profil Lulusan:</b></p>
               <ul>${mod?.ppp?.map(p => `<li>${p}</li>`).join('') || '<li>Beriman, bertakwa kepada Tuhan YME, dan berakhlak mulia</li><li>Berkebinekaan global</li><li>Bergotong royong</li><li>Mandiri</li><li>Bernalar kritis</li><li>Kreatif</li>'}</ul>
               <p><b>Sarana dan Prasarana:</b></p>
               <ul>${mod?.media?.map(x => `<li>${x}</li>`).join('') || '<li>Buku Siswa</li><li>Buku Guru</li><li>Papan Tulis, Spidol, Proyektor, Laptop</li>'}</ul>

               <div class='section-title'>II. KOMPONEN INTI</div>
               <p><b>Tujuan Pembelajaran:</b></p>
               <div><p>• ${item.tpStatement}</p></div>
               <p><b>Kriteria Ketercapaian (KKTP):</b></p>
               <div>${item.kktp?.map(k => renderKKTPWithBloomBadgeHtml(k)).join('') || ''}</div>
               <p><b>Pemahaman Bermakna:</b></p>
               <p><i>"${mod?.meaningfulUnderstanding || 'Siswa dapat memahami dan mengaplikasikan konsep yang diajarkan dalam kehidupan sehari-hari.'}"</i></p>
               <p><b>Pertanyaan Pemantik:</b></p>
               <ul>${mod?.triggerQuestions?.map(q => `<li>${q}</li>`).join('') || '<li>Apa yang kalian ketahui tentang materi ini?</li><li>Mengapa materi ini penting untuk dipelajari?</li>'}</ul>

               <div class='section-title'>III. KEGIATAN PEMBELAJARAN</div>
               ${renderKegiatanPembelajaranTable(ma.steps || [])}
               <div class='section-title'>IV. ASESMEN & DIFERENSIASI</div>
               <p><b>Rencana Asesmen:</b> ${mod?.assessment || item.assessment }</p>
               <p><b>Strategi Diferensiasi:</b> ${mod?.differentiation || 'Diferensiasi proses: Siswa yang kesulitan akan diberikan bimbingan lebih intensif. Diferensiasi produk: Siswa dibebaskan menyajikan hasil karya berupa tulisan, gambar, atau presentasi.'}</p>

               <table class="footer-table" style="page-break-inside: avoid;">
                 <tr>
                   <td width="50%" align="center" style="border: none;">
                     Mengetahui,<br>Kepala Sekolah<br><br><br><br><br>
                     <b>${principalName || '................................'}</b><br>
                     NIP. ................................
                   </td>
                   <td width="50%" align="center" style="border: none;">
                     ${new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}<br>Guru Mata Pelajaran<br><br><br><br><br>
                     <b>${teacherName || '................................'}</b><br>
                     NIP. ................................
                   </td>
                 </tr>
               </table>
               `;

               if (hasMateri || hasLkpd || hasSoal || hasLampiran) {
                  htmlContent += `
                  <br clear="all" style="page-break-before:always" />
                  <div style="border-bottom: 3px double #000; padding-bottom: 10px; margin-bottom: 25px;">
                     <h1>LAMPIRAN PERTEMUAN KE-${currentSession}</h1>
                     <p style="text-align: center; font-style: italic; font-size: 12pt; margin-top: 5px;">
                       Topik / Aktivitas: <b>${ma.activityTitle || mod.title}</b>
                     </p>
                  </div>`;
                  
                  if (hasMateri) {
                     htmlContent += `<h3>A. BAHAN AJAR / MATERI PELAJARAN</h3>
                       <div style="white-space: pre-wrap;">${sessionMateri || (idx === 0 ? mod.materi : '') || '<p style="color:#777;">Bahan Ajar sedang disiapkan.</p>'}</div>`;
                  }
                  if (hasLkpd) {
                     htmlContent += `<h3>B. LEMBAR KERJA PESERTA DIDIK (LKPD)</h3>
                       <div style="white-space: pre-wrap;">${addIdentityToLKPD(sessionLkpd || (idx === 0 ? mod.lkpd : ''), ma.activityTitle || mod.title, subject) || '<p style="color:#777;">LKPD sedang disiapkan.</p>'}</div>`;
                  }
                  if (hasSoal) {
                     htmlContent += `<h3>C. INSTRUMEN SOAL EVALUASI / ASESMEN</h3>
                       <div style="white-space: pre-wrap;">${sessionSoal || (idx === maxSession - 1 || maxSession === 1 ? mod.soal : '') || (idx === 0 ? mod.soal : '') || '<p style="color:#777;">Soal Evaluasi sedang disiapkan.</p>'}</div>`;
                  }
                  if (hasLampiran) {
                     htmlContent += `<h3>D. RUBRIK PENILAIAN, REFLEKSI GURU & SISWA</h3>
                       <div style="white-space: pre-wrap;">${sessionLampiran || (idx === 0 ? mod.lampiran : '') || '<p style="color:#777;">Rubrik rubrik sedang disiapkan.</p>'}</div>`;
                  }
               }
            });
         });
      }
    }

    if (atp && atp.items && atp.items.length > 0) {
      const classAtpItems = atp.items.filter(i => i.classLevel === classId);
      if (classAtpItems.length > 0) {
        htmlContent += `
          <br clear="all" style="page-break-before:always" />
          <h1>JURNAL MENGAJAR GURU</h1>
          <h2>Fase ${atp.phase} - ${className}</h2>
          <br/>
          
          <div class="header-info">
            <p><b>Sekolah&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</b> ${schoolName || '................................'}</p>
            <p><b>Mata Pelajaran&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</b> ${subject || '................................'}</p>
            <p><b>Fase/Kelas&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</b> ${atp.phase} / ${className}</p>
            <p><b>Guru Mata Pelajaran :</b> ${teacherName || '................................'}</p>
          </div>

          <table>
            <thead>
              <tr>
                <th style="width:4%;">No</th>
                <th style="width:12%;">Hari/Tanggal</th>
                <th style="width:6%;">Jam Ke</th>
                <th style="width:7%;">Kelas</th>
                <th style="width:16%;">Topik / Modul</th>
                <th style="width:35%;">Tujuan Pembelajaran & Aktivitas Pokok</th>
                <th style="width:20%;">Keterangan / Kehadiran</th>
              </tr>
            </thead>
            <tbody>
        `;

        let globalCounter = 1;
        classAtpItems.forEach((item) => {
          const mod = modules[item.tpId];
          if (mod && mod.meetingActivities?.length) {
            mod.meetingActivities.forEach((ma) => {
               htmlContent += `
                 <tr>
                   <td align="center">${globalCounter++}</td>
                   <td></td>
                   <td></td>
                   <td>${item.classLevel}</td>
                   <td><b>${ma.activityTitle || mod.title || 'Modul '+globalCounter}</b></td>
                   <td>
                     <b>TP:</b> ${item.tpStatement}<br/><br/>
                     <b>Aktivitas:</b><br/>${ma.steps?.map(s => `- ${s.activity}`).join('<br/>') || ''}
                   </td>
                   <td></td>
                 </tr>
               `;
            });
          } else {
            htmlContent += `
              <tr>
                <td align="center">${globalCounter++}</td>
                <td></td>
                <td></td>
                <td>${item.classLevel}</td>
                <td><b>${mod?.title || 'Topik '+globalCounter}</b></td>
                <td><b>TP:</b> ${item.tpStatement}</td>
                <td></td>
              </tr>
            `;
          }
        });

        htmlContent += `
            </tbody>
          </table>
        `;
      }
    }

    htmlContent += `
        <table class="footer-table" style="page-break-inside: avoid;">
          <tr>
            <td width="50%" align="center" style="border: none;">
              Mengetahui,<br>Kepala Sekolah<br><br><br><br><br>
              <b>${principalName || '................................'}</b><br>
              NIP. ................................
            </td>
            <td width="50%" align="center" style="border: none;">
              ${new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}<br>Guru Mata Pelajaran<br><br><br><br><br>
              <b>${teacherName || '................................'}</b><br>
              NIP. ................................
            </td>
          </tr>
        </table>
      </div></body>
      </html>
    `;
    
    const sanitizedFileName = `Dokumen_Lengkap_Fase_${phase}_Kelas_${classId}_${(subject || 'Mapel').replace(/[^a-zA-Z0-9]/g, '_')}.doc`;
    downloadFile(htmlContent, sanitizedFileName, 'application/msword;charset=utf-8');
  };

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans selection:bg-[#5A5A40] selection:text-white">
      {/* Header */}
      <header className="border-b border-[#141414]/10 bg-white/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#5A5A40] rounded-xl flex items-center justify-center text-white">
              <BookOpen size={20} />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight">Kurikulum AI</h1>
              <p className="text-[10px] uppercase tracking-widest opacity-50 font-medium">Pemeta CP ke TP Otomatis</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm font-medium opacity-60">
            {user && (
              <>
                <button 
                  onClick={() => setViewMode('create')} 
                  className={`transition-opacity ${viewMode === 'create' ? 'opacity-100 font-bold text-[#5A5A40]' : 'hover:opacity-100'}`}
                >
                  Buat Baru
                </button>
                <button 
                  onClick={() => setViewMode('saved')} 
                  className={`transition-opacity ${viewMode === 'saved' ? 'opacity-100 font-bold text-[#5A5A40]' : 'hover:opacity-100'}`}
                >
                  Riwayat Dokumen
                </button>
                <div className="w-[1px] h-4 bg-[#141414]/20 mx-2" />
              </>
            )}
            <button 
              onClick={() => setShowPanduan(true)} 
              className="hover:opacity-100 transition-opacity"
            >
              Panduan
            </button>
            <button 
              onClick={() => setShowTentang(true)} 
              className="hover:opacity-100 transition-opacity"
            >
              Tentang
            </button>
            {user ? (
              <div className="flex items-center gap-4">
                {user.email === 'jently.f.tamailang@gmail.com' && (
                  <button 
                    onClick={() => setShowAccessManager(true)}
                    className="flex items-center gap-2 text-[#5A5A40] hover:opacity-80 font-bold"
                  >
                    <ShieldCheck size={16} /> Kelola Akses
                  </button>
                )}
                {user && (
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[9px] font-mono text-[#141414]/50 leading-none">{user.email}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F5F5F0] rounded-full border border-[#141414]/5">
                  <div className="w-5 h-5 rounded-full overflow-hidden">
                    <img src={user.photoURL || ''} alt="" referrerPolicy="no-referrer" />
                  </div>
                  <span className="text-[10px] uppercase tracking-wider">{user.displayName?.split(' ')[0]}</span>
                </div>
                <button 
                  onClick={handleLogout}
                  className="p-2 hover:bg-red-50 text-red-600 rounded-lg transition-colors"
                  title="Keluar"
                >
                  <LogOut size={18} />
                </button>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="bg-[#141414] text-white px-6 py-2 rounded-full text-xs font-bold hover:bg-[#5A5A40] transition-all flex items-center gap-2"
              >
                <Users size={14} /> Masuk dengan Google
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 md:py-12">
        {authLoading ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
            <Loader2 className="animate-spin text-[#5A5A40]" size={32} />
            <p className="text-sm font-medium opacity-40 uppercase tracking-widest">Memeriksa Autentikasi...</p>
          </div>
        ) : !user ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center text-center space-y-8">
            <div className="w-24 h-24 bg-white rounded-[40px] shadow-2xl flex items-center justify-center text-[#5A5A40] rotate-6">
              <ShieldCheck size={48} strokeWidth={1.5} />
            </div>
            <div className="space-y-2">
              <h2 className="text-3xl font-black tracking-tight">Akses Terbatas</h2>
              <p className="text-sm opacity-50 max-w-sm mx-auto leading-relaxed">
                Aplikasi ini memerlukan izin akses khusus. Silakan masuk dengan akun Google Anda untuk melanjutkan.
              </p>
            </div>
            <button 
              onClick={handleLogin}
              className="bg-[#141414] text-white px-10 py-4 rounded-2xl font-bold hover:bg-[#5A5A40] transition-all flex items-center gap-3 shadow-xl shadow-black/10 active:scale-95"
            >
              <Users size={20} /> Masuk dengan Google
            </button>
          </div>
        ) : !isAuthorized ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center text-center space-y-8">
            <div className="w-24 h-24 bg-red-50 text-red-600 rounded-[40px] shadow-2xl flex items-center justify-center rotate-6">
              <AlertCircle size={48} strokeWidth={1.5} />
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <h2 className="text-3xl font-black tracking-tight">Oops! Belum Ada Izin</h2>
                <p className="text-sm opacity-50 max-w-md mx-auto leading-relaxed">
                  Akun <strong>{user.email}</strong> belum terdaftar dalam daftar akses yang diizinkan oleh Administrator.
                </p>
              </div>
              <div className="bg-[#141414]/5 p-4 rounded-2xl inline-block">
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-40">Hubungi Administrator</p>
                <p className="text-sm font-medium">jently.f.tamailang@gmail.com</p>
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="text-[#5A5A40] font-bold text-sm hover:underline"
            >
              Ganti Akun
            </button>
          </div>
        ) : viewMode === 'saved' ? (
          <div className="animate-in fade-in duration-700 space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black tracking-tight flex items-center gap-2">
                <BookOpen className="text-[#5A5A40]" /> Riwayat Perangkat Ajar
              </h2>
            </div>
            
            {loadingSaved ? (
              <div className="flex justify-center p-12">
                <Loader2 className="animate-spin text-[#5A5A40]" size={32} />
              </div>
            ) : savedPerangkats.length === 0 ? (
              <div className="bg-white rounded-3xl p-12 text-center border border-[#141414]/5 space-y-4">
                <div className="w-16 h-16 bg-[#F5F5F0] rounded-full flex items-center justify-center mx-auto text-[#141414]/30">
                  <BookOpen size={24} />
                </div>
                <p className="text-lg font-bold">Belum Ada Sejarah</p>
                <p className="text-sm opacity-50 max-w-md mx-auto">Anda belum pernah menyimpan perangkat pembelajaran apa pun.</p>
                <button 
                  onClick={() => setViewMode('create')}
                  className="mt-4 bg-[#141414] text-white px-6 py-3 rounded-full text-sm font-bold hover:bg-[#5A5A40] transition-colors inline-flex items-center gap-2"
                >
                  <Plus size={16} /> Buat Perangkat Baru
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {savedPerangkats.map((item) => (
                  <div key={item.id} className="bg-white rounded-3xl p-6 border border-[#141414]/5 shadow-sm hover:shadow-xl transition-all group flex flex-col items-start text-left">
                    <div className="flex items-start justify-between w-full mb-4">
                      <div className="w-10 h-10 bg-[#5A5A40]/10 text-[#5A5A40] rounded-xl flex items-center justify-center">
                        <BookOpen size={18} />
                      </div>
                      <div className="bg-[#141414]/5 text-[#141414]/60 text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded-md">
                        {new Date(item.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <h3 className="font-black text-lg line-clamp-2 mb-2">{item.title}</h3>
                    <div className="mt-auto pt-6 w-full flex items-center gap-3">
                      <button 
                        onClick={() => handleLoadPerangkat(item)}
                        className="flex-1 bg-[#F5F5F0] group-hover:bg-[#141414] group-hover:text-white px-4 py-3 rounded-xl text-xs font-bold transition-colors flex justify-center items-center gap-2"
                      >
                        <Layout size={14} /> Buka & Edit
                      </button>
                      <button 
                        onClick={() => item.id && handleDeletePerangkat(item.id)}
                        className="w-10 h-10 flex border border-red-100 items-center justify-center rounded-xl text-red-500 hover:bg-red-50 transition-colors"
                        title="Hapus"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in duration-700">
            {/* Left Column: Input & Settings */}
            <aside className="lg:col-span-4 space-y-6">
              {/* Identitas Dokumen (Administrative settings moved here) */}
              <div className="bg-white rounded-3xl p-6 border border-[#141414]/5 shadow-sm">
                <h2 className="text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                  <UserPlus size={14} className="text-[#5A5A40]" />
                  Identitas Dokumen
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider opacity-50 block mb-2">Nama Sekolah</label>
                    <input 
                      type="text" 
                      value={schoolName}
                      onChange={(e) => setSchoolName(e.target.value)}
                      placeholder="SD Negeri..."
                      className="w-full px-4 py-2.5 bg-[#F5F5F0] rounded-xl text-sm border-none focus:ring-2 focus:ring-[#5A5A40] outline-none transition-shadow"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider opacity-50 block mb-2">Mata Pelajaran</label>
                    <input 
                      type="text" 
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Contoh: IPAS, Matematika..."
                      className="w-full px-4 py-2.5 bg-[#F5F5F0] rounded-xl text-sm border-none focus:ring-2 focus:ring-[#5A5A40] outline-none transition-shadow"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider opacity-50 block mb-2">Nama Guru Mata Pelajaran</label>
                    <input 
                      type="text" 
                      value={teacherName}
                      onChange={(e) => setTeacherName(e.target.value)}
                      placeholder="Nama Lengkap Guru..."
                      className="w-full px-4 py-2.5 bg-[#F5F5F0] rounded-xl text-sm border-none focus:ring-2 focus:ring-[#5A5A40] outline-none transition-shadow"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider opacity-50 block mb-2">Nama Kepala Sekolah</label>
                    <input 
                      type="text" 
                      value={principalName}
                      onChange={(e) => setPrincipalName(e.target.value)}
                      placeholder="Nama Kepala Sekolah..."
                      className="w-full px-4 py-2.5 bg-[#F5F5F0] rounded-xl text-sm border-none focus:ring-2 focus:ring-[#5A5A40] outline-none transition-shadow"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider opacity-50 block mb-2">JP per Minggu</label>
                    <input 
                      type="number" 
                      value={jpPerWeek}
                      onChange={(e) => setJpPerWeek(e.target.value)}
                      placeholder="Contoh: 3, 5..."
                      className="w-full px-4 py-2.5 bg-[#F5F5F0] rounded-xl text-sm border-none focus:ring-2 focus:ring-[#5A5A40] outline-none transition-shadow"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider opacity-50 block mb-2">Jml Pertemuan per Minggu</label>
                    <input 
                      type="number" 
                      value={meetingsPerWeek}
                      onChange={(e) => setMeetingsPerWeek(e.target.value)}
                      placeholder="Contoh: 1, 2..."
                      className="w-full px-4 py-2.5 bg-[#F5F5F0] rounded-xl text-sm border-none focus:ring-2 focus:ring-[#5A5A40] outline-none transition-shadow"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-3xl p-6 border border-[#141414]/5 shadow-sm">
                <h2 className="text-sm font-bold uppercase tracking-widest mb-6 flex items-center gap-2">
                  <Sparkles size={14} className="text-[#5A5A40]" />
                  Pengaturan Pemetaan
                </h2>

                <div className="space-y-6">
                  {/* CP Input */}
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider opacity-50 block mb-2 flex justify-between items-center">
                      Teks Capaian Pembelajaran
                      <div className="flex items-center gap-3">
                        <AnimatePresence>
                          {isDraftSaved && (
                            <motion.span 
                              initial={{ opacity: 0, x: 5 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0 }}
                              className="text-[9px] text-green-600 font-bold flex items-center gap-1"
                            >
                              <CheckCircle2 size={10} /> Draf tersimpan
                            </motion.span>
                          )}
                        </AnimatePresence>
                        <span className="font-normal italic lowercase">{cpText.length} / 4000 karakter</span>
                      </div>
                    </label>
                    <textarea
                      value={cpText}
                      onChange={(e) => setCpText(e.target.value.substring(0, 4000))}
                      placeholder="Tempel teks CP dari kurikulum di sini..."
                      className="w-full h-48 bg-[#F5F5F0] border-none rounded-2xl p-4 text-sm focus:ring-2 focus:ring-[#5A5A40] outline-none resize-none transition-shadow"
                    />
                    <button 
                      onClick={() => {
                        setCpText("Pada akhir Fase A, peserta didik memiliki kemampuan untuk memahami dan menjelaskan tentang bagian-bagian tubuh manusia dan fungsinya, serta cara merawatnya. Peserta didik juga dapat mengidentifikasi ciri-ciri benda hidup dan benda mati di lingkungan sekitarnya, serta memahami siklus hidup hewan dan tumbuhan secara sederhana.");
                        setPhase('A');
                        setSelectedClasses(['1', '2']);
                      }}
                      className="mt-2 text-[10px] font-bold text-[#5A5A40] hover:underline flex items-center gap-1"
                    >
                      <Plus size={10} /> Gunakan Contoh Teks (IPAS Fase A)
                    </button>
                  </div>

                  {/* Phase Selection */}
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider opacity-50 block mb-3">Pilih Fase</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['A', 'B', 'C', 'D', 'E', 'F'] as Phase[]).map((p) => (
                        <button
                          key={p}
                          onClick={() => handlePhaseChange(p)}
                          className={`py-2 text-sm font-bold rounded-xl border transition-all ${
                            phase === p 
                              ? 'bg-[#5A5A40] border-[#5A5A40] text-white shadow-lg shadow-[#5A5A40]/20' 
                              : 'border-[#141414]/10 hover:border-[#141414]/30 bg-white'
                          }`}
                        >
                          Fase {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Class Selection */}
                  <div>
                    <label className="text-[11px] font-bold uppercase tracking-wider opacity-50 block mb-3">Pilih Kelas</label>
                    <div className="flex flex-wrap gap-2">
                      {CLASSES.filter(c => c.phase === phase).map((c) => (
                        <button
                          key={c.id}
                          onClick={() => toggleClass(c.id)}
                          className={`px-4 py-2 text-xs font-bold rounded-full border transition-all ${
                            selectedClasses.includes(c.id)
                              ? 'bg-[#141414] border-[#141414] text-white shadow-lg shadow-black/10'
                              : 'border-[#141414]/10 hover:border-[#141414]/30 bg-white'
                          }`}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {error && (
                    <div className={`p-4 rounded-xl flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 border ${
                      isQuotaError 
                        ? 'bg-amber-50 border-amber-200 text-amber-900' 
                        : 'bg-red-50 border-red-100 text-red-600'
                    }`}>
                      <div className="flex items-start gap-2 text-xs">
                        {isQuotaError ? <Sparkles size={14} className="mt-0.5" /> : <AlertCircle size={14} className="mt-0.5" />}
                        <div className="flex-1">
                          <p className="font-bold mb-1">{isQuotaError ? 'Batas Penggunaan Tercapai' : 'Terjadi Kesalahan'}</p>
                          <p className="opacity-80">{error}</p>
                        </div>
                      </div>
                      
                      {isQuotaError && (
                        <div className="text-[10px] bg-white/50 p-2 rounded-lg leading-relaxed border border-amber-200/50">
                          <strong>Tentang Batas Kuota AI:</strong> Layanan AI memiliki batasan jumlah permintaan per menit. 
                          <br /><br />
                          Jika Anda melihat pesan ini, silakan <strong>tunggu beberapa saat</strong> sebelum mencoba lagi.
                        </div>
                      )}
                      <div className="flex items-center justify-between border-t border-[#141414]/5 pt-3 mt-1">
                        <span className="text-[9px] opacity-40 italic">Klik tombol silang atau tekan tombol di samping untuk menutup</span>
                        <button 
                          onClick={() => { setError(null); setIsQuotaError(false); }}
                          className="px-3 py-1 bg-[#141414] text-white text-[10px] font-bold rounded-lg hover:bg-black transition-colors"
                        >
                          Tutup
                        </button>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleGenerate}
                    disabled={loading || cooldownSeconds > 0}
                    className="w-full bg-[#5A5A40] text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-[#4A4A30] active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none group"
                  >
                    {loading ? (
                      <Loader2 size={20} className="animate-spin" />
                    ) : cooldownSeconds > 0 ? (
                      <>
                        <Clock size={18} />
                        Tunggu {cooldownSeconds}s
                      </>
                    ) : (
                      <>
                        <Sparkles size={18} className="group-hover:rotate-12 transition-transform" />
                        Hasilkan TP Otomatis
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="bg-[#141414] rounded-3xl p-6 text-white overflow-hidden relative group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:bg-white/10 transition-colors" />
                <h3 className="text-sm font-bold mb-2">Tips Kurikulum</h3>
                <p className="text-xs opacity-70 leading-relaxed mb-4">
                  Kurikulum Merdeka menekankan fleksibilitas. TP yang dihasilkan AI ini adalah rekomendasi yang bisa Anda sesuaikan kembali dengan kondisi satuan pendidikan masing-masing.
                </p>
                <button 
                  onClick={() => setShowExamples(true)}
                  className="text-[10px] uppercase tracking-widest font-bold flex items-center gap-1 hover:gap-2 transition-all cursor-pointer"
                >
                  Lihat Contoh CP <ChevronRight size={12} />
                </button>
              </div>
            </aside>

            {/* Right Column: Results */}
            <section className="lg:col-span-8">
              <AnimatePresence mode="wait">
                {!result && !loading ? (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="h-full min-h-[400px] bg-white/40 border border-dashed border-[#141414]/20 rounded-3xl flex flex-col items-center justify-center text-center p-8"
                  >
                    <div className="w-16 h-16 bg-[#141414]/5 rounded-full flex items-center justify-center mb-4 text-[#141414]/20">
                      <FileText size={32} />
                    </div>
                    <h3 className="font-bold text-lg mb-2 opacity-40">Belum ada data pemetaan</h3>
                    <p className="text-sm opacity-40 max-w-xs">
                      Masukkan teks CP dan tekan tombol hasilkan untuk melihat pemetaan TP per kelas.
                    </p>
                  </motion.div>
                ) : loading ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    key="loading"
                    className="h-full min-h-[400px] flex flex-col items-center justify-center gap-6"
                  >
                    <div className="relative">
                      <div className="w-12 h-12 border-2 border-[#141414]/10 rounded-full" />
                      <div className="absolute inset-0 w-12 h-12 border-t-2 border-[#5A5A40] rounded-full animate-spin" />
                    </div>
                    <div className="text-center">
                      <h3 className="font-bold mb-1">AI sedang menganalisis CP...</h3>
                      <p className="text-xs opacity-50 italic">Ini mungkin memakan waktu beberapa detik</p>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    key="results"
                    className="flex flex-col space-y-10"
                  >
                    {/* Stepped Progress Indicator */}
                    <div className="bg-white rounded-[40px] p-8 border border-[#141414]/5 shadow-sm">
                      <div className="flex items-center justify-between max-w-2xl mx-auto relative px-2">
                        {/* Progress Line Background */}
                        <div className="absolute top-[20px] left-8 right-8 h-[2px] bg-[#141414]/5 z-0" />
                        {/* Progress Line Active */}
                        <div 
                          className="absolute top-[20px] left-8 h-[2px] bg-[#5A5A40] z-0 transition-all duration-500 ease-in-out" 
                          style={{ 
                            width: activeResultTab === 'tp' ? '0%' : activeResultTab === 'atp' ? '20%' : activeResultTab === 'prota' ? '40%' : activeResultTab === 'prosem' ? '60%' : activeResultTab === 'modul' ? '80%' : '100%' 
                          }}
                        />

                        {[
                          { id: 'tp', label: '1. Pemetaan TP', step: 1 },
                          { id: 'atp', label: '2. ATP', step: 2 },
                          { id: 'prota', label: '3. Prota', step: 3 },
                          { id: 'prosem', label: '4. Prosem', step: 4 },
                          { id: 'modul', label: '5. Modul Ajar', step: 5 },
                          { id: 'jurnal', label: '6. Jurnal & Nilai', step: 6 }
                        ].map((step, idx) => {
                          const isActive = activeResultTab === step.id;
                          const tabsOrder = ['tp', 'atp', 'prota', 'prosem', 'modul', 'jurnal'];
                          const isCompleted = tabsOrder.indexOf(activeResultTab) > tabsOrder.indexOf(step.id);

                          return (
                            <button
                              key={step.id}
                              onClick={() => {
                                if (step.id === 'tp' && result) setActiveResultTab('tp');
                                if (step.id === 'atp' && atp) setActiveResultTab('atp');
                                if (step.id === 'prota' && atp) setActiveResultTab('prota');
                                if (step.id === 'prosem' && atp) setActiveResultTab('prosem');
                                if (step.id === 'modul' && Object.keys(modules).length > 0) setActiveResultTab('modul');
                                if (step.id === 'jurnal' && atp) setActiveResultTab('jurnal');
                              }}
                              disabled={
                                (step.id === 'atp' && !atp && !result) || 
                                (step.id === 'prota' && !atp) ||
                                (step.id === 'prosem' && !atp) ||
                                (step.id === 'modul' && Object.keys(modules).length === 0 && !atp) ||
                                (step.id === 'jurnal' && !atp)
                              }
                              className={`relative z-10 flex flex-col items-center gap-3 transition-all ${(step.id !== 'tp' && !atp) ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:scale-105'}`}
                            >
                              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 border-4 ${
                                isActive 
                                  ? 'bg-[#5A5A40] text-white border-[#F5F5F0] shadow-lg shadow-[#5A5A40]/30' 
                                  : isCompleted 
                                    ? 'bg-green-600 text-white border-white'
                                    : 'bg-white text-[#141414]/20 border-[#141414]/5'
                              }`}>
                                {isCompleted ? <CheckCircle2 size={16} /> : step.step}
                              </div>
                              <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${isActive ? 'text-[#5A5A40]' : 'text-[#141414]/30'}`}>
                                {step.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {result && (
                      <div className="flex flex-col items-center gap-6 -mt-4 mb-8 relative z-10 w-full px-8">
                        <div className="flex flex-col md:flex-row justify-center items-center gap-4 w-full">
                          <button
                            onClick={handleSavePerangkat}
                            disabled={isSavingPerangkat}
                            className="w-full md:w-auto flex items-center justify-center gap-2 bg-[#5A5A40] text-white px-8 py-3.5 rounded-[20px] text-xs font-bold hover:bg-[#4A4A30] transition-all shadow-xl hover:-translate-y-1 active:translate-y-0 disabled:opacity-50 font-sans"
                          >
                            {isSavingPerangkat ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} 
                            Simpan ke Riwayat
                          </button>
                          <button
                            onClick={handleDownloadLengkap}
                            className="w-full md:w-auto flex items-center justify-center gap-2 bg-[#141414] text-white px-8 py-3.5 rounded-[20px] text-xs font-bold hover:bg-[#000] transition-all shadow-xl hover:-translate-y-1 active:translate-y-0 font-sans"
                          >
                            <Download size={16} /> Unduh Dokumen Pendukung (CP, ATP, Prota, Prosem)
                          </button>
                        </div>

                        {/* Dokumen Lengkap Per Kelas */}
                        <div className="w-full max-w-4xl bg-white rounded-3xl border border-[#141414]/5 p-6 shadow-sm space-y-4 text-left">
                          <div className="flex items-center gap-2 pb-2 border-b border-[#141414]/5">
                            <FileText size={16} className="text-[#5A5A40]" />
                            <h4 className="font-bold text-[11px] uppercase tracking-wider text-[#141414]">Dokumen Lengkap Per Kelas (Fase {phase})</h4>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {[...selectedClasses].sort((a,b) => parseInt(a) - parseInt(b)).map((classId) => {
                              const className = CLASSES.find(c => c.id === classId)?.name || `Kelas ${classId}`;
                              return (
                                <div key={classId} className="flex flex-wrap items-center justify-between p-4 bg-[#F5F5F0]/50 rounded-2xl border border-[#141414]/5 gap-3">
                                  <span className="font-bold text-xs text-[#141414]">{className}</span>
                                  <div className="flex items-center gap-2">
                                    <button 
                                      onClick={() => handleDownloadLengkapClass(classId)}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-gray-100 text-[#141414] border border-[#141414]/10 rounded-xl text-[10px] font-bold transition-all shadow-sm"
                                      title={`Unduh Dokumen Lengkap ${className} (.doc)`}
                                    >
                                      <Download size={12} /> Unduh (.doc)
                                    </button>
                                    <button 
                                      onClick={() => {
                                        setPrintLengkapClassLevel(classId);
                                        setIsPreviewingLengkap(true);
                                      }}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#5A5A40] hover:bg-[#4A4A30] text-white rounded-xl text-[10px] font-bold transition-all shadow-sm"
                                      title={`Cetak / Preview Dokumen Lengkap ${className}`}
                                    >
                                      <Printer size={12} /> Cetak (PDF)
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                      <AnimatePresence mode="wait">
                        {activeResultTab === 'tp' ? (
                          <motion.div 
                            key="tp-step"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="space-y-6 flex-1 flex flex-col"
                          >
                            <div className="flex justify-between items-center bg-white px-8 py-4 rounded-3xl border border-[#141414]/5 shadow-sm">
                              <div className="flex items-center gap-3">
                                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                <h3 className="font-bold text-sm">Tahap 1: Pemetaan Tujuan Pembelajaran</h3>
                              </div>
                              <div className="flex items-center gap-3">
                                <button 
                                  onClick={() => {
                                    if (!result) return;
                                    const text = [...(result.classes || [])].sort((a,b) => parseInt(a)-parseInt(b)).map(classId => {
                                      const className = CLASSES.find(c => c.id === classId)?.name;
                                      const cp = result.cpPerClass[classId] || "";
                                      const tps = result.tujuanPembelajaran.filter(tp => tp.classLevel === classId);
                                      return `--- ${className} ---
CP: ${cp}

TP:
${tps.map((tp, i) => `${i+1}. ${tp.statement}\n   KKTP: ${tp.kktp?.join(", ") || ''}`).join("\n")}`;
                                    }).join("\n\n");
                                    copyToClipboard(text);
                                  }}
                                  className="flex items-center gap-2 bg-white border border-[#141414]/10 px-4 py-2 rounded-xl text-[10px] font-bold hover:bg-[#141414]/5 transition-all"
                                >
                                  {copied ? <CheckCircle2 size={12} className="text-green-600" /> : <Copy size={12} />}
                                  {copied ? 'Tersalin' : 'Salin Semua'}
                                </button>
                                <button 
                                  onClick={handleDownloadTPDoc}
                                  className="p-2 hover:bg-[#141414]/5 rounded-lg border border-transparent hover:border-[#141414]/10" 
                                  title="Download Word (.doc)"
                                >
                                  <Download size={18} />
                                </button>
                              </div>
                            </div>

                            <div className="space-y-6">
                            {[...selectedClasses].sort((a,b) => parseInt(a) - parseInt(b)).map((classId) => {
                              const tps = result?.tujuanPembelajaran.filter(tp => tp.classLevel === classId) || [];
                              const classCP = result?.cpPerClass[classId] || '';
                              const className = CLASSES.find(c => c.id === classId)?.name || `Kelas ${classId}`;
                              
                              return (
                                <motion.div 
                                  key={classId}
                                  initial={{ opacity: 0, y: 10 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className="bg-white rounded-3xl border border-[#141414]/5 overflow-hidden shadow-sm"
                                >
                                  <div className="bg-[#F5F5F0] px-6 py-4 flex items-center justify-between border-b border-[#141414]/5">
                                    <div className="flex items-center gap-3">
                                      <div className="flex items-center gap-2">
                                        <CheckCircle2 size={16} className="text-[#5A5A40]" />
                                        <h4 className="font-bold text-sm uppercase tracking-wider">{className}</h4>
                                      </div>
                                      {classCP && (
                                        <button 
                                          onClick={() => setSelectedDetail({ className, content: classCP })}
                                          className="text-[10px] font-bold text-[#5A5A40] hover:text-[#141414] flex items-center gap-1 group/detail"
                                        >
                                          <span className="opacity-50 group-hover/detail:opacity-100 transition-opacity">| Lihat Ringkasan CP</span>
                                          <ChevronRight size={10} />
                                        </button>
                                      )}
                                    </div>
                                    <span className="text-[10px] font-bold bg-[#5A5A40] text-white px-2 py-0.5 rounded-full">
                                      {tps.length} TP
                                    </span>
                                  </div>
                                  
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                      <thead>
                                        <tr className="bg-[#141414]/[0.02] text-[10px] font-black uppercase tracking-[0.2em] text-[#141414]/40">
                                          <th className="px-8 py-4 border-b border-[#141414]/5 w-1/2">Tujuan Pembelajaran (TP)</th>
                                          <th className="px-8 py-4 border-b border-[#141414]/5 w-1/2">Kriteria Ketercapaian (KKTP)</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-[#141414]/5">
                                        {tps.map((tp, idx) => (
                                          <tr key={tp.id || idx} className="hover:bg-[#F5F5F0]/30 transition-colors group">
                                            <td className="px-6 py-6 align-top w-1/2">
                                              <div className="space-y-2">
                                                <div className="flex gap-2 items-start">
                                                  <div className="mt-1.5 w-1 h-1 rounded-full bg-[#5A5A40] shrink-0" />
                                                  <p className="text-sm font-medium leading-relaxed group-hover:text-[#5A5A40] transition-colors">
                                                    {tp.statement}
                                                  </p>
                                                </div>
                                                <button 
                                                  onClick={() => {
                                                    let mtgCount: number | undefined;
                                                    if (atp?.items) {
                                                      const matchingAtpItem = atp.items.find(item => item.tpId === tp.id || item.tpStatement === tp.statement);
                                                      if (matchingAtpItem) mtgCount = matchingAtpItem.numberOfMeetings;
                                                    }
                                                    handleGenerateTpDetails(tp, mtgCount);
                                                  }}
                                                  disabled={generatingForTpId === tp.id || cooldownSeconds > 0}
                                                  className="flex items-center gap-1.5 text-[10px] font-bold text-[#5A5A40] border border-[#5A5A40]/10 hover:bg-[#5A5A40]/5 px-2 py-1 rounded-lg transition-all disabled:opacity-40"
                                                >
                                                  {generatingForTpId === tp.id ? (
                                                    <Loader2 size={10} className="animate-spin" />
                                                  ) : cooldownSeconds > 0 ? (
                                                    <Clock size={10} />
                                                  ) : (
                                                    <Sparkles size={10} />
                                                  )}
                                                  {cooldownSeconds > 0 ? `Tunggu ${cooldownSeconds}s` : 'Lingkup Materi & Rekomendasi Pertemuan'}
                                                </button>
                                              </div>
                                            </td>
                                            <td className="px-6 py-6 align-top bg-[#141414]/[0.02] w-1/2">
                                              <div className="space-y-2">
                                                {tp.kktp?.map((kriteria, kIdx) => (
                                                  <div key={kIdx} className="flex gap-2 items-start text-[#141414]/70">
                                                    <div className="mt-2.5 w-1 h-1 rounded-full bg-[#5A5A40] shrink-0" />
                                                    <div className="flex-1">{renderKKTPWithBloomBadgeJsx(kriteria)}</div>
                                                  </div>
                                                ))}
                                              </div>
                                            </td>
                                          </tr>
                                        ))}
                                        {tps.length === 0 && (
                                          <tr>
                                            <td colSpan={2} className="px-6 py-12 text-center text-sm opacity-50 italic">
                                              Belum ada Tujuan Pembelajaran untuk kelas ini.
                                            </td>
                                          </tr>
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </motion.div>
                              );
                            })}
                            </div>

                            <div className="pt-8 border-t border-[#141414]/5 flex flex-col md:flex-row justify-between items-center gap-6">
                              <div className="flex items-center gap-4">
                                <button 
                                  onClick={() => {
                                    triggerConfirm('Bersihkan semua teks dan draf?', () => {
                                      setCpText('');
                                      setResult(null);
                                      setAtp(null);
                                      setCurrentModul(null);
                                      setActiveResultTab('tp');
                                      safeLocalStorage.removeItem('draft_cpText');
                                    });
                                  }}
                                  className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 text-red-600/50 hover:text-red-600 transition-colors"
                                >
                                  <Trash2 size={14} /> Reset Semua
                                </button>
                              </div>
                              
                              <div className="flex gap-3">
                                <button 
                                  onClick={handleDownloadTPDoc}
                                  className="flex items-center gap-2 px-6 py-3 border border-[#141414]/10 rounded-2xl text-xs font-bold hover:bg-[#141414]/5 transition-all"
                                >
                                  <Download size={14} /> Unduh TP
                                </button>
                                <button 
                                  onClick={() => setActiveResultTab('atp')}
                                  className="group flex items-center gap-4 bg-[#141414] text-white px-10 py-5 rounded-[24px] font-bold hover:bg-[#5A5A40] transition-all shadow-2xl shadow-black/20 active:scale-95"
                                >
                                  Lanjut ke Tahap 2: Susun ATP
                                  <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        ) : activeResultTab === 'atp' ? (
                          <motion.div 
                            key="atp-view"
                            initial={{ opacity: 0, x: -20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            className="flex-1 flex flex-col"
                          >
                            {!atp && !generatingAtp ? (
                              <div className="bg-white rounded-3xl border border-dashed border-[#5A5A40]/30 p-12 text-center flex flex-col items-center gap-6">
                                <div className="w-20 h-20 bg-[#5A5A40]/5 rounded-full flex items-center justify-center text-[#5A5A40]">
                                  <Clock size={40} strokeWidth={1} />
                                </div>
                                <div className="max-w-md">
                                  <h3 className="font-bold text-lg mb-2 text-[#141414]">Susun Alur Tujuan Pembelajaran</h3>
                                  <p className="text-sm opacity-50 leading-relaxed text-[#141414]">
                                    AI akan mengurutkan semua TP yang telah dihasilkan ke dalam alur yang logis dan lengkap dengan alokasi waktu (JP), asesmen, dan sumber belajar.
                                  </p>
                                </div>
                                <button 
                                  onClick={handleGenerateAtp}
                                  className="bg-[#5A5A40] text-white px-8 py-3 rounded-2xl font-bold hover:bg-[#4A4A30] transition-all flex items-center gap-2 active:scale-95 shadow-xl shadow-[#5A5A40]/20"
                                >
                                  <Sparkles size={18} />
                                  Susun ATP Sekarang
                                </button>
                              </div>
                            ) : generatingAtp ? (
                              <div className="bg-white rounded-3xl border border-[#141414]/5 p-16 text-center flex flex-col items-center gap-6">
                                <div className="relative">
                                  <div className="w-16 h-16 border-4 border-[#141414]/5 rounded-full" />
                                  <div className="absolute inset-0 w-16 h-16 border-t-4 border-[#5A5A40] rounded-full animate-spin" />
                                </div>
                                <div>
                                  <h3 className="font-bold text-lg mb-1 text-[#141414]">Menganalisis Urutan Pedagogis...</h3>
                                  <p className="text-xs opacity-50 italic uppercase tracking-widest font-mono text-[#141414]">Jangan tutup halaman ini</p>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-6">
                                {atp && (
                                  <>
                                    <div className="bg-[#5A5A40] text-white p-10 rounded-[50px] shadow-2xl relative overflow-hidden group">
                                      <div className="absolute -top-10 -right-10 w-96 h-96 bg-white/5 rounded-full blur-3xl group-hover:bg-white/10 transition-colors duration-1000" />
                                      <div className="flex gap-8 items-start relative z-10">
                                        <div className="w-16 h-16 bg-white/10 rounded-[28px] flex items-center justify-center shrink-0 border border-white/20">
                                          <Sparkles size={32} />
                                        </div>
                                        <div>
                                          <h4 className="text-[10px] font-black uppercase tracking-[0.3em] opacity-60 mb-3 text-white">Filosofi & Rasionalisasi Alur</h4>
                                          <p className="text-xl leading-relaxed font-bold italic opacity-95 tracking-tight text-white">"{atp.rationale}"</p>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="space-y-12 mt-12">
                                      {Array.from(new Set(atp.items.map(i => i.classLevel))).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })).map(classLevel => {
                                        const classItems = atp.items.filter(item => item.classLevel === classLevel).sort((a,b) => a.flow - b.flow);
                                        return (
                                          <div key={classLevel} className="space-y-4">
                                            <h3 className="font-bold text-xl ml-4 text-[#141414] flex items-center gap-2">
                                              <div className="w-8 h-8 rounded-full bg-[#5A5A40] text-white flex items-center justify-center text-sm">
                                                {classLevel}
                                              </div>
                                              ATP Kelas {classLevel}
                                            </h3>
                                            <div className="bg-white rounded-[40px] border border-[#141414]/5 overflow-hidden shadow-xl">
                                              <div className="overflow-x-auto text-[#141414]">
                                                <table className="w-full text-left border-collapse border-spacing-0 min-w-[1200px]">
                                                  <thead>
                                                    <tr className="bg-[#141414]/5 text-[9px] font-black uppercase tracking-wider text-[#141414]/40">
                                                      <th className="px-4 py-4 w-12 text-center border-b border-[#141414]/5">No</th>
                                                      <th className="px-4 py-4 w-48 border-b border-[#141414]/5">CP</th>
                                                      <th className="px-4 py-4 w-48 border-b border-[#141414]/5">Tujuan Pembelajaran</th>
                                                      <th className="px-4 py-4 w-64 border-b border-[#141414]/5">KKTP (Indikator)</th>
                                                      <th className="px-4 py-4 w-40 border-b border-[#141414]/5">Materi</th>
                                                      <th className="px-4 py-4 w-24 text-center border-b border-[#141414]/5">JP / Pertemuan</th>
                                                      <th className="px-4 py-4 w-40 border-b border-[#141414]/5">Asesmen</th>
                                                      <th className="px-4 py-4 w-44 border-b border-[#141414]/5">Alternatif Aksi</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody className="divide-y divide-[#141414]/5">
                                                    {classItems.map((item, index) => (
                                                      <tr key={index} className="hover:bg-[#F5F5F0]/30 transition-colors group">
                                                        <td className="px-4 py-6 align-top text-center">
                                                          <div className="w-8 h-8 flex items-center justify-center bg-[#141414] text-white text-xs font-black rounded-lg mx-auto">
                                                            {index + 1}
                                                          </div>
                                                        </td>
                                                        <td className="px-4 py-6 align-top text-[11px] leading-relaxed opacity-70">
                                                          {item.cp}
                                                        </td>
                                                        <td className="px-4 py-6 align-top text-xs font-bold leading-tight">
                                                          {item.tpStatement}
                                                        </td>
                                                        <td className="px-4 py-6 align-top">
                                                          <ul className="space-y-1">
                                                            {item.kktp?.map((k, kIdx) => (
                                                              <li key={kIdx} className="text-[10px] flex gap-1.5 opacity-70">
                                                                <div className="mt-1 w-1 h-1 bg-[#5A5A40] rounded-full shrink-0" />
                                                                {renderKKTPWithBloomBadgeJsx(k)}
                                                              </li>
                                                            ))}
                                                          </ul>
                                                        </td>
                                                        <td className="px-4 py-6 align-top text-[10px] italic font-medium opacity-80">
                                                          {item.content}
                                                        </td>
                                                        <td className="px-4 py-6 align-top text-center">
                                                          <div className="inline-block bg-[#F5F5F0] px-3 py-2 rounded-xl border border-[#141414]/5">
                                                            <p className="text-xs font-black text-[#5A5A40] leading-none mb-1">{item.jp} JP</p>
                                                            <p className="text-[8px] font-bold uppercase opacity-40">{item.numberOfMeetings} Perte.</p>
                                                          </div>
                                                        </td>
                                                        <td className="px-4 py-6 align-top text-[10px] leading-relaxed opacity-70">
                                                          {item.assessment}
                                                        </td>
                                                        <td className="px-4 py-6 align-top text-center">
                                                          <button 
                                                            onClick={async () => {
                                                              const matchingTp = result?.tujuanPembelajaran.find(tp => tp.statement === item.tpStatement);
                                                              if (!matchingTp) return;
                                                              
                                                              if (modules[item.tpId]) {
                                                                 setCurrentModul(modules[item.tpId]);
                                                                 setActiveResultTab('modul');
                                                                 return;
                                                              }
                                                              
                                                              setGeneratingForTpId(item.tpId);
                                                              try {
                                                                const modul = await generateModulAjarFromATP(
                                                                  item,
                                                                  result.phase,
                                                                  Number(jpPerWeek) || 3,
                                                                  subject
                                                                );
                                                                setModules(prev => ({...prev, [item.tpId]: modul}));
                                                                setCurrentModul(modul);
                                                                setActiveResultTab('modul');
                                                              } catch(err: any) {
                                                                triggerAlert(err.message || 'Gagal generate modul', 'error');
                                                              } finally {
                                                                setGeneratingForTpId(null);
                                                              }
                                                            }}
                                                            className="flex items-center gap-1.5 px-3 py-2 bg-[#141414] text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-[#5A5A40] transition-all active:scale-95 mx-auto whitespace-nowrap shadow-md shadow-black/5"
                                                            disabled={item.tpId === generatingForTpId}
                                                          >
                                                            {item.tpId === generatingForTpId ? (
                                                              <span className="animate-spin w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
                                                            ) : modules[item.tpId] ? (
                                                              <Eye size={12} />
                                                            ) : (
                                                              <Plus size={12} />
                                                            )}
                                                            {item.tpId === generatingForTpId ? 'Memproses...' : modules[item.tpId] ? 'Lihat Modul' : 'Buat Modul AI'}
                                                          </button>
                                                        </td>
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    
                                    <div className="flex flex-col md:flex-row gap-4 mt-8 pt-8 border-t border-[#141414]/10">
                                      <button 
                                        onClick={handleGenerateAllModules}
                                        disabled={isGeneratingAll || Object.keys(modules).length === atp.items.length}
                                        className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 text-white px-6 py-4 rounded-2xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-xl hover:-translate-y-1 active:translate-y-0 disabled:opacity-50 disabled:hover:translate-y-0"
                                      >
                                        {isGeneratingAll ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                                        {isGeneratingAll ? `Memproses Modul... (${generatingProgress}/${totalToGenerate})` : Object.keys(modules).length === atp.items.length ? 'Semua Modul Sudah Digenerate' : 'Generate Semua Modul AI Sekaligus'}
                                      </button>
                                      
                                      <button 
                                        onClick={() => setActiveResultTab('prota')}
                                        className="flex-1 flex items-center justify-center gap-2 bg-[#141414] text-white px-6 py-4 rounded-2xl text-xs font-bold hover:bg-[#5A5A40] transition-all shadow-xl hover:-translate-y-1 active:translate-y-0"
                                      >
                                        Lanjut ke Penyusunan Prota <ChevronRight size={16} />
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </motion.div>
                        ) : activeResultTab === 'prota' ? (
                          <motion.div 
                            key="prota-phase"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="space-y-6 text-[#141414]"
                          >
                            <div className="flex justify-between items-center bg-white px-8 py-4 rounded-3xl border border-[#141414]/5 shadow-sm">
                              <div className="flex items-center gap-3">
                                <button 
                                  onClick={() => setActiveResultTab('atp')}
                                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#141414]/5 transition-colors"
                                >
                                  <ChevronRight className="rotate-180" size={16} />
                                </button>
                                <h3 className="font-bold text-sm">Tahap 3: Program Tahunan (Prota)</h3>
                              </div>
                            </div>
                            
                            {!atp ? (
                               <div className="text-center p-10 opacity-50">Silakan kembali dan buat ATP terlebih dahulu.</div>
                            ) : (
                               <div className="bg-white rounded-[50px] border border-[#141414]/5 p-12 shadow-2xl relative">
                                 <div className="mb-12 space-y-4 text-center">
                                   <div className="inline-block bg-[#141414]/5 px-6 py-2 rounded-full text-xs font-bold tracking-widest uppercase">
                                     Estimasi {18 * (Number(jpPerWeek) || 3)} JP / Semester
                                   </div>
                                   <h2 className="text-3xl font-black">Program Tahunan</h2>
                                   <p className="opacity-60 text-sm max-w-2xl mx-auto">Tujuan Pembelajaran dialokasikan menjadi dua semester berdasarkan jam pelajaran per minggu.</p>
                                 </div>
                                 
                                 <div className="space-y-12">
                                     {Array.from(new Set(atp.items.map(i => i.classLevel))).sort((a,b) => String(a).localeCompare(String(b), undefined, { numeric: true })).map(classLevel => {
                                        const items = atp.items.filter(i => i.classLevel === classLevel).sort((a,b) => a.flow - b.flow);
                                        const jpPerSem = 18 * (Number(jpPerWeek) || 3);
                                        let currentSem = 1;
                                        let cumulatedJp = 0;
                                        
                                        const sem1 = items.filter(i => i.semester === 1);
                                        const sem2 = items.filter(i => i.semester === 2);
                                        
                                        return (
                                           <div key={classLevel} className="space-y-8">
                                             <h3 className="text-xl font-bold border-b aspect-auto border-[#141414]/10 pb-4">Kelas {classLevel}</h3>
                                             <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                                {/* Semester 1 */}
                                                <div className="bg-[#F5F5F0] rounded-3xl p-6 border border-[#141414]/10">
                                                   <div className="text-center bg-white rounded-2xl py-3 shadow-sm font-black text-sm mb-6 uppercase tracking-wider text-[#5A5A40]">Semester 1</div>
                                                   <div className="space-y-4">
                                                     {sem1.length === 0 && <div className="text-center text-xs opacity-50 py-4">Belum ada TP</div>}
                                                     {sem1.map((item, idx) => (
                                                        <div key={idx} className="bg-white p-4 rounded-xl shadow-sm text-xs border border-transparent hover:border-[#141414]/10 transition-colors">
                                                          <div className="flex justify-between items-start mb-2">
                                                             <span className="font-bold opacity-50">TP {idx + 1}</span>
                                                             <span className="bg-[#141414] text-white px-2 py-1 rounded text-[10px] font-bold">{item.jp} JP</span>
                                                          </div>
                                                          <p className="font-medium opacity-80">{item.tpStatement}</p>
                                                        </div>
                                                     ))}
                                                   </div>
                                                </div>
                                                {/* Semester 2 */}
                                                <div className="bg-[#F5F5F0] rounded-3xl p-6 border border-[#141414]/10">
                                                   <div className="text-center bg-white rounded-2xl py-3 shadow-sm font-black text-sm mb-6 uppercase tracking-wider text-[#5A5A40]">Semester 2</div>
                                                   <div className="space-y-4">
                                                     {sem2.length === 0 && <div className="text-center text-xs opacity-50 py-4">Belum ada Kegiatan</div>}
                                                     {sem2.map((item, idx) => (
                                                        <div key={idx} className="bg-white p-4 rounded-xl shadow-sm text-xs border border-transparent hover:border-[#141414]/10 transition-colors">
                                                          <div className="flex justify-between items-start mb-2">
                                                             <span className="font-bold opacity-50">TP {sem1.length + idx + 1}</span>
                                                             <span className="bg-[#141414] text-white px-2 py-1 rounded text-[10px] font-bold">{item.jp} JP</span>
                                                          </div>
                                                          <p className="font-medium opacity-80">{item.tpStatement}</p>
                                                        </div>
                                                     ))}
                                                   </div>
                                                </div>
                                             </div>
                                           </div>
                                        );
                                     })}
                                 </div>
                                 <div className="mt-12 text-center pt-8 border-t border-[#141414]/5 flex flex-wrap justify-center gap-4">
                                   <button 
                                     onClick={handleDownloadProta}
                                     className="inline-flex items-center gap-2 bg-[#F5F5F0] text-[#141414] border border-[#141414]/10 px-10 py-4 rounded-full text-xs font-bold hover:bg-[#E5E5E0] transition-colors"
                                   >
                                     <Download size={16} /> Unduh Prota
                                   </button>
                                   <button 
                                      onClick={() => setActiveResultTab('prosem')}
                                      className="inline-flex items-center gap-2 bg-[#141414] text-white px-10 py-4 rounded-full text-xs font-bold hover:bg-[#5A5A40] transition-all shadow-xl hover:-translate-y-1"
                                   >
                                     Lanjut ke Program Semester <ChevronRight size={16} />
                                   </button>
                                 </div>
                               </div>
                            )}
                          </motion.div>
                        ) : activeResultTab === 'prosem' ? (
                          <motion.div 
                            key="prosem-phase"
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            className="space-y-6 text-[#141414]"
                          >
                            <div className="flex justify-between items-center bg-white px-8 py-4 rounded-3xl border border-[#141414]/5 shadow-sm">
                              <div className="flex items-center gap-3">
                                <button 
                                  onClick={() => setActiveResultTab('prota')}
                                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#141414]/5 transition-colors"
                                >
                                  <ChevronRight className="rotate-180" size={16} />
                                </button>
                                <h3 className="font-bold text-sm">Tahap 4: Program Semester (Prosem)</h3>
                              </div>
                            </div>
                            
                            {!atp ? (
                               <div className="text-center p-10 opacity-50">Silakan kembali dan buat ATP terlebih dahulu.</div>
                            ) : (
                               <div className="bg-white rounded-[50px] border border-[#141414]/5 p-12 shadow-2xl relative">
                                 <div className="mb-12 space-y-4 text-center">
                                   <h2 className="text-3xl font-black">Program Semester</h2>
                                   <p className="opacity-60 text-sm max-w-2xl mx-auto">Distribusi Tujuan Pembelajaran per minggu efektif. Asumsi 1 bulan = 4 minggu.</p>
                                 </div>
                                 
                                 <div className="space-y-16">
                                     {Array.from(new Set(atp.items.map(i => i.classLevel))).sort((a,b) => String(a).localeCompare(String(b), undefined, { numeric: true })).map(classLevel => {
                                        const items = atp.items.filter(i => i.classLevel === classLevel).sort((a,b) => a.flow - b.flow);
                                        const distItems = getCorrectProsemWeeks(items, parseInt(jpPerWeek) || 3, parseInt(meetingsPerWeek) || 1);

                                        return (
                                           <div key={classLevel} className="space-y-6">
                                             <div className="flex flex-wrap items-center justify-between gap-4">
                                               <h3 className="text-xl font-bold bg-[#141414]/5 inline-block px-6 py-2 rounded-full">Kelas {classLevel}</h3>
                                               <div className="flex items-center gap-2">
                                                 <button 
                                                   onClick={() => handleDownloadProsemClass(String(classLevel))}
                                                   className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#F5F5F0] hover:bg-[#E5E5E0] text-[#141414] border border-[#141414]/10 rounded-xl text-xs font-bold transition-all shadow-sm"
                                                   title={`Unduh Prosem Kelas ${classLevel} (.doc)`}
                                                 >
                                                   <Download size={14} /> Unduh (.doc)
                                                 </button>
                                                 <button 
                                                   onClick={() => {
                                                     setPrintProsemClassLevel(String(classLevel));
                                                     setIsPreviewingProsem(true);
                                                   }}
                                                   className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#5A5A40] hover:bg-[#4A4A30] text-white rounded-xl text-xs font-bold transition-all shadow-sm"
                                                   title={`Cetak / Preview Prosem Kelas ${classLevel}`}
                                                 >
                                                   <Printer size={14} /> Cetak (PDF)
                                                 </button>
                                               </div>
                                             </div>
                                             <div className="w-full overflow-x-auto rounded-3xl border border-[#141414]/10 bg-[#F5F5F0]">
                                                <table className="w-full min-w-[800px] text-left border-collapse">
                                                   <thead>
                                                     <tr className="bg-[#141414] text-white">
                                                        <th className="px-4 py-3 text-xs w-8 text-center shrink-0">No</th>
                                                        <th className="px-4 py-3 text-xs min-w-[250px]">Kegiatan / TP</th>
                                                        <th className="px-4 py-3 text-xs w-16 text-center shrink-0">JP</th>
                                                        <th className="px-4 py-3 text-xs w-48 text-center bg-[#5A5A40]">Alokasi Waktu</th>
                                                     </tr>
                                                   </thead>
                                                   <tbody className="divide-y divide-[#141414]/10">
                                                     {distItems.map((di, idx) => {
                                                        const isSem2 = di.semester === 2;
                                                        return (
                                                           <tr key={idx} className="bg-white">
                                                              <td className="px-4 py-4 text-xs font-bold opacity-50 text-center">{idx + 1}</td>
                                                              <td className="px-4 py-4 text-xs font-medium">
                                                                  <div className="font-bold mb-1">{di.tpStatement}</div>
                                                                  {result?.tujuanPembelajaran.find(tp => tp.id === di.tpId)?.meetings?.map((m, mIdx) => (
                                                                     <div key={mIdx} className="text-[10px] opacity-70 mb-0.5">• {m.activity}</div>
                                                                  ))}
                                                               </td>
                                                              <td className="px-4 py-4 text-xs font-bold text-center bg-[#F5F5F0]">{di.jp}</td>
                                                              <td className="px-4 py-4 text-xs text-center border-l border-[#141414]/5 space-y-1">
                                                                 <div className="text-[10px] uppercase font-bold tracking-widest opacity-50">
                                                                    Semester {isSem2 ? 2 : 1}
                                                                 </div>
                                                                 <div className="bg-[#5A5A40]/10 text-[#5A5A40] inline-block px-3 py-1 rounded font-black">
                                                                    Minggu {di.startWeek} {di.endWeek > di.startWeek ? `- ${di.endWeek}` : ''}
                                                                 </div>
                                                              </td>
                                                           </tr>
                                                        );
                                                     })}
                                                   </tbody>
                                                </table>
                                             </div>
                                           </div>
                                        );
                                     })}
                                 </div>
                                 <div className="mt-12 flex flex-wrap justify-center gap-4 pt-8 border-t border-[#141414]/5">
                                    <button 
                                      onClick={handleDownloadProsem}
                                      className="flex items-center gap-2 bg-[#F5F5F0] text-[#141414] border border-[#141414]/10 px-10 py-5 rounded-[24px] font-bold hover:bg-[#E5E5E0] transition-colors"
                                    >
                                      <Download size={20} /> Unduh Prosem
                                    </button>
                                    <button 
                                      onClick={() => setActiveResultTab('modul')}
                                      className="flex items-center gap-2 bg-[#5A5A40] text-white px-10 py-5 rounded-[24px] font-bold hover:bg-[#4A4A30] transition-all shadow-2xl hover:-translate-y-1"
                                    >
                                      Lanjut ke Rincian Modul <ChevronRight size={20} />
                                    </button>
                                 </div>
                               </div>
                            )}
                          </motion.div>
                        ) : activeResultTab === 'modul' ? (
                        <motion.div 
                          key="modul-phase"
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          className="space-y-6 text-[#141414]"
                        >
                          <div className="flex justify-between items-center bg-white px-8 py-4 rounded-3xl border border-[#141414]/5 shadow-sm">
                            <div className="flex items-center gap-3">
                              <button 
                                onClick={() => setActiveResultTab('atp')}
                                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#141414]/5 transition-colors"
                              >
                                <ChevronRight className="rotate-180" size={16} />
                              </button>
                              <h3 className="font-bold text-sm">Tahap 3: Modul Ajar Terperinci</h3>
                            </div>
                          </div>

                          {!atp?.items || Object.keys(modules).length === 0 ? (
                            <div className="bg-white rounded-[40px] border border-dashed border-[#5A5A40]/30 p-24 text-center flex flex-col items-center gap-8 shadow-sm">
                              <div className="w-24 h-24 bg-[#5A5A40]/5 rounded-[40px] flex items-center justify-center text-[#5A5A40] rotate-[-6deg] border border-[#5A5A40]/10">
                                <FileText size={40} strokeWidth={1} />
                              </div>
                              <div className="max-w-sm">
                                <h3 className="font-bold text-2xl mb-3 tracking-tight">Siapkan Skenario</h3>
                                <p className="text-sm opacity-50 font-medium leading-relaxed">
                                  Pilih salah satu Tujuan Pembelajaran dari daftar ATP di Tahap 2, lalu klik tombol "Rincian Pertemuan" untuk merinci skenario kegiatan belajar.
                                </p>
                              </div>
                              <button 
                                onClick={() => setActiveResultTab('atp')}
                                className="text-[#5A5A40] font-black text-[10px] uppercase tracking-widest hover:underline flex items-center gap-2"
                              >
                                <ChevronRight className="rotate-180" size={16} /> Kembali ke Tahap 2
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-10">
                              {/* Smart AI Bulk Kelengkapan Panel */}
                              <div className="bg-gradient-to-br from-[#5A5A40]/10 via-[#F5F5F0]/30 to-white rounded-[40px] border border-[#5A5A40]/20 p-8 shadow-sm">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                      <span className="flex h-2 w-2 relative">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#5A5A40] opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#5A5A40]"></span>
                                      </span>
                                      <h3 className="font-black text-xs uppercase tracking-[0.2em] text-[#5A5A40]">Smart AI Premium</h3>
                                    </div>
                                    <h2 className="text-xl md:text-2xl font-black tracking-tight text-[#141414]">Lengkapi Semua Modul Otomatis (Smart AI Bulk)</h2>
                                    <p className="text-xs opacity-60 leading-relaxed max-w-2xl">
                                      AI akan bekerja secara teliti dan berurutan untuk menganalisis isi setiap modul, kemudian menyusun dokumen pendukung (Materi Ajar, LKPD, Soal Evaluasi, dan Lampiran Instrumen) secara profesional dan sangat mendalam.
                                    </p>
                                  </div>

                                  <button
                                    onClick={handleGenerateAllExtras}
                                    disabled={isGeneratingAllExtras}
                                    className="px-8 py-4 bg-[#5A5A40] text-white rounded-[24px] text-xs font-black uppercase tracking-widest hover:bg-[#4A4A30] transition-all flex items-center gap-2.5 shrink-0 hover:shadow-xl hover:shadow-[#5A5A40]/20 active:translate-y-0.5 disabled:opacity-50"
                                  >
                                    {isGeneratingAllExtras ? (
                                      <>
                                        <Loader2 size={16} className="animate-spin" />
                                        Menganalisis & Bekerja...
                                      </>
                                    ) : (
                                      <>
                                        <Sparkles size={16} />
                                        Mulai Smart AI Kelengkapan
                                      </>
                                    )}
                                  </button>
                                </div>

                                {/* Progress State Block */}
                                {isGeneratingAllExtras && (
                                  <div className="mt-8 pt-6 border-t border-[#141414]/5 space-y-4">
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="font-bold text-[#5A5A40]">Kemajuan Smart AI</span>
                                      <span className="font-black tracking-wider opacity-60">{extrasProgress} / {totalExtrasToGenerate} Modul Selesai</span>
                                    </div>
                                    
                                    {/* Progress Bar Container */}
                                    <div className="w-full h-3 bg-[#141414]/5 rounded-full overflow-hidden">
                                      <div 
                                        className="h-full bg-[#5A5A40] rounded-full transition-all duration-500"
                                        style={{ width: `${(extrasProgress / totalExtrasToGenerate) * 100}%` }}
                                      />
                                    </div>

                                    {/* Active Subtask Indicator */}
                                    {currentExtraTargetName && (
                                      <div className="flex items-center gap-2 bg-white/70 backdrop-blur-sm border border-[#5A5A40]/10 px-4 py-3 rounded-2xl">
                                        <Loader2 size={14} className="animate-spin text-[#5A5A40] shrink-0" />
                                        <p className="text-xs font-medium text-[#141414]/70">
                                          Sedang memproses & melengkapi materi, LKPD, soal, dan rubrik: <strong className="text-[#141414] font-bold">{currentExtraTargetName}</strong>
                                        </p>
                                      </div>
                                    )}

                                    {/* Procedural Visual Timeline */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                                      {Object.entries(modules).map(([iTpId, iModul], idx) => {
                                        const mItem = iModul as ModulAjar;
                                        const isCompleted = idx < extrasProgress;
                                        const isCurrent = idx === extrasProgress && isGeneratingAllExtras;
                                        return (
                                          <div 
                                            key={iTpId} 
                                            className={`p-4 rounded-2xl border transition-all flex items-center justify-between text-xs ${
                                              isCompleted 
                                                ? "bg-emerald-50/50 border-emerald-500/10 text-emerald-800" 
                                                : isCurrent 
                                                ? "bg-amber-50/50 border-amber-500/20 text-amber-800 animate-pulse" 
                                                : "bg-[#F5F5F0]/50 border-transparent text-[#141414]/40"
                                            }`}
                                          >
                                            <div className="flex items-center gap-2.5 min-w-0">
                                              <span className={`w-5 h-5 flex items-center justify-center rounded-full font-black text-[10px] shrink-0 ${
                                                isCompleted 
                                                  ? "bg-emerald-500 text-white" 
                                                  : isCurrent 
                                                  ? "bg-amber-500 text-white" 
                                                  : "bg-[#141414]/5 text-[#141414]/40"
                                              }`}>
                                                {idx + 1}
                                              </span>
                                              <span className="font-bold truncate">{mItem.title}</span>
                                            </div>
                                            <span className="font-black uppercase tracking-widest text-[9px] shrink-0 ml-2">
                                              {isCompleted ? "✓ Selesai" : isCurrent ? "⚡ Sedang Dibuat..." : "Antrean"}
                                            </span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {Object.entries(modules).map(([tpId, value]) => {
                                const modulAjarItem = value as ModulAjar;
                                return (
                              <div key={tpId} className="bg-white rounded-[50px] border border-[#141414]/5 p-12 shadow-2xl relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-16 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity duration-1000">
                                  <BookOpen size={250} />
                                </div>

                                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-10 pb-12 border-b-2 border-[#141414]/5 mb-12">
                                  <div className="space-y-6">
                                    <div className="flex flex-wrap gap-2">
                                      <span className="text-[10px] font-black px-4 py-1.5 bg-[#5A5A40] text-white rounded-full uppercase tracking-widest shadow-lg shadow-[#5A5A40]/20">
                                        {modulAjarItem.model}
                                      </span>
                                      <span className="text-[10px] font-black px-4 py-1.5 bg-[#141414]/5 text-[#141414]/40 rounded-full uppercase tracking-widest">
                                        Fase {phase}
                                      </span>
                                    </div>
                                    <h2 className="text-4xl font-black tracking-tighter leading-none max-w-2xl">{modulAjarItem.title}</h2>
                                  </div>
                                  <div className="flex flex-wrap gap-4 shrink-0">
                                    <button 
                                       onClick={() => handleDownloadModulDoc(modulAjarItem)}
                                       className="flex items-center gap-3 bg-[#141414] text-white px-8 py-5 rounded-[24px] font-bold hover:bg-[#5A5A40] transition-all shadow-2xl shadow-black/20 active:scale-95 whitespace-nowrap"
                                    >
                                      <Download size={22} /> Unduh Modul (.doc)
                                    </button>
                                    <button 
                                       onClick={() => handleDownloadLampiranLengkapDoc(modulAjarItem)}
                                       className="flex items-center gap-3 bg-[#5A5A40] text-white px-8 py-5 rounded-[24px] font-bold hover:bg-[#4A4A30] transition-all shadow-2xl shadow-[#5A5A40]/20 active:scale-95 whitespace-nowrap"
                                       title="Unduh semua lampiran secara lengkap teratur per pertemuan"
                                    >
                                      <Sparkles size={22} /> Unduh Lampiran Lengkap (.doc)
                                    </button>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">
                                  <div className="lg:col-span-4 space-y-12">
                                    <section className="space-y-6">
                                      <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-[#5A5A40] opacity-40">I. Identitas & Profil</h4>
                                      <div className="space-y-6">
                                        <div className="bg-[#F5F5F0] p-6 rounded-[32px] border border-[#141414]/5 space-y-4">
                                          <span className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-1 block">Dimensi Pancasila</span>
                                          <div className="flex flex-wrap gap-2">
                                            {modulAjarItem.ppp?.map((p, i) => (
                                              <span key={i} className="text-[10px] font-bold bg-[#141414]/5 px-3 py-1 rounded-lg">
                                                {p}
                                              </span>
                                            ))}
                                          </div>
                                        </div>
                                        <div className="bg-[#F5F5F0] p-6 rounded-[32px] border border-[#141414]/5 space-y-4">
                                          <span className="text-[9px] font-black uppercase tracking-widest opacity-40 mb-1 block">Sarana & Media</span>
                                          <div className="space-y-2">
                                            {modulAjarItem.media?.map((m, i) => (
                                              <div key={i} className="text-xs font-bold py-1 flex items-center gap-2 opacity-80">
                                                <div className="w-1 h-1 bg-green-500 rounded-full" /> {m}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      </div>
                                    </section>
                                  </div>

                                  <div className="lg:col-span-8 space-y-12">
                                    <section className="space-y-8">
                                      <h4 className="text-[10px] font-black uppercase tracking-[0.4em] text-[#5A5A40] opacity-40">II. Langkah Pembelajaran (Skenario)</h4>
                                      <div className="space-y-10">
                                        <div className="bg-[#5A5A40]/5 p-8 rounded-[40px] border border-[#5A5A40]/10 border-l-[6px] border-l-[#5A5A40]">
                                          <span className="text-[9px] font-black uppercase tracking-widest text-[#5A5A40] mb-3 block">Pemahaman Bermakna</span>
                                          <p className="text-lg font-bold italic text-[#5A5A40] leading-relaxed tracking-tight">
                                            "{modulAjarItem.meaningfulUnderstanding}"
                                          </p>
                                        </div>
                                        
                                        <div className="space-y-6">
                                          <span className="text-[9px] font-black uppercase tracking-widest opacity-40 block mb-6">Alur Kegiatan Sintaks Model {modulAjarItem.model}</span>
                                          <div className="space-y-6">
                                            {modulAjarItem.meetingActivities?.length ? modulAjarItem.meetingActivities.map((ma, maIdx) => (
                                              <div key={`ma-${maIdx}`} className="space-y-4">
                                                <div className="bg-[#5A5A40]/5 rounded-xl p-3 inline-block">
                                                  <span className="font-bold text-[10px] text-[#5A5A40] uppercase tracking-widest">Pertemuan {ma.session}</span>
                                                  {ma.activityTitle && <p className="text-xs font-bold opacity-70 mt-1">{ma.activityTitle}</p>}
                                                </div>
                                                <div className="space-y-0">
                                                  {ma.steps?.map((step, i) => (
                                                    <div key={i} className="relative pl-12 border-l-2 border-[#141414]/5 pb-10 last:pb-0 group/step">
                                                      <div className="absolute left-[-9px] top-0 w-[16px] h-[16px] bg-white border-4 border-[#141414] rounded-full z-10 group-hover/step:bg-green-600 group-hover/step:border-green-600 transition-all duration-300 group-hover/step:scale-125 shadow-sm" />
                                                      <div className="space-y-3 bg-white p-6 rounded-3xl border border-transparent group-hover/step:border-[#141414]/5 group-hover/step:shadow-xl group-hover/step:shadow-[#141414]/5 transition-all">
                                                        <span className="text-[10px] font-black uppercase tracking-widest text-[#5A5A40] px-3 py-1 bg-[#5A5A40]/5 rounded-full block w-fit mb-2">{step.phase}</span>
                                                        <div className="text-sm font-normal leading-relaxed opacity-80 group-hover/step:opacity-100 transition-opacity">{renderActivityTextJsx(step.activity || '')}</div>
                                                      </div>
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            )) : (
                                              <div className="space-y-0">
                                                {modulAjarItem.steps?.map((step, i) => (
                                                  <div key={i} className="relative pl-12 border-l-2 border-[#141414]/5 pb-10 last:pb-0 group/step">
                                                    <div className="absolute left-[-9px] top-0 w-[16px] h-[16px] bg-white border-4 border-[#141414] rounded-full z-10 group-hover/step:bg-green-600 group-hover/step:border-green-600 transition-all duration-300 group-hover/step:scale-125 shadow-sm" />
                                                    <div className="space-y-3 bg-white p-6 rounded-3xl border border-transparent group-hover/step:border-[#141414]/5 group-hover/step:shadow-xl group-hover/step:shadow-[#141414]/5 transition-all">
                                                      <span className="text-[10px] font-black uppercase tracking-widest text-[#5A5A40] px-3 py-1 bg-[#5A5A40]/5 rounded-full block w-fit mb-2">{step.phase}</span>
                                                      <div className="text-sm font-normal leading-relaxed opacity-80 group-hover/step:opacity-100 transition-opacity">{renderActivityTextJsx(step.activity || '')}</div>
                                                    </div>
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </section>
                                  </div>
                                </div>
                                
                                {/* AI Extra Buttons */}
                                <div className="mt-12 pt-12 border-t border-[#141414]/5 space-y-4">
                                  <div className="bg-[#5A5A40]/5 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div className="space-y-1">
                                      <h4 className="text-xs font-bold uppercase tracking-wider text-[#5A5A40]">Kelengkapan Modul Otomatis (Smart AI)</h4>
                                      <p className="text-[11px] opacity-60">
                                        Menganalisis isi modul dan otomatis hanya membuat kelengkapan yang dibutuhkan (Materi, LKPD, Soal Evaluasi, dan/atau Lampiran).
                                      </p>
                                    </div>
                                    <button 
                                      onClick={() => handleGenerateExtraOtomatis(tpId)} 
                                      disabled={generatingAutoExtraId === tpId || !!generatingExtraId}
                                      className="px-6 py-3 bg-[#5A5A40] text-white rounded-xl text-xs font-bold hover:bg-[#4A4A30] transition-colors flex items-center gap-2 shrink-0 disabled:opacity-50"
                                    >
                                      {generatingAutoExtraId === tpId ? (
                                        <>
                                          <Loader2 size={14} className="animate-spin" />
                                          Menganalisis & Membuat...
                                        </>
                                      ) : (
                                        <>
                                          <Sparkles size={14} />
                                          Otomatis Buat Kelengkapan (AI)
                                        </>
                                      )}
                                    </button>
                                  </div>

                                  <div className="flex flex-wrap gap-4">
                                    <button onClick={() => handleGenerateExtra(tpId, 'lampiran')} disabled={!!generatingAutoExtraId} className="px-6 py-3 bg-[#F5F5F0] rounded-xl text-xs font-bold hover:bg-[#E5E5E0] transition-colors flex items-center gap-2 disabled:opacity-50">{generatingExtraId === `${tpId}-lampiran` ? <Loader2 size={14} className="animate-spin"/> : <FileText size={14}/>} Buat Lampiran AI</button>
                                    <button onClick={() => handleGenerateExtra(tpId, 'soal')} disabled={!!generatingAutoExtraId} className="px-6 py-3 bg-[#F5F5F0] rounded-xl text-xs font-bold hover:bg-[#E5E5E0] transition-colors flex items-center gap-2 disabled:opacity-50">{generatingExtraId === `${tpId}-soal` ? <Loader2 size={14} className="animate-spin"/> : <FileText size={14}/>} Buat Soal AI</button>
                                    <button onClick={() => handleGenerateExtra(tpId, 'materi')} disabled={!!generatingAutoExtraId} className="px-6 py-3 bg-[#F5F5F0] rounded-xl text-xs font-bold hover:bg-[#E5E5E0] transition-colors flex items-center gap-2 disabled:opacity-50">{generatingExtraId === `${tpId}-materi` ? <Loader2 size={14} className="animate-spin"/> : <FileText size={14}/>} Buat Materi AI</button>
                                    <button onClick={() => handleGenerateExtra(tpId, 'lkpd')} disabled={!!generatingAutoExtraId} className="px-6 py-3 bg-[#F5F5F0] rounded-xl text-xs font-bold hover:bg-[#E5E5E0] transition-colors flex items-center gap-2 disabled:opacity-50">{generatingExtraId === `${tpId}-lkpd` ? <Loader2 size={14} className="animate-spin"/> : <FileText size={14}/>} Buat LKPD AI</button>
                                  </div>
                                </div>
                                
                                {/* Display AI Extras if they exist */}
                                {(modulAjarItem.lampiran || modulAjarItem.soal || modulAjarItem.materi || modulAjarItem.lkpd) && (
                                    <div className="mt-8 space-y-6">
                                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[#5A5A40]/5 p-5 rounded-2xl border border-[#5A5A40]/10">
                                          <div>
                                            <h4 className="font-bold text-sm text-[#5A5A40]">Lampiran & Materi Pendukung Siap</h4>
                                            <p className="text-[11px] opacity-70">Unduh seluruh lampiran di atas yang telah diatur rapi per tiap pertemuan secara otomatis.</p>
                                          </div>
                                          <button
                                            onClick={() => handleDownloadLampiranLengkapDoc(modulAjarItem)}
                                            className="px-6 py-3 bg-[#5A5A40] text-white hover:bg-[#4A4A30] rounded-xl text-xs font-bold transition-all flex items-center gap-2 shadow-lg shadow-[#5A5A40]/15 whitespace-nowrap"
                                          >
                                            <Download size={14} /> Unduh Lampiran Lengkap (.doc)
                                          </button>
                                        </div>
                                        {modulAjarItem.lampiran && (
                                            <div className="bg-white border text-sm border-[#141414]/10 rounded-2xl p-6">
  <h4 className="font-bold mb-4">Lampiran</h4>
  <div className="prose prose-sm max-w-none opacity-80" dangerouslySetInnerHTML={{ __html: modulAjarItem.lampiran }} />
</div>
                                        )}
                                        {modulAjarItem.soal && (
                                            <div className="bg-white border text-sm border-[#141414]/10 rounded-2xl p-6"><h4 className="font-bold mb-4">Soal Evaluasi</h4><div className="prose prose-sm opacity-80" dangerouslySetInnerHTML={{ __html: modulAjarItem.soal }} /></div>
                                        )}
                                        {modulAjarItem.materi && (
                                            <div className="bg-white border text-sm border-[#141414]/10 rounded-2xl p-6"><h4 className="font-bold mb-4">Materi Ajar</h4><div className="prose prose-sm opacity-80" dangerouslySetInnerHTML={{ __html: modulAjarItem.materi }} /></div>
                                        )}
                                        {modulAjarItem.lkpd && (
                                            <div className="bg-white border text-sm border-[#141414]/10 rounded-2xl p-6"><h4 className="font-bold mb-4">LKPD</h4><div className="prose prose-sm opacity-80" dangerouslySetInnerHTML={{ __html: addIdentityToLKPD(modulAjarItem.lkpd, modulAjarItem.title, subject) }} /></div>
                                        )}
                                    </div>
                                )}

                              </div>
                              );
                              })}
                              <div className="mt-12 flex flex-wrap justify-center gap-4 pt-8 border-t border-[#141414]/5">
                                 <button 
                                   onClick={() => setActiveResultTab('jurnal')}
                                   className="flex items-center gap-2 bg-[#141414] text-white px-10 py-5 rounded-[24px] font-bold hover:bg-[#5A5A40] transition-all shadow-2xl hover:-translate-y-1"
                                 >
                                   Lanjut ke Jurnal & Nilai <ChevronRight size={20} />
                                 </button>
                              </div>
                            </div>
                          )}
                        </motion.div>
                        ) : activeResultTab === 'jurnal' ? (
                        <motion.div 
                          key="jurnal-phase"
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          className="space-y-6 text-[#141414]"
                        >
                          <div className="flex justify-between items-center bg-white px-8 py-4 rounded-3xl border border-[#141414]/5 shadow-sm">
                            <div className="flex items-center gap-3">
                              <button 
                                onClick={() => setActiveResultTab('modul')}
                                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#141414]/5 transition-colors"
                              >
                                <ChevronRight className="rotate-180" size={16} />
                              </button>
                              <h3 className="font-bold text-sm">Tahap 6: Jurnal & Daftar Nilai Harian</h3>
                            </div>
                          </div>

                          {!atp?.items ? (
                            <div className="text-center p-10 opacity-50">Silakan kembali dan buat ATP terlebih dahulu.</div>
                          ) : (
                            <div className="bg-white rounded-[50px] border border-[#141414]/5 p-12 shadow-2xl relative">
                              <div className="mb-12 space-y-4 text-center">
                                <h2 className="text-3xl font-black">Jurnal & Daftar Nilai Harian</h2>
                                <p className="opacity-60 text-sm max-w-2xl mx-auto">Catatan kegiatan pembelajaran harian dan format lembar nilai siap cetak.</p>
                              </div>
                              
                              <div className="w-full overflow-x-auto rounded-3xl border border-[#141414]/10 bg-[#F5F5F0]">
                                <table className="w-full min-w-[800px] text-left border-collapse">
                                  <thead>
                                    <tr className="bg-[#141414] text-white">
                                      <th className="px-4 py-3 text-xs w-8 text-center shrink-0">No</th>
                                      <th className="px-4 py-3 text-xs w-32">Hari/Tanggal</th>
                                      <th className="px-4 py-3 text-xs w-16 text-center">Jam Ke</th>
                                      <th className="px-4 py-3 text-xs w-16 text-center">Kelas</th>
                                      <th className="px-4 py-3 text-xs w-48">Topik / Modul</th>
                                      <th className="px-4 py-3 text-xs min-w-[250px]">Kegiatan Pembelajaran (Aktivitas Pokok)</th>
                                      <th className="px-4 py-3 text-xs w-32 text-center">Kehadiran</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[#141414]/10">
                                    {(() => {
                                      let counter = 1;
                                      return atp.items.map((item, idx) => {
                                        const mod = modules[item.tpId];
                                        if (mod && mod.meetingActivities?.length) {
                                          return mod.meetingActivities.map((ma, j) => (
                                            <tr key={`${idx}-${j}`} className="bg-white">
                                              <td className="px-4 py-4 text-xs font-bold opacity-50 text-center">{counter++}</td>
                                              <td className="px-4 py-4 border-r border-[#141414]/5"></td>
                                              <td className="px-4 py-4 border-r border-[#141414]/5"></td>
                                              <td className="px-4 py-4 text-xs text-center border-r border-[#141414]/5">{item.classLevel}</td>
                                              <td className="px-4 py-4 text-xs font-bold border-r border-[#141414]/5">{ma.activityTitle || mod.title}</td>
                                              <td className="px-4 py-4 text-xs border-r border-[#141414]/5">
                                                <div className="font-medium underline decoration-[#141414]/10 decoration-wavy underline-offset-4 mb-2">{item.tpStatement}</div>
                                                <div className="space-y-1 pl-3 opacity-80 border-l-2 border-[#141414]/10">
                                                  {ma.steps?.map((s, si) => <div key={si}>- {s.activity}</div>)}
                                                </div>
                                              </td>
                                              <td className="px-4 py-4"></td>
                                            </tr>
                                          ));
                                        } else {
                                          return (
                                            <tr key={idx} className="bg-white">
                                              <td className="px-4 py-4 text-xs font-bold opacity-50 text-center">{counter++}</td>
                                              <td className="px-4 py-4 border-r border-[#141414]/5"></td>
                                              <td className="px-4 py-4 border-r border-[#141414]/5"></td>
                                              <td className="px-4 py-4 text-xs text-center border-r border-[#141414]/5">{item.classLevel}</td>
                                              <td className="px-4 py-4 text-xs font-bold border-r border-[#141414]/5">{mod?.title || 'Topik ' + counter}</td>
                                              <td className="px-4 py-4 text-xs border-r border-[#141414]/5">
                                                <div className="font-medium">{item.tpStatement}</div>
                                              </td>
                                              <td className="px-4 py-4"></td>
                                            </tr>
                                          );
                                        }
                                      });
                                    })()}
                                  </tbody>
                                </table>
                              </div>
                              <div className="mt-12 flex flex-wrap justify-center gap-4 pt-8 border-t border-[#141414]/5">
                                 <button 
                                   onClick={handleDownloadJurnalDoc}
                                   className="flex items-center gap-2 bg-[#5A5A40] text-white px-10 py-5 rounded-[24px] font-bold hover:bg-[#4A4A30] transition-all shadow-xl hover:-translate-y-1"
                                 >
                                   <Download size={20} /> Unduh Jurnal
                                 </button>
                                 <button 
                                   onClick={handleDownloadDaftarNilaiDoc}
                                   className="flex items-center gap-2 bg-white text-[#141414] border border-[#141414]/10 px-10 py-5 rounded-[24px] font-bold hover:bg-[#141414]/5 transition-all shadow-xl hover:-translate-y-1"
                                 >
                                   <Download size={20} /> Unduh Daftar Nilai
                                 </button>
                              </div>
                            </div>
                          )}
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          </div>
        )}
      </main>

      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-[#141414]/5 flex flex-col md:flex-row justify-between items-center gap-6 opacity-40 text-xs text-center md:text-left">
        <p>© 2026 Kurikulum AI- Jently F. Tamailang</p>
      </footer>

      <AnimatePresence>
        {showAccessManager && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAccessManager(false)}
              className="absolute inset-0 bg-[#141414]/60 backdrop-blur-md" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative overflow-hidden flex flex-col"
            >
              <div className="p-8 border-b border-[#141414]/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#5A5A40]/10 rounded-xl flex items-center justify-center text-[#5A5A40]">
                    <ShieldCheck size={20} />
                  </div>
                  <h3 className="font-bold text-lg">Kelola Akses</h3>
                </div>
                <button 
                  onClick={() => setShowAccessManager(false)}
                  className="w-10 h-10 rounded-full hover:bg-[#141414]/5 flex items-center justify-center transition-colors"
                >
                  <Plus size={24} className="rotate-45" />
                </button>
              </div>

              <div className="p-8 space-y-6">
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <input 
                      type="email" 
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="Email Google..."
                      className="flex-1 px-4 py-2 bg-[#F5F5F0] rounded-xl text-sm border-none focus:ring-2 focus:ring-[#5A5A40] outline-none"
                    />
                    <button 
                      onClick={handleAddEmail}
                      disabled={emailLoading}
                      className="bg-[#5A5A40] text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-[#4A4A30] transition-colors disabled:opacity-50"
                    >
                      {emailLoading ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                    </button>
                  </div>

                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 ml-1">Daftar Email Terdaftar</p>
                    {authorizedEmails.length === 0 ? (
                      <p className="text-xs opacity-30 italic p-4 text-center">Belum ada email tambahan.</p>
                    ) : (
                      authorizedEmails.map(email => (
                        <div key={email} className="flex items-center justify-between p-3 bg-[#F5F5F0] rounded-xl">
                          <span className="text-xs font-medium">{email}</span>
                          <button 
                            onClick={() => handleDeleteEmail(email)}
                            className="p-1.5 hover:bg-red-50 text-red-600 rounded-lg transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="p-6 bg-[#F5F5F0] border-t border-[#141414]/5 text-center">
                <p className="text-[10px] opacity-40 uppercase tracking-tight">Admin: jently.f.tamailang@gmail.com</p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Detail CP */}
      <AnimatePresence>
        {selectedDetail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedDetail(null)}
              className="absolute inset-0 bg-[#141414]/40 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl relative overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-8 border-b border-[#141414]/5 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-xl mb-1">Rincian Capaian Pembelajaran</h3>
                  <p className="text-xs uppercase tracking-widest opacity-50 font-bold">{selectedDetail.className} — Fase {phase}</p>
                </div>
                <button 
                  onClick={() => setSelectedDetail(null)}
                  className="w-10 h-10 rounded-full hover:bg-[#141414]/5 flex items-center justify-center transition-colors"
                >
                  <Plus size={24} className="rotate-45" />
                </button>
              </div>
              <div className="p-8 overflow-y-auto">
                <div className="prose prose-sm max-w-none">
                  <div className="bg-[#F5F5F0] p-6 rounded-2xl border border-[#141414]/5">
                    <p className="text-[#141414] leading-loose text-base italic">
                      "{selectedDetail.content}"
                    </p>
                  </div>
                  <div className="mt-8 space-y-4">
                    <h4 className="text-sm font-bold uppercase tracking-wider text-[#5A5A40]">Analisis Kurikulum</h4>
                    <p className="text-sm opacity-70 leading-relaxed">
                      Teks di atas merupakan deskripsi kompetensi yang diharapkan dicapai siswa pada akhir {selectedDetail.className}. Deskripsi ini digunakan sebagai acuan untuk menurunkan Tujuan Pembelajaran (TP) yang lebih operasional.
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-6 bg-[#F5F5F0] border-t border-[#141414]/5 flex justify-end">
                <button 
                  onClick={() => setSelectedDetail(null)}
                  className="bg-[#141414] text-white px-6 py-2.5 rounded-full text-sm font-bold hover:bg-[#5A5A40] transition-colors"
                >
                  Tutup
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Detail TP (Materials & Recommendation) */}
      <AnimatePresence>
        {selectedTpDetail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedTpDetail(null)}
              className="absolute inset-0 bg-[#141414]/40 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl relative overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-8 border-b border-[#141414]/5 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-[#141414]/5 text-[#141414]/60 rounded uppercase tracking-tighter">
                      Rekomendasi AI
                    </span>
                  </div>
                  <h3 className="font-bold text-lg leading-tight">{selectedTpDetail.statement}</h3>
                </div>
                <button 
                  onClick={() => setSelectedTpDetail(null)}
                  className="w-10 h-10 rounded-full hover:bg-[#141414]/5 flex items-center justify-center transition-colors"
                >
                  <Plus size={24} className="rotate-45" />
                </button>
              </div>

              <div className="p-8 overflow-y-auto space-y-8">
                {/* Lingkup Materi */}
                <section className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] flex items-center gap-2">
                    <Sparkles size={14} /> Lingkup Materi (Scope)
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedTpDetail.materials?.map((material, i) => (
                      <div key={i} className="p-4 bg-[#F5F5F0] rounded-2xl border border-[#141414]/5 flex gap-3 items-start">
                        <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 shadow-sm">
                          {i + 1}
                        </div>
                        <p className="text-sm font-medium opacity-80">{material}</p>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Rekomendasi Pertemuan */}
                <section className="space-y-4">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-[#5A5A40] flex items-center gap-2">
                    <CheckCircle2 size={14} /> Rekomendasi Pertemuan
                  </h4>
                  <div className="space-y-3">
                    {selectedTpDetail.meetings?.map((meeting, i) => (
                      <div key={i} className="group relative pl-10 border-l-2 border-[#5A5A40]/20 pb-6 last:pb-0">
                        <div className="absolute left-[-9px] top-0 w-4 h-4 bg-white border-2 border-[#5A5A40] rounded-full z-10" />
                        <div className="flex flex-col gap-1 items-start">
                          <span className="text-[10px] font-bold uppercase tracking-widest opacity-40">Pertemuan {meeting.session}</span>
                          <p className="text-sm font-medium leading-relaxed group-hover:text-[#5A5A40] transition-colors">{meeting.activity}</p>
                          <button 
                            onClick={() => {
                              if (meeting.modulAjar) {
                                setCurrentModul(meeting.modulAjar);
                              } else {
                                setSelectingModelFor({ tp: selectedTpDetail, session: meeting.session, activity: meeting.activity });
                              }
                            }}
                            className={`mt-2 flex items-center gap-1.5 text-[10px] font-bold px-2 py-1 rounded-lg border transition-all ${
                              meeting.modulAjar 
                              ? 'bg-[#5A5A40] text-white border-[#5A5A40]' 
                              : 'text-[#5A5A40] hover:bg-[#5A5A40]/5 border-[#5A5A40]/10 opacity-0 group-hover:opacity-100'
                            }`}
                          >
                            {meeting.modulAjar ? <Eye size={10} /> : <FileText size={10} />}
                            {meeting.modulAjar ? 'Lihat Modul Ajar' : 'Buat Modul Ajar'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="p-6 bg-[#F5F5F0] border-t border-[#141414]/5 flex justify-between items-center">
                <p className="text-[10px] italic opacity-50">Sesuai dengan Kurikulum Merdeka</p>
                <button 
                  onClick={() => setSelectedTpDetail(null)}
                  className="bg-[#141414] text-white px-8 py-2.5 rounded-full text-sm font-bold hover:bg-[#5A5A40] transition-colors shadow-lg shadow-black/10"
                >
                  Tutup
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Pilih Model Pembelajaran */}
      <AnimatePresence>
        {selectingModelFor && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectingModelFor(null)}
              className="absolute inset-0 bg-[#141414]/60 backdrop-blur-md" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white w-full max-w-lg rounded-3xl shadow-2xl relative overflow-hidden p-8"
            >
              <div className="flex flex-col items-center text-center space-y-4 mb-8">
                <div className="w-16 h-16 bg-[#5A5A40]/10 rounded-2xl flex items-center justify-center text-[#5A5A40]">
                  <Layout size={32} />
                </div>
                <div className="space-y-1">
                  <h3 className="font-bold text-xl">Pilih Model Pembelajaran</h3>
                  <p className="text-sm opacity-50 px-4">Pilih model pembelajaran yang paling sesuai untuk aktivitas pertemuan ini.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {(['Problem Based Learning (PBL)', 'Project Based Learning (PjBL)', 'Inquiry Learning', 'Discovery Learning', 'Cooperative Learning'] as LearningModel[]).map((model) => (
                  <button
                    key={model}
                    onClick={() => handleGenerateModul(model)}
                    disabled={cooldownSeconds > 0}
                    className="flex items-center justify-between p-4 rounded-2xl border border-[#141414]/5 hover:border-[#5A5A40] hover:bg-[#5A5A40]/5 transition-all text-left group disabled:opacity-50"
                  >
                    <span className="font-bold text-sm">{model}</span>
                    {cooldownSeconds > 0 ? (
                      <span className="text-[10px] opacity-40 flex items-center gap-1"><Clock size={10}/> {cooldownSeconds}s</span>
                    ) : (
                      <ChevronRight size={16} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </button>
                ))}
              </div>

              <button 
                onClick={() => setSelectingModelFor(null)}
                className="mt-6 w-full py-3 text-xs font-bold uppercase tracking-widest opacity-40 hover:opacity-100 transition-opacity"
              >
                Batalkan
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Loading Modul */}
      <AnimatePresence>
        {generatingModul && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 bg-white/80 backdrop-blur-sm" 
            />
            <div className="relative flex flex-col items-center space-y-6">
              <div className="relative">
                <Loader2 size={48} className="text-[#5A5A40] animate-spin" />
                <Sparkles size={20} className="text-[#5A5A40] absolute -top-1 -right-1 animate-pulse" />
              </div>
              <div className="text-center">
                <h4 className="font-bold text-lg">Menyusun Modul Ajar Mendalam...</h4>
                <p className="text-sm opacity-50">AI sedang mengonstruksi sintaks pembelajaran terbaik</p>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Tampilan Modul Ajar */}
      <AnimatePresence>
        {currentModul && !isPreviewing && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-6 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setCurrentModul(null)}
              className="fixed inset-0 bg-[#141414]/40 backdrop-blur-sm" 
            />
            <motion.div 
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl relative overflow-hidden flex flex-col my-8"
            >
              <div className="p-8 border-b border-[#141414]/5 flex items-center justify-between sticky top-0 bg-white z-10">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-[#5A5A40] text-white rounded-2xl">
                    <FileText size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-xl">{currentModul.title}</h3>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-[#5A5A40] uppercase tracking-widest">{currentModul.model}</span>
                      <span className="text-[10px] opacity-20">|</span>
                      <span className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest">Modul Ajar Mendalam</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleDownloadModulDoc(currentModul)}
                    className="p-3 bg-[#141414] text-white rounded-xl hover:bg-black transition-colors"
                    title="Unduh RPP / Modul(.doc)"
                  >
                    <Download size={20} />
                  </button>
                  <button 
                    onClick={() => handleDownloadLampiranLengkapDoc(currentModul)}
                    className="p-3 bg-[#5A5A40] text-white rounded-xl hover:bg-[#4A4A30] transition-colors"
                    title="Unduh Lampiran Lengkap per Pertemuan (.doc)"
                  >
                    <Sparkles size={20} />
                  </button>
                  <button 
                    onClick={() => {
                      const text = `
MODUL AJAR: ${currentModul.title}
TUJUAN PEMBELAJARAN (TP): ${currentModul.tpStatement}
JENJANG: ${currentModul.targetStudents}
DURASI: ${currentModul.duration}
MODEL: ${currentModul.model}

I. INFORMASI UMUM
- Dimensi Profil Lulusan: ${currentModul.ppp?.join(', ') || ''}
- Sarana dan Prasarana: ${currentModul.media?.join(', ') || ''}

II. KOMPONEN INTI
- Pemahaman Bermakna: ${currentModul.meaningfulUnderstanding}
- Pertanyaan Pemantik: ${currentModul.triggerQuestions?.join('; ') || ''}

III. KEGIATAN PEMBELAJARAN
${currentModul.meetingActivities?.length ? currentModul.meetingActivities.map(ma => `Pertemuan ${ma.session} - ${ma.activityTitle}\n` + (ma.steps?.map((s, i) => `${i + 1}. ${s.phase}: ${s.activity}`).join('\n') || '')).join('\n\n') : (currentModul.steps?.map((s, i) => `${i + 1}. ${s.phase}: ${s.activity}`).join('\n') || '')}

IV. ASESMEN
${currentModul.assessment}

V. DIFERENSIASI
${currentModul.differentiation}
                      `;
                      navigator.clipboard.writeText(text);
                      triggerAlert('Modul disalin ke clipboard!', 'success');
                    }}
                    className="p-3 bg-[#141414]/5 rounded-xl hover:bg-[#141414]/10 transition-colors"
                    title="Salin Modul"
                  >
                    <Copy size={20} />
                  </button>
                  <button 
                    onClick={() => setCurrentModul(null)}
                    className="p-3 bg-[#141414]/5 rounded-xl hover:bg-red-50 hover:text-red-600 transition-colors"
                  >
                    <Plus size={24} className="rotate-45" />
                  </button>
                </div>
              </div>

              <div className="p-8 space-y-12 overflow-y-auto max-h-[75vh] bg-[#F9F9F7]">
                {/* Header Dokumen */}
                <div className="text-center space-y-4 pb-8 border-b-2 border-[#141414]/10">
                  <h2 className="text-2xl font-black uppercase tracking-tighter">Modul Ajar Pembelajaran Mendalam</h2>
                  
                  <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 text-[11px] font-bold text-[#5A5A40] pt-4">
                    <span className="flex items-center gap-1.5"><Users size={12}/> {currentModul.targetStudents}</span>
                    <span className="flex items-center gap-1.5"><Clock size={12}/> {currentModul.duration}</span>
                    <span className="flex items-center gap-1.5"><Layout size={12}/> {currentModul.model}</span>
                  </div>
                </div>

                {/* Sesi Informasi Umum */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <section className="space-y-4">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#5A5A40] border-b border-[#5A5A40]/20 pb-1">I. Informasi Umum</h4>
                    <div className="space-y-4 text-sm">
                      <div className="space-y-1">
                        <span className="font-bold block text-[10px] opacity-40 uppercase">Dimensi Profil Lulusan</span>
                        <div className="space-y-1.5 pt-1">
                          {currentModul.ppp?.map((p, i) => (
                            <div key={i} className="text-sm flex gap-2 items-start text-[#141414]/80">
                              <div className="mt-1.5 w-1 h-1 rounded-full bg-[#5A5A40] shrink-0" />
                              <span className="leading-relaxed">{p}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="font-bold block text-[10px] opacity-40 uppercase">Sarana dan Prasarana</span>
                        <div className="space-y-1.5 pt-1">
                          {currentModul.media?.map((m, i) => (
                            <div key={i} className="text-sm flex gap-2 items-start text-[#141414]/80">
                              <div className="mt-1.5 w-1 h-1 rounded-full bg-[#5A5A40] shrink-0" />
                              <span className="leading-relaxed">{m}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-4">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#5A5A40] border-b border-[#5A5A40]/20 pb-1">II. Komponen Inti</h4>
                    <div className="space-y-4 text-sm">
                      <div className="space-y-1">
                        <span className="font-bold block text-[10px] opacity-40 uppercase">Tujuan Pembelajaran</span>
                        <div className="space-y-1.5 pt-1">
                          {currentModul.tpStatement?.split('\n').filter(s => s.trim()).map((s, i) => (
                            <div key={i} className="text-sm flex gap-2 items-start text-[#141414]/80">
                              <div className="mt-1.5 w-1 h-1 rounded-full bg-[#5A5A40] shrink-0" />
                              <span className="leading-relaxed">{s.replace(/^[0-9.-]+\s*/, '')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <span className="font-bold block text-[10px] opacity-40 uppercase">Pemahaman Bermakna</span>
                        <p className="opacity-80 italic leading-relaxed">"{currentModul.meaningfulUnderstanding}"</p>
                      </div>
                      <div className="space-y-1">
                        <span className="font-bold block text-[10px] opacity-40 uppercase">Pertanyaan Pemantik</span>
                        <div className="space-y-1.5 pt-1">
                          {currentModul.triggerQuestions?.map((q, i) => (
                            <div key={i} className="text-sm flex gap-2 items-start text-[#141414]/80">
                              <div className="mt-1.5 w-1 h-1 rounded-full bg-[#5A5A40] shrink-0" />
                              <span className="leading-relaxed">{q}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                {/* Langkah Pembelajaran */}
                <section className="space-y-6">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#5A5A40] border-b border-[#5A5A40]/20 pb-1">III. Kegiatan Pembelajaran</h4>
                  <div className="space-y-6">
                    {currentModul.meetingActivities?.length ? currentModul.meetingActivities.map((ma, maIdx) => (
                      <div key={`ma-${maIdx}`} className="space-y-4">
                        <div className="bg-[#5A5A40]/5 rounded-xl p-3 inline-block">
                          <span className="font-bold text-sm text-[#5A5A40] uppercase tracking-widest">Pertemuan {ma.session}</span>
                          {ma.activityTitle && <p className="text-xs opacity-70 mt-0.5">{ma.activityTitle}</p>}
                        </div>
                        
                        <div className="overflow-x-auto rounded-2xl border border-[#141414]/5 bg-white shadow-sm">
                          <table className="min-w-full divide-y divide-[#141414]/5 text-sm">
                            <thead className="bg-[#5A5A40]/5">
                              <tr>
                                <th scope="col" className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-wider text-[#5A5A40] w-[8%] border-r border-[#141414]/5">No</th>
                                <th scope="col" className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-[#5A5A40] w-[22%] border-r border-[#141414]/5">Kegiatan / Fase</th>
                                <th scope="col" className="px-6 py-3 text-left text-[10px] font-black uppercase tracking-wider text-[#5A5A40]">Rincian Aktivitas Pembelajaran</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#141414]/5">
                              {ma.steps?.map((step, sIdx) => (
                                <tr key={sIdx} className="hover:bg-[#5A5A40]/2 transition-colors">
                                  <td className="px-4 py-4 text-center font-mono font-bold text-[#5A5A40] border-r border-[#141414]/5 whitespace-nowrap text-xs">{sIdx + 1}</td>
                                  <td className="px-4 py-4 font-bold text-[#5A5A40] border-r border-[#141414]/5 text-xs">{step.phase}</td>
                                  <td className="px-6 py-4 text-[#141414]/80 text-xs sm:text-sm">{renderActivityTextJsx(step.activity || '')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )) : (
                      <div className="overflow-x-auto rounded-2xl border border-[#141414]/5 bg-white shadow-sm">
                        <table className="min-w-full divide-y divide-[#141414]/5 text-sm">
                          <thead className="bg-[#5A5A40]/5">
                            <tr>
                              <th scope="col" className="px-4 py-3 text-center text-[10px] font-black uppercase tracking-wider text-[#5A5A40] w-[8%] border-r border-[#141414]/5">No</th>
                              <th scope="col" className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-wider text-[#5A5A40] w-[22%] border-r border-[#141414]/5">Kegiatan / Fase</th>
                              <th scope="col" className="px-6 py-3 text-left text-[10px] font-black uppercase tracking-wider text-[#5A5A40]">Rincian Aktivitas Pembelajaran</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#141414]/5">
                            {currentModul.steps?.map((step, sIdx) => (
                              <tr key={sIdx} className="hover:bg-[#5A5A40]/2 transition-colors">
                                <td className="px-4 py-4 text-center font-mono font-bold text-[#5A5A40] border-r border-[#141414]/5 whitespace-nowrap text-xs">{sIdx + 1}</td>
                                <td className="px-4 py-4 font-bold text-[#5A5A40] border-r border-[#141414]/5 text-xs">{step.phase}</td>
                                <td className="px-6 py-4 text-[#141414]/80 text-xs sm:text-sm">{renderActivityTextJsx(step.activity || '')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </section>

                {/* Penilaian & Diferensiasi */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6">
                  <section className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#5A5A40] border-b border-[#5A5A40]/20 pb-1">IV. Asesmen</h4>
                    <p className="text-sm opacity-80 leading-relaxed bg-white p-5 rounded-2xl border border-[#141414]/5">{currentModul.assessment}</p>
                  </section>
                  <section className="space-y-3">
                    <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#5A5A40] border-b border-[#5A5A40]/20 pb-1">V. Diferensiasi</h4>
                    <p className="text-sm opacity-80 leading-relaxed bg-white p-5 rounded-2xl border border-[#141414]/5">{currentModul.differentiation}</p>
                  </section>
                </div>
              </div>

              <div className="p-8 bg-[#F5F5F0] border-t border-[#141414]/5 flex items-center justify-between">
                <p className="text-xs opacity-40">Konstruksi otomatis berdasarkan format Pembelajaran Mendalam (Deep Learning).</p>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setIsPreviewing(true)}
                    className="flex items-center gap-2 px-6 py-3 border border-[#141414]/10 rounded-xl font-bold text-sm hover:bg-[#141414]/5 transition-colors"
                  >
                    <Eye size={18} /> Preview & Cetak
                  </button>
                  <button 
                    onClick={() => setCurrentModul(null)}
                    className="px-10 py-3 bg-[#141414] text-white rounded-xl font-bold text-sm hover:bg-[#5A5A40] transition-colors shadow-xl shadow-black/10"
                  >
                    Selesai
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Modal Print Preview */}
      <AnimatePresence>
        {isPreviewing && currentModul && (
          <div className={`fixed inset-0 z-[100] flex items-center justify-center bg-[#141414]/90 backdrop-blur-md overflow-y-auto pt-20 pb-20 px-6 print-container paper-${paperSize}`}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full shadow-[0_0_50px_rgba(0,0,0,0.5)] p-[20mm] relative text-black"
              id="print-area"
              style={{
                maxWidth: paperSize === 'a4' ? '210mm' : '215mm',
                minHeight: paperSize === 'a4' ? '297mm' : '330mm',
              }}
            >
              <div className="space-y-12">
                {/* Header Dokumen */}
                <div className="text-center space-y-2 pb-8 border-b-2 border-black">
                  <h1 className="text-3xl font-black uppercase">Modul Ajar</h1>
                  <h2 className="text-xl font-bold">{currentModul.title}</h2>
                  <div className="flex justify-between pt-8 text-sm text-left">
                    <div className="space-y-1">
                      <p><span className="font-bold w-24 inline-block">Sekolah</span>: {schoolName || '................................'}</p>
                      <p><span className="font-bold w-24 inline-block">Mapel</span>: {subject || '................................'}</p>
                      <p><span className="font-bold w-24 inline-block">Kelas</span>: {phase} / {currentModul.targetStudents}</p>
                    </div>
                    <div className="space-y-1 text-right">
                      <p><span className="font-bold">Model</span>: {currentModul.model}</p>
                      <p><span className="font-bold">Durasi</span>: {currentModul.duration}</p>
                    </div>
                  </div>
                </div>

                {/* Content Sections */}
                <div className="space-y-8">
                  <section className="space-y-3">
                    <h3 className="text-lg font-bold border-b border-black pb-1 uppercase tracking-wider">I. Informasi Umum</h3>
                    <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-2">
                        <p className="font-bold text-sm uppercase text-gray-600">Dimensi Profil Lulusan:</p>
                        <ul className="list-disc list-inside pl-4 text-sm space-y-1">
                          {currentModul.ppp?.map((p, i) => <li key={i}>{p}</li>)}
                        </ul>
                      </div>
                      <div className="space-y-2">
                        <p className="font-bold text-sm uppercase text-gray-600">Sarana dan Prasarana:</p>
                        <ul className="list-disc list-inside pl-4 text-sm space-y-1">
                          {currentModul.media?.map((m, i) => <li key={i}>{m}</li>)}
                        </ul>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-4">
                    <h3 className="text-lg font-bold border-b border-black pb-1 uppercase tracking-wider">II. Komponen Inti</h3>
                    <div className="space-y-4">
                      <div>
                        <p className="font-bold text-sm uppercase text-gray-600">Tujuan Pembelajaran:</p>
                        <div className="pl-4 space-y-1 mt-1">
                          {currentModul.tpStatement?.split('\n').filter(s => s.trim()).map((s, i) => (
                            <div key={i} className="text-sm flex gap-2 items-start">
                              <span className="mt-1.5 w-1 h-1 rounded-full bg-black shrink-0" />
                              <span>{s.replace(/^[0-9.-]+\s*/, '')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="font-bold text-sm uppercase text-gray-600">Pemahaman Bermakna:</p>
                        <p className="text-sm italic pl-4">"{currentModul.meaningfulUnderstanding}"</p>
                      </div>
                      <div>
                        <p className="font-bold text-sm uppercase text-gray-600">Pertanyaan Pemantik:</p>
                        <ul className="list-disc list-inside pl-4 text-sm space-y-1">
                          {currentModul.triggerQuestions?.map((q, i) => <li key={i}>{q}</li>)}
                        </ul>
                      </div>
                    </div>
                  </section>

                  <section className="space-y-4">
                    <h3 className="text-lg font-bold border-b border-black pb-1 uppercase tracking-wider">III. Kegiatan Pembelajaran</h3>
                    <div className="space-y-6">
                      {currentModul.meetingActivities?.length ? currentModul.meetingActivities.map((ma, maIdx) => (
                        <div key={`ma-${maIdx}`} className="space-y-3">
                          <div className="bg-gray-100 p-2 rounded border border-gray-300">
                            <span className="font-bold text-sm uppercase tracking-widest">Pertemuan {ma.session}</span>
                            {ma.activityTitle && <p className="text-xs font-semibold">{ma.activityTitle}</p>}
                          </div>
                          
                          <table className="w-full border-collapse border border-black text-xs text-left">
                            <thead>
                              <tr className="bg-gray-100 font-bold border-b border-black">
                                <th className="border border-black px-3 py-2 text-center w-[8%]">No</th>
                                <th className="border border-black px-3 py-2 w-[22%]">Kegiatan / Fase</th>
                                <th className="border border-black px-3 py-2">Rincian Aktivitas Pembelajaran</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ma.steps?.map((step, sIdx) => (
                                <tr key={sIdx} className="border-b border-black">
                                  <td className="border border-black px-3 py-2 text-center font-mono">{sIdx + 1}</td>
                                  <td className="border border-black px-3 py-2 font-bold">{step.phase}</td>
                                  <td className="border border-black px-3 py-2">{renderActivityTextJsx(step.activity || '')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )) : (
                        <table className="w-full border-collapse border border-black text-xs text-left">
                          <thead>
                            <tr className="bg-gray-100 font-bold border-b border-black">
                              <th className="border border-black px-3 py-2 text-center w-[8%]">No</th>
                              <th className="border border-black px-3 py-2 w-[22%]">Kegiatan / Fase</th>
                              <th className="border border-black px-3 py-2">Rincian Aktivitas Pembelajaran</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentModul.steps?.map((step, sIdx) => (
                              <tr key={sIdx} className="border-b border-black">
                                <td className="border border-black px-3 py-2 text-center font-mono">{sIdx + 1}</td>
                                <td className="border border-black px-3 py-2 font-bold">{step.phase}</td>
                                <td className="border border-black px-3 py-2">{renderActivityTextJsx(step.activity || '')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </section>

                  <section className="space-y-4">
                    <h3 className="text-lg font-bold border-b border-black pb-1 uppercase tracking-wider">IV. Asesmen & Diferensiasi</h3>
                    <div className="grid grid-cols-1 gap-6">
                      <div>
                        <p className="font-bold text-sm uppercase text-gray-600">Asesmen:</p>
                        <p className="text-sm leading-relaxed pl-4">{currentModul.assessment}</p>
                      </div>
                      <div>
                        <p className="font-bold text-sm uppercase text-gray-600">Diferensiasi Pembelajaran:</p>
                        <p className="text-sm leading-relaxed pl-4">{currentModul.differentiation}</p>
                      </div>
                    </div>
                  </section>
                </div>

                {/* Tanda Tangan */}
                <div className="pt-20 grid grid-cols-2 gap-24">
                  <div className="text-center space-y-24">
                    <p className="text-sm">Mengetahui,<br/>Kepala Sekolah</p>
                    <div className="space-y-1">
                      <p className="text-sm font-bold underline underline-offset-4 decoration-1">{principalName || '................................'}</p>
                      <p className="text-xs opacity-60">NIP. ................................</p>
                    </div>
                  </div>
                  <div className="text-center space-y-24">
                    <p className="text-sm">Jakarta, {new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}<br/>Guru Mata Pelajaran,</p>
                    <div className="space-y-1">
                      <p className="text-sm font-bold underline underline-offset-4 decoration-1">{teacherName || '................................'}</p>
                      <p className="text-xs opacity-60">NIP. ................................</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating Controls for Preview Mode (Non-printing) */}
              <div className="fixed top-8 right-8 flex flex-col gap-3 no-print z-[110]">
                <div className="bg-white p-4 rounded-xl shadow-2xl border border-black/10 flex flex-col gap-2 mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-40 text-center">Ukuran Kertas</p>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setPaperSize('a4')}
                      className={`flex-1 px-4 py-2 rounded-lg text-xs font-bold transition-all ${paperSize === 'a4' ? 'bg-[#5A5A40] text-white' : 'bg-[#F5F5F0] hover:bg-gray-200'}`}
                    >
                      A4
                    </button>
                    <button 
                      onClick={() => setPaperSize('f4')}
                      className={`flex-1 px-4 py-2 rounded-lg text-xs font-bold transition-all ${paperSize === 'f4' ? 'bg-[#5A5A40] text-white' : 'bg-[#F5F5F0] hover:bg-gray-200'}`}
                    >
                      F4
                    </button>
                  </div>
                </div>

                <button 
                  onClick={() => setIsPreviewing(false)}
                  className="bg-white text-black px-6 py-3 rounded-xl font-bold shadow-2xl flex items-center gap-2 hover:bg-gray-100 transition-all border border-black/10"
                >
                  <Plus size={18} className="rotate-45" /> Tutup Preview
                </button>
                <button 
                  onClick={() => currentModul && handleDownloadModulDoc(currentModul)}
                  className="bg-white text-[#141414] px-5 py-3 rounded-xl font-bold shadow-2xl flex items-center gap-2 hover:bg-gray-100 transition-all border border-black/10 text-xs sm:text-sm"
                  title="Unduh Modul RPP / Ajar dalam format Word (.doc)"
                >
                  <Download size={16} /> Unduh RPP (.doc)
                </button>
                <button 
                  onClick={() => currentModul && handleDownloadLampiranLengkapDoc(currentModul)}
                  className="bg-white text-[#5A5A40] px-5 py-3 rounded-xl font-bold shadow-2xl flex items-center gap-2 hover:bg-gray-100 transition-all border border-[#5A5A40]/30 text-xs sm:text-sm"
                  title="Unduh Lampiran & Bahan Ajar Lengkap terpisah per pertemuan (.doc)"
                >
                  <Sparkles size={16} /> Unduh Lampiran (.doc)
                </button>
                <button 
                  onClick={() => {
                    window.focus();
                    window.print();
                  }}
                  className="bg-[#5A5A40] text-white px-6 py-3 rounded-xl font-bold shadow-2xl flex items-center gap-2 hover:bg-[#4A4A30] transition-all"
                >
                  <FileText size={18} /> Cetak (PDF)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Print Preview Prosem */}
      <AnimatePresence>
        {isPreviewingProsem && atp && (
          <div className={`fixed inset-0 z-[100] flex items-center justify-center bg-[#141414]/90 backdrop-blur-md overflow-y-auto pt-20 pb-20 px-6 print-container paper-${paperSize}`}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full shadow-[0_0_50px_rgba(0,0,0,0.5)] p-[20mm] relative text-black"
              id="print-area"
              style={{
                maxWidth: paperSize === 'a4' ? '210mm' : '215mm',
                minHeight: paperSize === 'a4' ? '297mm' : '330mm',
              }}
            >
              <div className="space-y-12">
                {/* Header Dokumen */}
                <div className="text-center space-y-2 pb-8 border-b-2 border-black">
                  <h1 className="text-2xl font-black uppercase">PROGRAM SEMESTER (PROSEM)</h1>
                  <h2 className="text-lg font-bold uppercase">FASE {atp.phase} - KELAS {printProsemClassLevel}</h2>
                  <div className="flex justify-between pt-8 text-sm text-left">
                    <div className="space-y-1">
                      <p><span className="font-bold w-32 inline-block">Mata Pelajaran</span>: {subject || '................................'}</p>
                      <p><span className="font-bold w-32 inline-block">Sekolah</span>: {schoolName || '................................'}</p>
                      <p><span className="font-bold w-32 inline-block">Fase</span>: {atp.phase}</p>
                    </div>
                  </div>
                </div>

                {/* Content Sections */}
                <div className="space-y-8">
                  {Array.from(new Set(atp.items.map(i => i.classLevel)))
                    .sort((a,b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
                    .filter(classLevel => printProsemClassLevel === 'all' || String(classLevel) === String(printProsemClassLevel))
                    .map(classLevel => {
                      const items = atp.items.filter(i => i.classLevel === classLevel).sort((a,b) => a.flow - b.flow);
                      const distItems = getCorrectProsemWeeks(items, parseInt(jpPerWeek) || 3, parseInt(meetingsPerWeek) || 1);
                      
                      return (
                        <div key={classLevel} className="space-y-4">
                          <table className="w-full border-collapse border border-black text-sm">
                            <thead>
                              <tr className="bg-gray-100">
                                <th className="border border-black px-3 py-2 text-center w-12 text-xs">No</th>
                                <th className="border border-black px-3 py-2 text-xs">Kegiatan / Tujuan Pembelajaran</th>
                                <th className="border border-black px-3 py-2 text-center w-16 text-xs">JP</th>
                                <th className="border border-black px-3 py-2 text-center w-40 text-xs">Alokasi Waktu</th>
                              </tr>
                            </thead>
                            <tbody>
                              {distItems.map((di, idx) => {
                                const isSem2 = di.semester === 2;
                                return (
                                  <tr key={idx}>
                                    <td className="border border-black px-3 py-2 text-center font-bold text-xs">{idx + 1}</td>
                                    <td className="border border-black px-3 py-2 text-xs">
                                      <div className="font-bold">{di.tpStatement}</div>
                                      {result?.tujuanPembelajaran.find(tp => tp.id === di.tpId)?.meetings?.map((m, mIdx) => (
                                        <div key={mIdx} className="text-[10px] text-gray-700 pl-2">• {m.activity}</div>
                                      ))}
                                    </td>
                                    <td className="border border-black px-3 py-2 text-center font-bold text-xs">{di.jp}</td>
                                    <td className="border border-black px-3 py-2 text-center text-xs">
                                      Semester {isSem2 ? 2 : 1}<br/>
                                      Minggu ke-{di.startWeek} {di.endWeek > di.startWeek ? `s.d ${di.endWeek}` : ''}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                </div>

                {/* Tanda Tangan */}
                <div className="pt-16 grid grid-cols-2 gap-24">
                  <div className="text-center space-y-20">
                    <p className="text-sm">Mengetahui,<br/>Kepala Sekolah</p>
                    <div className="space-y-1">
                      <p className="text-sm font-bold underline underline-offset-4 decoration-1">{principalName || '................................'}</p>
                      <p className="text-xs opacity-60">NIP. ................................</p>
                    </div>
                  </div>
                  <div className="text-center space-y-20">
                    <p className="text-sm">Jakarta, {new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}<br/>Guru Mata Pelajaran,</p>
                    <div className="space-y-1">
                      <p className="text-sm font-bold underline underline-offset-4 decoration-1">{teacherName || '................................'}</p>
                      <p className="text-xs opacity-60">NIP. ................................</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating Controls for Preview Mode (Non-printing) */}
              <div className="fixed top-8 right-8 flex flex-col gap-3 no-print z-[110]">
                <div className="bg-[#141414]/90 backdrop-blur-md p-4 rounded-2xl border border-white/10 text-white flex flex-col gap-2 shadow-2xl">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/50 text-center mb-1">Ukuran Kertas</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setPaperSize('a4')}
                      className={`flex-1 px-4 py-2 rounded-lg text-xs font-bold transition-all ${paperSize === 'a4' ? 'bg-[#5A5A40] text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}
                    >
                      A4
                    </button>
                    <button 
                      onClick={() => setPaperSize('f4')}
                      className={`flex-1 px-4 py-2 rounded-lg text-xs font-bold transition-all ${paperSize === 'f4' ? 'bg-[#5A5A40] text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}
                    >
                      F4
                    </button>
                  </div>
                </div>

                <button 
                  onClick={() => setIsPreviewingProsem(false)}
                  className="bg-white text-black px-6 py-3 rounded-xl font-bold shadow-2xl flex items-center gap-2 hover:bg-gray-100 transition-all border border-black/10"
                >
                  <Plus size={18} className="rotate-45" /> Tutup Preview
                </button>
                <button 
                  onClick={() => {
                    if (printProsemClassLevel === 'all') {
                      handleDownloadProsem();
                    } else {
                      handleDownloadProsemClass(printProsemClassLevel);
                    }
                  }}
                  className="bg-white text-[#141414] px-5 py-3 rounded-xl font-bold shadow-2xl flex items-center gap-2 hover:bg-gray-100 transition-all border border-black/10 text-xs sm:text-sm"
                  title="Unduh Program Semester dalam format Word (.doc)"
                >
                  <Download size={16} /> Unduh (.doc)
                </button>
                <button 
                  onClick={() => {
                    window.focus();
                    window.print();
                  }}
                  className="bg-[#5A5A40] text-white px-6 py-3 rounded-xl font-bold shadow-2xl flex items-center gap-2 hover:bg-[#4A4A30] transition-all"
                >
                  <FileText size={18} /> Cetak (PDF)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal Print Preview Lengkap */}
      <AnimatePresence>
        {isPreviewingLengkap && result && (
          <div className={`fixed inset-0 z-[100] flex items-center justify-center bg-[#141414]/90 backdrop-blur-md overflow-y-auto pt-20 pb-20 px-6 print-container paper-${paperSize}`}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full shadow-[0_0_50px_rgba(0,0,0,0.5)] p-[20mm] relative text-black"
              id="print-area"
              style={{
                maxWidth: paperSize === 'a4' ? '210mm' : '215mm',
                minHeight: paperSize === 'a4' ? '297mm' : '330mm',
              }}
            >
              <div className="space-y-12 text-left">
                {/* Cover Page */}
                <div className="text-center space-y-4 py-20 border-b-2 border-black page-break">
                  <h1 className="text-3xl font-black uppercase tracking-wider">DOKUMEN KURIKULUM LENGKAP</h1>
                  <h2 className="text-xl font-bold uppercase">FASE {phase} - KELAS {printLengkapClassLevel}</h2>
                  <div className="pt-12 max-w-md mx-auto text-left space-y-2 text-sm">
                    <p><span className="font-bold w-32 inline-block">Mata Pelajaran</span>: {subject || '................................'}</p>
                    <p><span className="font-bold w-32 inline-block">Sekolah</span>: {schoolName || '................................'}</p>
                    <p><span className="font-bold w-32 inline-block">Penyusun</span>: {teacherName || '................................'}</p>
                  </div>
                </div>

                {/* 1. Pemetaan TP */}
                <div className="space-y-6 pt-8 page-break">
                  <div className="text-center space-y-1">
                    <h2 className="text-xl font-black uppercase">PEMETAAN TUJUAN PEMBELAJARAN</h2>
                    <h3 className="text-sm font-bold opacity-80 uppercase">FASE {phase} - KELAS {printLengkapClassLevel}</h3>
                  </div>
                  <div className="space-y-4">
                    <p className="text-xs"><b>Sekolah:</b> {schoolName || '................................'}</p>
                    <p className="text-xs"><b>Mata Pelajaran:</b> {subject || '................................'}</p>
                    <p className="text-xs"><b>Ringkasan CP:</b> {result.cpPerClass?.[printLengkapClassLevel] || '................................'}</p>
                    
                    <table className="w-full border-collapse border border-black text-xs text-left">
                      <thead>
                        <tr className="bg-gray-100">
                          <th className="border border-black px-3 py-2 font-bold w-[50%]">Tujuan Pembelajaran</th>
                          <th className="border border-black px-3 py-2 font-bold w-[50%]">KKTP (Kriteria Ketercapaian)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(result.tujuanPembelajaran?.filter(tp => String(tp.classLevel) === String(printLengkapClassLevel)) || []).map((tp, idx) => (
                          <tr key={idx}>
                            <td className="border border-black px-3 py-2">{tp.statement}</td>
                            <td className="border border-black px-3 py-2">
                              <div className="space-y-1">
                                {tp.kktp?.map((k, kIdx) => (
                                  <div key={kIdx}>
                                    {renderKKTPWithBloomBadgeJsx(k)}
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 2. ATP */}
                {atp && (
                  <div className="space-y-6 pt-12 page-break">
                    <div className="text-center space-y-1">
                      <h2 className="text-xl font-black uppercase">ALUR TUJUAN PEMBELAJARAN (ATP)</h2>
                      <h3 className="text-sm font-bold opacity-80 uppercase">FASE {phase} - KELAS {printLengkapClassLevel}</h3>
                    </div>
                    <div className="space-y-4">
                      <p className="text-xs"><b>Rasionalisasi:</b> {atp.rationale}</p>
                      
                      <table className="w-full border-collapse border border-black text-[10px] text-left">
                        <thead>
                          <tr className="bg-gray-100 font-bold text-center">
                            <th className="border border-black px-2 py-1 w-8">No</th>
                            <th className="border border-black px-2 py-1 w-24">CP</th>
                            <th className="border border-black px-2 py-1">Tujuan Pembelajaran</th>
                            <th className="border border-black px-2 py-1 w-32">Materi / KKTP</th>
                            <th className="border border-black px-2 py-1 w-16">JP</th>
                            <th className="border border-black px-2 py-1 w-24">Asesmen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {atp.items
                            .filter(item => String(item.classLevel) === String(printLengkapClassLevel))
                            .sort((a,b) => a.flow - b.flow)
                            .map((item, index) => (
                              <tr key={index}>
                                <td className="border border-black px-2 py-1 text-center font-bold">{index + 1}</td>
                                <td className="border border-black px-2 py-1">{item.cp}</td>
                                <td className="border border-black px-2 py-1 font-bold">{item.tpStatement}</td>
                                <td className="border border-black px-2 py-1">
                                  <b>Materi:</b> {item.content}<br/>
                                  <div className="mt-1">
                                    <b>KKTP:</b>
                                    <div className="space-y-1 mt-0.5">
                                      {item.kktp?.map((k, kIdx) => (
                                        <div key={kIdx}>
                                          {renderKKTPWithBloomBadgeJsx(k)}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </td>
                                <td className="border border-black px-2 py-1 text-center">{item.jp} JP ({item.numberOfMeetings} Sesi)</td>
                                <td className="border border-black px-2 py-1">{item.assessment}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 3. Prota */}
                {atp && (
                  <div className="space-y-6 pt-12 page-break">
                    <div className="text-center space-y-1">
                      <h2 className="text-xl font-black uppercase">PROGRAM TAHUNAN (PROTA)</h2>
                      <h3 className="text-sm font-bold opacity-80 uppercase">FASE {phase} - KELAS {printLengkapClassLevel}</h3>
                    </div>
                    <div className="space-y-4">
                      {(() => {
                        const items = atp.items.filter(i => String(i.classLevel) === String(printLengkapClassLevel)).sort((a,b) => a.flow - b.flow);
                        const sem1 = items.filter(i => i.semester === 1);
                        const sem2 = items.filter(i => i.semester === 2);
                        return (
                          <table className="w-full border-collapse border border-black text-xs text-left">
                            <thead>
                              <tr className="bg-gray-100 font-bold text-center">
                                <th className="border border-black px-3 py-2 w-24">Semester</th>
                                <th className="border border-black px-3 py-2">Tujuan Pembelajaran</th>
                                <th className="border border-black px-3 py-2 w-24">Alokasi Waktu</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td rowSpan={Math.max(sem1.length, 1)} className="border border-black px-3 py-2 text-center font-bold">I (Ganjil)</td>
                                {sem1.length > 0 ? (
                                  <>
                                    <td className="border border-black px-3 py-2">{sem1[0].tpStatement}</td>
                                    <td className="border border-black px-3 py-2 text-center font-bold">{sem1[0].jp} JP</td>
                                  </>
                                ) : (
                                  <td colSpan={2} className="border border-black px-3 py-2 text-center text-gray-400">Belum ada data</td>
                                )}
                              </tr>
                              {sem1.slice(1).map((item, idx) => (
                                <tr key={`sem1-${idx}`}>
                                  <td className="border border-black px-3 py-2">{item.tpStatement}</td>
                                  <td className="border border-black px-3 py-2 text-center font-bold">{item.jp} JP</td>
                                </tr>
                              ))}
                              <tr>
                                <td rowSpan={Math.max(sem2.length, 1)} className="border border-black px-3 py-2 text-center font-bold">II (Genap)</td>
                                {sem2.length > 0 ? (
                                  <>
                                    <td className="border border-black px-3 py-2">{sem2[0].tpStatement}</td>
                                    <td className="border border-black px-3 py-2 text-center font-bold">{sem2[0].jp} JP</td>
                                  </>
                                ) : (
                                  <td colSpan={2} className="border border-black px-3 py-2 text-center text-gray-400">Belum ada data</td>
                                )}
                              </tr>
                              {sem2.slice(1).map((item, idx) => (
                                <tr key={`sem2-${idx}`}>
                                  <td className="border border-black px-3 py-2">{item.tpStatement}</td>
                                  <td className="border border-black px-3 py-2 text-center font-bold">{item.jp} JP</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* 4. Prosem */}
                {atp && (
                  <div className="space-y-6 pt-12 page-break">
                    <div className="text-center space-y-1">
                      <h2 className="text-xl font-black uppercase">PROGRAM SEMESTER (PROSEM)</h2>
                      <h3 className="text-sm font-bold opacity-80 uppercase">FASE {phase} - KELAS {printLengkapClassLevel}</h3>
                    </div>
                    <div className="space-y-4">
                      {(() => {
                        const items = atp.items.filter(i => String(i.classLevel) === String(printLengkapClassLevel)).sort((a,b) => a.flow - b.flow);
                        const distItems = getCorrectProsemWeeks(items, parseInt(jpPerWeek) || 3, parseInt(meetingsPerWeek) || 1);
                        return (
                          <table className="w-full border-collapse border border-black text-xs text-left">
                            <thead>
                              <tr className="bg-gray-100 font-bold text-center">
                                <th className="border border-black px-3 py-2 w-12">No</th>
                                <th className="border border-black px-3 py-2">Capaian / Tujuan Pembelajaran</th>
                                <th className="border border-black px-3 py-2 w-16">JP</th>
                                <th className="border border-black px-3 py-2 w-40">Alokasi Waktu</th>
                              </tr>
                            </thead>
                            <tbody>
                              {distItems.map((di, idx) => (
                                <tr key={idx}>
                                  <td className="border border-black px-3 py-2 text-center font-bold">{idx + 1}</td>
                                  <td className="border border-black px-3 py-2">{di.tpStatement}</td>
                                  <td className="border border-black px-3 py-2 text-center font-bold">{di.jp}</td>
                                  <td className="border border-black px-3 py-2 text-center">
                                    Semester {di.semester}<br/>
                                    Minggu ke-{di.startWeek} {di.endWeek > di.startWeek ? `s.d ${di.endWeek}` : ''}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        );
                      })()}
                    </div>
                  </div>
                )}

                {/* 5. Modul Ajar (RPP) */}
                {atp && (
                  <div className="space-y-12 pt-12">
                    {atp.items
                      .filter(item => String(item.classLevel) === String(printLengkapClassLevel) && modules[item.tpId])
                      .map((item, modIdx) => {
                        const mod = modules[item.tpId];
                        const meetings = mod.meetingActivities?.length ? mod.meetingActivities : [{
                          session: 1,
                          activityTitle: "Semua Sesi",
                          steps: mod.steps || []
                        }];

                        return (
                          <div key={modIdx} className="space-y-8 page-break">
                            <div className="text-center space-y-1 pb-4 border-b border-black">
                              <h2 className="text-xl font-black uppercase">MODUL AJAR (RPP) - {mod.title.toUpperCase()}</h2>
                              <p className="text-xs">Mata Pelajaran: {subject}</p>
                            </div>
                            
                            <table className="w-full text-xs text-left border-none">
                              <tbody>
                                <tr>
                                  <td className="border-none py-1 font-bold w-32">Nama Sekolah</td>
                                  <td className="border-none py-1">: {schoolName || '................................'}</td>
                                </tr>
                                <tr>
                                  <td className="border-none py-1 font-bold">Fase / Kelas</td>
                                  <td className="border-none py-1">: {phase} / {mod?.targetStudents || item.classLevel}</td>
                                </tr>
                                <tr>
                                  <td className="border-none py-1 font-bold">Model Pembelajaran</td>
                                  <td className="border-none py-1">: {mod?.model || '................................'}</td>
                                </tr>
                              </tbody>
                            </table>

                            <div className="space-y-4">
                              <div>
                                <h4 className="font-bold text-xs uppercase border-b border-black pb-1 mb-2">I. Informasi Umum</h4>
                                <p className="text-xs"><b>Profil Pelajar Pancasila:</b> {mod?.ppp?.join(', ') || 'Mandiri, Bernalar Kritis, Kreatif'}</p>
                                <p className="text-xs mt-1"><b>Sarana & Prasarana:</b> {mod?.media?.join(', ') || 'Buku Paket, Laptop, Papan Tulis'}</p>
                              </div>
                              <div>
                                <h4 className="font-bold text-xs uppercase border-b border-black pb-1 mb-2">II. Komponen Inti</h4>
                                <p className="text-xs"><b>Tujuan Pembelajaran:</b> {item.tpStatement}</p>
                                <p className="text-xs mt-1"><b>Pemahaman Bermakna:</b> {mod?.meaningfulUnderstanding || 'Siswa dapat mengaplikasikan pembelajaran ini dalam kehidupan sehari-hari.'}</p>
                              </div>
                              <div>
                                <h4 className="font-bold text-xs uppercase border-b border-black pb-1 mb-2">III. Kegiatan Pembelajaran</h4>
                                <div className="space-y-4">
                                  {meetings.map((ma, sIdx) => (
                                    <div key={sIdx} className="space-y-2">
                                      <p className="text-xs font-bold bg-gray-100 p-1.5 border border-black inline-block">Pertemuan {ma.session}: {ma.activityTitle || 'Kegiatan Inti'}</p>
                                      <table className="w-full border-collapse border border-black text-[10px] text-left">
                                        <thead>
                                          <tr className="bg-gray-50">
                                            <th className="border border-black px-2 py-1 w-10 text-center">Sesi</th>
                                            <th className="border border-black px-2 py-1 w-24">Fase</th>
                                            <th className="border border-black px-2 py-1">Langkah Kegiatan</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {ma.steps?.map((step, stepIdx) => (
                                            <tr key={stepIdx}>
                                              <td className="border border-black px-2 py-1 text-center">{stepIdx + 1}</td>
                                              <td className="border border-black px-2 py-1 font-bold">{step.phase}</td>
                                              <td className="border border-black px-2 py-1">{step.activity}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}

                {/* 6. Jurnal Mengajar */}
                {atp && (
                  <div className="space-y-6 pt-12 page-break">
                    <div className="text-center space-y-1">
                      <h2 className="text-xl font-black uppercase">JURNAL MENGAJAR GURU</h2>
                      <h3 className="text-sm font-bold opacity-80 uppercase">FASE {phase} - KELAS {printLengkapClassLevel}</h3>
                    </div>
                    <div className="space-y-4">
                      <table className="w-full border-collapse border border-black text-[10px] text-left">
                        <thead>
                          <tr className="bg-gray-100 font-bold text-center">
                            <th className="border border-black px-2 py-1 w-8">No</th>
                            <th className="border border-black px-2 py-1 w-20">Tanggal</th>
                            <th className="border border-black px-2 py-1">Topik / Modul</th>
                            <th className="border border-black px-2 py-1">Tujuan Pembelajaran</th>
                            <th className="border border-black px-2 py-1 w-24">Kehadiran</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            let counter = 1;
                            const currentClassItems = atp.items.filter(item => String(item.classLevel) === String(printLengkapClassLevel));
                            return currentClassItems.map((item, idx) => {
                              const mod = modules[item.tpId];
                              return (
                                <tr key={idx}>
                                  <td className="border border-black px-2 py-1 text-center">{counter++}</td>
                                  <td className="border border-black px-2 py-1"></td>
                                  <td className="border border-black px-2 py-1 font-bold">{mod?.title || 'Pembelajaran TP'}</td>
                                  <td className="border border-black px-2 py-1">{item.tpStatement}</td>
                                  <td className="border border-black px-2 py-1"></td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Tanda Tangan */}
                <div className="pt-16 grid grid-cols-2 gap-24 page-break-inside-avoid">
                  <div className="text-center space-y-20">
                    <p className="text-sm">Mengetahui,<br/>Kepala Sekolah</p>
                    <div className="space-y-1">
                      <p className="text-sm font-bold underline underline-offset-4 decoration-1">{principalName || '................................'}</p>
                      <p className="text-xs opacity-60">NIP. ................................</p>
                    </div>
                  </div>
                  <div className="text-center space-y-20">
                    <p className="text-sm">Jakarta, {new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}<br/>Guru Mata Pelajaran,</p>
                    <div className="space-y-1">
                      <p className="text-sm font-bold underline underline-offset-4 decoration-1">{teacherName || '................................'}</p>
                      <p className="text-xs opacity-60">NIP. ................................</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Floating Controls for Preview Mode (Non-printing) */}
              <div className="fixed top-8 right-8 flex flex-col gap-3 no-print z-[110]">
                <div className="bg-[#141414]/90 backdrop-blur-md p-4 rounded-2xl border border-white/10 text-white flex flex-col gap-2 shadow-2xl">
                  <span className="text-[10px] font-black uppercase tracking-widest text-white/50 text-center mb-1">Ukuran Kertas</span>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setPaperSize('a4')}
                      className={`flex-1 px-4 py-2 rounded-lg text-xs font-bold transition-all ${paperSize === 'a4' ? 'bg-[#5A5A40] text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}
                    >
                      A4
                    </button>
                    <button 
                      onClick={() => setPaperSize('f4')}
                      className={`flex-1 px-4 py-2 rounded-lg text-xs font-bold transition-all ${paperSize === 'f4' ? 'bg-[#5A5A40] text-white' : 'bg-white/10 hover:bg-white/20 text-white'}`}
                    >
                      F4
                    </button>
                  </div>
                </div>

                <button 
                  onClick={() => setIsPreviewingLengkap(false)}
                  className="bg-white text-black px-6 py-3 rounded-xl font-bold shadow-2xl flex items-center gap-2 hover:bg-gray-100 transition-all border border-black/10"
                >
                  <Plus size={18} className="rotate-45" /> Tutup Preview
                </button>
                <button 
                  onClick={() => handleDownloadLengkapClass(printLengkapClassLevel)}
                  className="bg-white text-[#141414] px-5 py-3 rounded-xl font-bold shadow-2xl flex items-center gap-2 hover:bg-gray-100 transition-all border border-black/10 text-xs sm:text-sm"
                  title="Unduh Dokumen Lengkap (.doc)"
                >
                  <Download size={16} /> Unduh (.doc)
                </button>
                <button 
                  onClick={() => {
                    window.focus();
                    window.print();
                  }}
                  className="bg-[#5A5A40] text-white px-6 py-3 rounded-xl font-bold shadow-2xl flex items-center gap-2 hover:bg-[#4A4A30] transition-all"
                >
                  <FileText size={18} /> Cetak (PDF)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPanduan && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPanduan(false)}
              className="absolute inset-0 bg-[#141414]/60 backdrop-blur-md" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl relative overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-8 border-b border-[#141414]/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#5A5A40]/10 rounded-xl flex items-center justify-center text-[#5A5A40]">
                    <BookOpen size={20} />
                  </div>
                  <h3 className="font-bold text-lg">Panduan Penggunaan</h3>
                </div>
                <button 
                  onClick={() => setShowPanduan(false)}
                  className="w-10 h-10 rounded-full hover:bg-[#141414]/5 flex items-center justify-center transition-colors"
                >
                  <Plus size={24} className="rotate-45" />
                </button>
              </div>
              <div className="p-8 overflow-y-auto">
                <div className="space-y-6">
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#5A5A40] text-white flex items-center justify-center font-bold shrink-0">1</div>
                    <p className="text-sm"><strong>Masuk Akun:</strong> Gunakan akun Google Anda untuk mengakses aplikasi.</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#5A5A40] text-white flex items-center justify-center font-bold shrink-0">2</div>
                    <p className="text-sm"><strong>Identitas Dokumen:</strong> Isi data sekolah, mata pelajaran, dan nama guru untuk keperluan format dokumen.</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#5A5A40] text-white flex items-center justify-center font-bold shrink-0">3</div>
                    <p className="text-sm"><strong>Input Teks CP:</strong> Tempelkan teks Capaian Pembelajaran (CP) dari dokumen kurikulum resmi.</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#5A5A40] text-white flex items-center justify-center font-bold shrink-0">4</div>
                    <p className="text-sm"><strong>Pilih Fase & Kelas:</strong> Tentukan Fase (A-F) dan kelas yang ingin dipetakan Tujuannya.</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#5A5A40] text-white flex items-center justify-center font-bold shrink-0">5</div>
                    <p className="text-sm"><strong>Hasilkan TP:</strong> Klik tombol "Hasilkan TP Otomatis". AI akan membantu merumuskan Tujuan Pembelajaran dan Kriteria Ketercapaian (KKTP).</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#5A5A40] text-white flex items-center justify-center font-bold shrink-0">6</div>
                    <p className="text-sm"><strong>Susun Dokumen (ATP, Prota, Prosem):</strong> Lewati tahap secara berurutan mulai dari mengurutkan TP di ATP, membuat Program Tahunan, dan memetakan ke Program Semester.</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#5A5A40] text-white flex items-center justify-center font-bold shrink-0">7</div>
                    <p className="text-sm"><strong>Buat Modul Ajar (Smart AI Bulk):</strong> Pada menu Modul Ajar, Anda bisa membuat RPP/Modul per pertemuan beserta materi, LKPD, soal, dan rubrik asesmen lengkap.</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#5A5A40] text-white flex items-center justify-center font-bold shrink-0">8</div>
                    <p className="text-sm"><strong>Jurnal Mengajar:</strong> Aplikasi akan otomatis men-generate catatan jurnal kelas berdasarkan pertemuan modul yang telah disusun.</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#5A5A40] text-white flex items-center justify-center font-bold shrink-0">9</div>
                    <p className="text-sm"><strong>Simpan/Cetak:</strong> Tiap bagian dokumen dapat langsung disalin ke Word atau diunduh lengkap menjadi <em>.doc</em> secara otomatis.</p>
                  </div>
                  <div className="bg-red-50 p-4 rounded-xl border border-red-100">
                    <p className="text-xs text-red-700 font-bold mb-1 italic">PENTING: Batas Penggunaan AI</p>
                    <p className="text-[10px] text-red-600 leading-relaxed">
                      Aplikasi ini menggunakan layanan AI gratis dengan kuota terbatas per menit dan per hari. Jika Anda mendapatkan pesan "Kuota Penuh", harap <strong>tunggu sekitar 15-30 detik</strong> sebelum mencoba kembali.
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-6 bg-[#F5F5F0] border-t border-[#141414]/5 flex justify-end">
                <button 
                  onClick={() => setShowPanduan(false)}
                  className="bg-[#141414] text-white px-8 py-2.5 rounded-xl font-bold hover:bg-[#5A5A40] transition-colors"
                >
                  Dimengerti
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTentang && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowTentang(false)}
              className="absolute inset-0 bg-[#141414]/60 backdrop-blur-md" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-lg rounded-3xl shadow-2xl relative overflow-hidden p-8 text-center"
            >
              <div className="w-20 h-20 bg-[#5A5A40] rounded-[32px] mx-auto mb-6 flex items-center justify-center text-white shadow-xl shadow-[#5A5A40]/30 rotate-3">
                <Sparkles size={40} />
              </div>
              <h3 className="text-2xl font-black mb-4">Tentang Kurikulum AI</h3>
              <div className="space-y-4 text-sm leading-relaxed opacity-70">
                <p>
                  <strong>Kurikulum AI: Pemeta CP & TP</strong> adalah platform cerdas yang dirancang untuk mendukung para pendidik di Indonesia dalam mengimplementasikan <strong>Kurikulum Merdeka</strong> dengan lebih efisien.
                </p>
                <p>
                  Aplikasi ini dikembangkan oleh <strong>Jently F. Tamailang</strong> berkolaborasi dengan teknologi kecerdasan buatan (Prompt Engineering AI) untuk membantu guru menerjemahkan Capaian Pembelajaran (CP) yang kompleks menjadi tujuan operasional.
                </p>
                <p>
                  Fitur utama kami meliputi: pemetaan TP & ATP, penyusunan KKTP merespon CP terbaru, otomatisasi penyusunan Prota & Prosem, generator massal (Smart AI Bulk) Modul Ajar Pembelajaran Mendalam berserta detail lampiran materi, rubrik dan asesmen, dan rekap otomatisasi Jurnal Mengajar.
                </p>
                <div className="bg-[#141414]/5 p-4 rounded-2xl italic">
                  "Membantu guru mengurangi beban administrasi, agar lebih fokus pada menginspirasi siswa."
                </div>
              </div>
              <button 
                onClick={() => setShowTentang(false)}
                className="mt-8 w-full bg-[#141414] text-white py-4 rounded-2xl font-bold hover:bg-[#5A5A40] transition-all active:scale-95 shadow-xl shadow-black/10"
              >
                Tutup
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showExamples && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowExamples(false)}
              className="absolute inset-0 bg-[#141414]/60 backdrop-blur-md" 
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-[#F5F5F0] w-full max-w-3xl rounded-[40px] shadow-2xl relative overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-8 pb-4 flex items-center justify-between">
                <h3 className="text-2xl font-black">Contoh Capaian Pembelajaran</h3>
                <button 
                  onClick={() => setShowExamples(false)}
                  className="w-12 h-12 rounded-full bg-white flex items-center justify-center hover:bg-red-50 hover:text-red-500 transition-colors shadow-sm"
                >
                  <Plus size={24} className="rotate-45" />
                </button>
              </div>
              <div className="p-8 pt-0 overflow-y-auto space-y-4">
                {CP_EXAMPLES.map((example, idx) => (
                  <div key={idx} className="bg-white p-6 rounded-3xl border border-[#141414]/5 hover:border-[#5A5A40]/30 transition-all group">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <span className="text-[10px] uppercase tracking-widest font-bold bg-[#5A5A40]/10 text-[#5A5A40] px-3 py-1 rounded-full mb-1 inline-block">
                          {example.mapel}
                        </span>
                        <h4 className="font-bold text-sm">Fase {example.fase}</h4>
                      </div>
                      <button 
                        onClick={() => {
                          setCpText(example.teks);
                          setShowExamples(false);
                          // Extract phase letter from string like "A (Kelas 1-2)"
                          const phaseLetter = example.fase.charAt(0) as Phase;
                          if (['A', 'B', 'C', 'D', 'E', 'F'].includes(phaseLetter)) {
                            setPhase(phaseLetter);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 bg-[#5A5A40] text-white px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2"
                      >
                        Gunakan Contoh <MousePointer2 size={12} />
                      </button>
                    </div>
                    <p className="text-xs opacity-60 leading-relaxed text-left line-clamp-3 group-hover:line-clamp-none transition-all">
                      {example.teks}
                    </p>
                  </div>
                ))}
                <div className="bg-[#5A5A40]/5 p-6 rounded-3xl border border-dashed border-[#5A5A40]/20 text-center">
                  <p className="text-xs opacity-60">Pilih salah satu contoh di atas untuk mengisi kolom CP secara otomatis.</p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className={`fixed bottom-6 right-6 z-[200] max-w-md p-4 rounded-2xl shadow-xl flex items-center gap-3 border text-sm ${
              toast.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : toast.type === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-white border-[#141414]/10 text-gray-900'
            }`}
          >
            <div className="flex-1 font-medium">{toast.message}</div>
            <button
              onClick={() => setToast(null)}
              className="p-1 hover:bg-[#141414]/5 rounded-lg opacity-50 hover:opacity-100 transition-all text-[#141414]"
            >
              <Plus size={16} className="rotate-45" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Confirmation Dialog */}
      <AnimatePresence>
        {confirmDialog && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#141414]/60 backdrop-blur-sm px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-6 max-w-sm w-full border border-[#141414]/10 shadow-2xl space-y-4 text-center"
            >
              <div className="space-y-2">
                <h3 className="font-bold text-base text-gray-900">Konfirmasi Tindakan</h3>
                <p className="text-xs opacity-70 leading-relaxed text-justify">{confirmDialog.message}</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setConfirmDialog(null)}
                  className="flex-1 py-2.5 rounded-xl border border-[#141414]/10 text-xs font-bold hover:bg-[#141414]/5 transition-colors"
                >
                  Batal
                </button>
                <button
                  onClick={() => {
                    confirmDialog.onConfirm();
                    setConfirmDialog(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors"
                >
                  Ya, Lanjutkan
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
