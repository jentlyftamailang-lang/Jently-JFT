import React, { useState } from 'react';
import { generateInfographic } from '../services/openai';
import { InfographicData, ModulAjar } from '../types';
import { InfographicView } from './InfographicView';
import { 
  Sparkles, 
  BookOpen, 
  Sparkle, 
  Layers, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRight, 
  FileText,
  Lightbulb
} from 'lucide-react';

interface InfographicGeneratorProps {
  savedModules?: ModulAjar[];
  onTriggerAlert?: (msg: string, type: 'success' | 'error' | 'info') => void;
  initialTitle?: string;
}

const SAMPLE_TOPICS = [
  "Perdagangan Antar Pulau",
  "Interaksi Sosial",
  "Kelangkaan dan Kebutuhan Manusia",
  "Jenis-Jenis Peta",
  "Dinamika Penduduk Indonesia",
  "Perubahan Sosial",
  "Kegiatan Ekonomi",
  "Keragaman Budaya Indonesia"
];

export const InfographicGenerator: React.FC<InfographicGeneratorProps> = ({
  savedModules = [],
  onTriggerAlert,
  initialTitle = ''
}) => {
  const [topicTitle, setTopicTitle] = useState(initialTitle);
  const [selectedModulIndex, setSelectedModulIndex] = useState<number | null>(null);
  const [jenjang, setJenjang] = useState<'SD' | 'SMP' | 'SMA/SMK'>('SMP');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infographic, setInfographic] = useState<InfographicData | null>(null);

  const selectedModul = selectedModulIndex !== null && savedModules[selectedModulIndex] ? savedModules[selectedModulIndex] : null;

  const handleSelectModul = (idxStr: string) => {
    if (idxStr === '') {
      setSelectedModulIndex(null);
      return;
    }
    const idx = parseInt(idxStr, 10);
    if (!isNaN(idx) && savedModules[idx]) {
      const modul = savedModules[idx];
      setSelectedModulIndex(idx);
      setTopicTitle(modul.title || modul.tpStatement);
    }
  };

  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!topicTitle.trim()) {
      if (onTriggerAlert) onTriggerAlert("Masukkan judul materi pembelajaran terlebih dahulu.", "error");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const contextDetails = selectedModul ? {
        tpStatement: selectedModul.tpStatement,
        kktpItems: selectedModul.kktp,
        meaningfulUnderstanding: selectedModul.meaningfulUnderstanding
      } : undefined;

      const result = await generateInfographic(topicTitle.trim(), jenjang, contextDetails);
      setInfographic(result);
      if (onTriggerAlert) {
        onTriggerAlert(`Infografis "${topicTitle}" berhasil dibuat dan disinkronkan!`, "success");
      }
    } catch (err: any) {
      console.error("Error generating infographic:", err);
      const msg = err.message || "Gagal membuat infografis pembelajaran. Silakan coba lagi.";
      setError(msg);
      if (onTriggerAlert) onTriggerAlert(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-teal-900 via-[#0f766e] to-indigo-900 text-white p-8 sm:p-10 rounded-3xl shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-teal-400/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full text-xs font-bold text-teal-200 border border-white/10">
            <Sparkles size={14} className="text-amber-300" />
            <span>FITUR BARU OTOMATIS AI</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Pembuat Infografis Pembelajaran Otomatis
          </h1>

          <p className="text-teal-100 text-sm sm:text-base max-w-2xl leading-relaxed opacity-90">
            Pilih Modul Ajar atau masukkan judul materi. AI akan menyusun infografis visual yang <strong>100% SINKRON</strong> dengan Tujuan Pembelajaran (TP) & Kriteria Ketercapaian (KKTP).
          </p>
        </div>
      </div>

      {/* Main Form Input Section */}
      <div className="bg-white p-6 sm:p-8 rounded-3xl border border-gray-200 shadow-sm space-y-6">
        <form onSubmit={handleGenerate} className="space-y-6">
          
          {/* Main Title Input Field */}
          <div className="space-y-2">
            <label className="text-sm font-extrabold text-gray-800 flex items-center justify-between">
              <span className="flex items-center gap-2">
                <BookOpen size={16} className="text-[#0f766e]" />
                <span>MASUKKAN JUDUL MATERI PEMBELAJARAN *</span>
              </span>
              <span className="text-xs text-gray-400 font-normal">Contoh: Perdagangan Antar Pulau</span>
            </label>

            <div className="relative">
              <input
                type="text"
                placeholder="Ketikkan judul materi pembelajaran di sini... (misal: Interaksi Sosial)"
                value={topicTitle}
                onChange={e => {
                  setTopicTitle(e.target.value);
                  if (selectedModul && e.target.value !== (selectedModul.title || selectedModul.tpStatement)) {
                    setSelectedModulIndex(null);
                  }
                }}
                className="w-full px-5 py-4 text-base font-semibold bg-gray-50 border-2 border-gray-200 hover:border-gray-300 focus:border-[#0f766e] focus:bg-white rounded-2xl outline-none transition-all text-gray-800 placeholder-gray-400 shadow-inner"
              />
              {topicTitle && (
                <button
                  type="button"
                  onClick={() => {
                    setTopicTitle('');
                    setSelectedModulIndex(null);
                  }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400 hover:text-gray-600 bg-gray-200 hover:bg-gray-300 px-2.5 py-1 rounded-lg transition-colors"
                >
                  Hapus
                </button>
              )}
            </div>
          </div>

          {/* Sync from Modul Ajar Dropdown */}
          {savedModules && savedModules.length > 0 && (
            <div className="p-4 bg-teal-50/80 rounded-2xl border border-teal-200 space-y-3">
              <label className="text-xs font-bold text-[#0f766e] flex items-center gap-2">
                <FileText size={15} />
                <span>Singkronkan dengan Modul Ajar Saya (Sangat Direkomendasikan):</span>
              </label>
              <select
                value={selectedModulIndex !== null ? selectedModulIndex : ''}
                onChange={e => handleSelectModul(e.target.value)}
                className="w-full px-4 py-2.5 text-xs font-medium bg-white border border-teal-300 rounded-xl focus:ring-2 focus:ring-[#0f766e] outline-none text-gray-800 shadow-sm"
              >
                <option value="">-- Pilih Modul Ajar untuk Disinkronkan --</option>
                {savedModules.map((m, idx) => (
                  <option key={idx} value={idx}>
                    📌 {m.title || 'Modul Ajar'} — {m.tpStatement?.substring(0, 70)}...
                  </option>
                ))}
              </select>

              {/* Modul Ajar Details Sync Banner */}
              {selectedModul && (
                <div className="p-4 bg-white rounded-xl border border-teal-200 text-xs space-y-2 animate-fadeIn shadow-xs">
                  <div className="flex items-center gap-2 text-[#0f766e] font-extrabold uppercase tracking-wider text-[11px]">
                    <CheckCircle2 size={15} className="text-emerald-600" />
                    <span>Materi Disinkronkan Dengan Modul Ajar</span>
                  </div>
                  <div className="text-gray-800 space-y-1">
                    <p><strong>Tujuan Pembelajaran (TP):</strong> {selectedModul.tpStatement}</p>
                    {selectedModul.kktp && selectedModul.kktp.length > 0 && (
                      <div>
                        <strong>Kriteria Ketercapaian (KKTP):</strong>
                        <ul className="list-disc list-inside mt-1 space-y-0.5 text-gray-700">
                          {selectedModul.kktp.map((k, kIdx) => (
                            <li key={kIdx}>{k}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Quick Example Chips */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-500 flex items-center gap-1.5">
              <Lightbulb size={13} className="text-amber-500" />
              <span>Contoh Judul Materi Pembelajaran Populer (Klik untuk Mengisi):</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_TOPICS.map((topic, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setTopicTitle(topic)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
                    topicTitle === topic
                      ? 'bg-[#0f766e] text-white border-[#0f766e] shadow-sm font-bold'
                      : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-200'
                  }`}
                >
                  {topic}
                </button>
              ))}
            </div>
          </div>

          {/* Grade Level Selector (Jenjang) */}
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <label className="text-xs font-bold text-gray-700 block">
              Pilih Jenjang Pendidikan (Default: SMP):
            </label>
            <div className="grid grid-cols-3 gap-3 max-w-md">
              {(['SD', 'SMP', 'SMA/SMK'] as const).map(j => (
                <button
                  key={j}
                  type="button"
                  onClick={() => setJenjang(j)}
                  className={`py-3 px-4 rounded-xl text-xs font-extrabold border flex items-center justify-center gap-2 transition-all ${
                    jenjang === j
                      ? 'bg-teal-50 border-[#0f766e] text-[#0f766e] shadow-sm ring-2 ring-[#0f766e]/20'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Layers size={14} />
                  <span>{j}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Submit Action Button */}
          <div className="pt-4 flex justify-end">
            <button
              type="submit"
              disabled={loading || !topicTitle.trim()}
              className="w-full sm:w-auto px-8 py-4 bg-[#0f766e] hover:bg-[#0d5e58] text-white rounded-2xl font-black text-sm transition-all shadow-lg shadow-[#0f766e]/25 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin text-teal-200" />
                  <span>AI SEDANG MENYUSUN INFOGRAFIS...</span>
                </>
              ) : (
                <>
                  <Sparkles size={18} className="text-amber-300 group-hover:rotate-12 transition-transform" />
                  <span>BUAT INFOGRAFIS PEMBELAJARAN</span>
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </div>
        </form>

        {/* Error Alert */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs flex items-center gap-3">
            <AlertCircle size={18} className="shrink-0 text-red-500" />
            <p>{error}</p>
          </div>
        )}
      </div>

      {/* Infographic View Result */}
      {infographic && (
        <div className="pt-4 animate-fadeIn">
          <InfographicView
            data={infographic}
            onRegenerate={() => handleGenerate()}
            onUpdateData={updated => setInfographic(updated)}
            loading={loading}
          />
        </div>
      )}
    </div>
  );
};
