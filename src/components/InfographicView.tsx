import React, { useState, useRef } from 'react';
import { 
  InfographicData, 
  InfographicSection, 
  InteractiveQuizQuestion 
} from '../types';
import { 
  Sparkles, 
  BookOpen, 
  Lightbulb, 
  HelpCircle, 
  CheckCircle2, 
  XCircle, 
  Layers, 
  Download, 
  Printer, 
  Share2, 
  Edit3, 
  RotateCcw, 
  Monitor, 
  FileText, 
  Layout, 
  ChevronRight, 
  ChevronLeft, 
  Info, 
  Globe, 
  TrendingUp, 
  Users, 
  History, 
  MapPin, 
  Compass, 
  Check, 
  Copy, 
  Zap, 
  Eye, 
  Save, 
  X,
  Volume2
} from 'lucide-react';

interface InfographicViewProps {
  data: InfographicData;
  onRegenerate: () => void;
  onUpdateData?: (newData: InfographicData) => void;
  loading?: boolean;
}

export const InfographicView: React.FC<InfographicViewProps> = ({
  data,
  onRegenerate,
  onUpdateData,
  loading = false
}) => {
  const [viewMode, setViewMode] = useState<'infographic' | 'slide' | 'poster' | 'student'>('infographic');
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState<InfographicData>(data);
  const [copiedShare, setCopiedShare] = useState(false);

  // Section specific states
  const [simplifiedSections, setSimplifiedSections] = useState<Record<string, boolean>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  
  // Quiz states
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [showQuizResults, setShowQuizResults] = useState<Record<number, boolean>>({});

  const containerRef = useRef<HTMLDivElement>(null);

  // Sync edited state when prop changes
  React.useEffect(() => {
    setEditedData(data);
  }, [data]);

  const activeData = isEditing ? editedData : data;

  const toggleSimplified = (secId: string) => {
    setSimplifiedSections(prev => ({ ...prev, [secId]: !prev[secId] }));
  };

  const toggleExpanded = (secId: string) => {
    setExpandedSections(prev => ({ ...prev, [secId]: !prev[secId] }));
  };

  const handleSelectAnswer = (qIndex: number, optionIndex: number) => {
    setSelectedAnswers(prev => ({ ...prev, [qIndex]: optionIndex }));
    setShowQuizResults(prev => ({ ...prev, [qIndex]: true }));
  };

  const handlePrint = () => {
    window.print();
  };

  const handleShare = () => {
    const text = `🎨 *Infografis Pembelajaran Kurikulum Merdeka*\n\n📌 *Judul:* ${activeData.topicTitle}\n🎓 *Jenjang:* ${activeData.jenjang}\n\n💡 *Konsep Utama:* ${activeData.coreConcept}\n\nDibuat otomatis dengan Kurikulum AI.`;
    navigator.clipboard.writeText(text);
    setCopiedShare(true);
    setTimeout(() => setCopiedShare(false), 3000);
  };

  const handleSaveEdit = () => {
    setIsEditing(false);
    if (onUpdateData) {
      onUpdateData(editedData);
    }
  };

  // Helper icon for IPS Domain
  const getIpsDomainIcon = (domain?: string) => {
    switch (domain) {
      case 'Geografi': return <Globe size={14} className="text-blue-600" />;
      case 'Ekonomi': return <TrendingUp size={14} className="text-emerald-600" />;
      case 'Sosiologi': return <Users size={14} className="text-amber-600" />;
      case 'Sejarah': return <History size={14} className="text-purple-600" />;
      default: return <Compass size={14} className="text-teal-600" />;
    }
  };

  // Total slides for presentation mode: Intro slide, N section slides, Quiz/Summary slide
  const totalSlides = 2 + (activeData.sections?.length || 0) + (activeData.quiz?.length ? 1 : 0);

  return (
    <div className="space-y-6">
      {/* Top Action Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-wrap items-center justify-between gap-4 print:hidden">
        {/* View Mode Selectors */}
        <div className="flex items-center bg-gray-100 p-1 rounded-xl">
          <button
            onClick={() => setViewMode('infographic')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              viewMode === 'infographic' 
                ? 'bg-white text-[#0f766e] shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Layout size={14} />
            <span>MODE INFOGRAFIS</span>
          </button>
          <button
            onClick={() => setViewMode('slide')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              viewMode === 'slide' 
                ? 'bg-white text-[#0f766e] shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Monitor size={14} />
            <span>SLIDE PRESENTASI</span>
          </button>
          <button
            onClick={() => setViewMode('poster')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              viewMode === 'poster' 
                ? 'bg-white text-[#0f766e] shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Layers size={14} />
            <span>MODE POSTER</span>
          </button>
          <button
            onClick={() => setViewMode('student')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
              viewMode === 'student' 
                ? 'bg-white text-[#0f766e] shadow-sm' 
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <FileText size={14} />
            <span>MATERI SISWA</span>
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setIsEditing(!isEditing)}
            className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors ${
              isEditing ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            {isEditing ? <Save size={14} onClick={handleSaveEdit} /> : <Edit3 size={14} />}
            <span>{isEditing ? 'Selesai Edit' : 'EDIT INFOGRAFIS'}</span>
          </button>

          <button
            onClick={onRegenerate}
            disabled={loading}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RotateCcw size={14} className={loading ? 'animate-spin' : ''} />
            <span>BUAT ULANG</span>
          </button>

          <button
            onClick={handlePrint}
            className="px-3 py-2 bg-[#0f766e] hover:bg-[#0d5e58] text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Printer size={14} />
            <span>CETAK / UNDUH PDF</span>
          </button>

          <button
            onClick={handleShare}
            className="px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            {copiedShare ? <Check size={14} className="text-emerald-600" /> : <Share2 size={14} />}
            <span>{copiedShare ? 'Tersalin!' : 'BAGIKAN'}</span>
          </button>
        </div>
      </div>

      {/* Main Infographic Content Container */}
      <div ref={containerRef} className="print:m-0 print:p-0">
        
        {/* 1. MODE INFOGRAFIS (16:9 Modern Bento Container) */}
        {viewMode === 'infographic' && (
          <div className="bg-slate-900 text-slate-100 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-10 border border-slate-800 max-w-7xl mx-auto overflow-hidden">
            
            {/* Header / Title Banner */}
            <div className="relative bg-gradient-to-r from-teal-900 via-slate-900 to-indigo-950 p-8 sm:p-12 rounded-2xl border border-teal-500/20 shadow-inner overflow-hidden">
              <div className="absolute top-0 right-0 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
              
              <div className="relative z-10 space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="px-3 py-1 bg-teal-500/20 text-teal-300 border border-teal-500/30 rounded-full text-xs font-extrabold uppercase tracking-widest">
                    INFOGRAFIS PEMBELAJARAN
                  </span>
                  <span className="px-3 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full text-xs font-bold">
                    JENJANG {activeData.jenjang}
                  </span>
                  {activeData.isIpsSubject && (
                    <span className="px-3 py-1 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded-full text-xs font-bold flex items-center gap-1.5">
                      {getIpsDomainIcon(activeData.ipsDomain)}
                      <span>IPS ({activeData.ipsDomain || 'Umum'})</span>
                    </span>
                  )}
                </div>

                <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-tight">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedData.topicTitle}
                      onChange={e => setEditedData({ ...editedData, topicTitle: e.target.value })}
                      className="w-full bg-slate-800 border border-teal-500 rounded px-3 py-1 text-white"
                    />
                  ) : (
                    activeData.topicTitle
                  )}
                </h1>

                <p className="text-slate-300 text-base sm:text-lg max-w-4xl leading-relaxed">
                  {isEditing ? (
                    <textarea
                      value={editedData.intro}
                      onChange={e => setEditedData({ ...editedData, intro: e.target.value })}
                      className="w-full bg-slate-800 border border-teal-500 rounded p-2 text-white text-sm"
                      rows={2}
                    />
                  ) : (
                    activeData.intro
                  )}
                </p>
              </div>
            </div>

            {/* Core Concept Banner (Konsep Utama) */}
            <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-6 rounded-2xl border border-amber-500/30 flex items-start gap-4">
              <div className="p-3 bg-amber-500/20 text-amber-400 rounded-xl shrink-0 mt-1">
                <Lightbulb size={24} />
              </div>
              <div className="space-y-1">
                <h3 className="text-amber-400 font-extrabold text-xs uppercase tracking-widest">KONSEP UTAMA MATERI</h3>
                <p className="text-slate-200 font-medium text-base leading-relaxed">
                  {isEditing ? (
                    <textarea
                      value={editedData.coreConcept}
                      onChange={e => setEditedData({ ...editedData, coreConcept: e.target.value })}
                      className="w-full bg-slate-800 border border-amber-500/50 rounded p-2 text-white text-sm"
                      rows={2}
                    />
                  ) : (
                    activeData.coreConcept
                  )}
                </p>
              </div>
            </div>

            {/* Main Sections Grid (1 Ide Utama = 1 Visual Utama) */}
            <div className="space-y-8">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h2 className="text-xl font-bold text-teal-400 flex items-center gap-2">
                  <BookOpen size={20} />
                  <span>PENJELASAN KONSEP MATERI</span>
                </h2>
                <span className="text-xs text-slate-400 font-medium">
                  {activeData.sections?.length || 0} Subtopik Pembelajaran
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {activeData.sections?.map((sec, idx) => {
                  const isSimplified = simplifiedSections[sec.id];
                  const isExpanded = expandedSections[sec.id];

                  return (
                    <div 
                      key={sec.id || idx}
                      className="bg-slate-800/80 border border-slate-700/80 hover:border-teal-500/40 rounded-2xl overflow-hidden flex flex-col justify-between shadow-lg transition-all"
                    >
                      {/* Image / Visual Header */}
                      <div className="relative h-56 bg-slate-950 overflow-hidden group">
                        <img 
                          src={sec.imageUrl} 
                          alt={sec.subheading}
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            // Fallback to high quality Unsplash image if Pollinations is blocked or slow
                            const target = e.currentTarget;
                            if (!target.dataset.fallback) {
                              target.dataset.fallback = "true";
                              target.src = "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?q=80&w=1200&auto=format&fit=crop";
                            }
                          }}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent" />
                        
                        <div className="absolute top-3 left-3 px-3 py-1 bg-slate-900/80 backdrop-blur-md rounded-full border border-slate-700 text-[10px] font-bold text-teal-300 uppercase tracking-wider">
                          Bagian {idx + 1} • {sec.visualType || 'Ilustrasi'}
                        </div>

                        <div className="absolute bottom-3 left-3 right-3">
                          <h3 className="text-lg font-bold text-white leading-snug drop-shadow-md">
                            {sec.subheading}
                          </h3>
                        </div>
                      </div>

                      {/* Content Body */}
                      <div className="p-6 space-y-4 flex-1 flex flex-col justify-between">
                        <div className="space-y-4">
                          {/* Standard vs Simplified text */}
                          {isSimplified ? (
                            <div className="p-4 bg-teal-950/80 border border-teal-500/40 rounded-xl space-y-2 animate-fadeIn">
                              <div className="flex items-center gap-2 text-teal-300 text-xs font-bold">
                                <Zap size={14} />
                                <span>Penjelasan Sederhana:</span>
                              </div>
                              <p className="text-sm text-teal-100 leading-relaxed font-medium">
                                {sec.simplifiedExplanation || sec.explanation}
                              </p>
                              {sec.simplifiedAnalogy && (
                                <div className="mt-2 pt-2 border-t border-teal-800/50 text-xs text-amber-200 flex items-start gap-2">
                                  <span className="font-bold shrink-0">Analogi:</span>
                                  <span>{sec.simplifiedAnalogy}</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-slate-300 text-sm leading-relaxed">
                              {sec.explanation}
                            </p>
                          )}

                          {/* Key Points */}
                          {sec.keyPoints && sec.keyPoints.length > 0 && (
                            <div className="space-y-2">
                              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Poin Penting:</p>
                              <ul className="space-y-1.5">
                                {sec.keyPoints.map((pt, pIdx) => (
                                  <li key={pIdx} className="text-xs text-slate-200 flex items-start gap-2">
                                    <span className="w-1.5 h-1.5 bg-teal-400 rounded-full mt-1.5 shrink-0" />
                                    <span>{pt}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Simple Example */}
                          {sec.simpleExample && (
                            <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-700/60 text-xs text-slate-300 space-y-1">
                              <span className="font-bold text-amber-400">Contoh Konkret:</span>
                              <p>{sec.simpleExample}</p>
                            </div>
                          )}

                          {/* Extra Details Accordion */}
                          {isExpanded && sec.extraDetails && (
                            <div className="p-4 bg-slate-900/90 rounded-xl border border-teal-500/30 text-xs text-slate-300 leading-relaxed space-y-2 animate-fadeIn">
                              <p className="font-bold text-teal-300">Detail Pendalaman:</p>
                              <p>{sec.extraDetails}</p>
                            </div>
                          )}
                        </div>

                        {/* Card Interactive Controls */}
                        <div className="pt-4 border-t border-slate-700/60 flex items-center justify-between gap-2 text-xs">
                          <button
                            onClick={() => toggleSimplified(sec.id)}
                            className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-colors ${
                              isSimplified 
                                ? 'bg-teal-500 text-slate-950 hover:bg-teal-400' 
                                : 'bg-slate-700 hover:bg-slate-600 text-teal-300'
                            }`}
                          >
                            <Zap size={12} />
                            <span>{isSimplified ? 'Bahasa Standar' : 'Jelaskan Lebih Sederhana'}</span>
                          </button>

                          {sec.extraDetails && (
                            <button
                              onClick={() => toggleExpanded(sec.id)}
                              className="text-slate-400 hover:text-slate-200 font-medium flex items-center gap-1 transition-colors"
                            >
                              <span>{isExpanded ? 'Tutup Detail' : 'Klik Selengkapnya'}</span>
                              <ChevronRight size={12} className={isExpanded ? 'rotate-90 transition-transform' : ''} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Real Life Examples & Fun Facts Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Examples (2 cols) */}
              <div className="md:col-span-2 bg-slate-800/60 p-6 rounded-2xl border border-slate-700 space-y-4">
                <h3 className="text-amber-400 font-bold text-sm uppercase tracking-wider flex items-center gap-2">
                  <MapPin size={18} />
                  <span>CONTOH DALAM KEHIDUPAN SEHARI-HARI</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {activeData.realLifeExamples?.map((ex, i) => (
                    <div key={i} className="p-3 bg-slate-900/80 rounded-xl border border-slate-700/80 text-xs text-slate-200 flex items-start gap-2.5">
                      <div className="w-5 h-5 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                        {i + 1}
                      </div>
                      <span>{ex}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Fun Fact (1 col) */}
              <div className="bg-gradient-to-br from-indigo-900/50 to-slate-900 p-6 rounded-2xl border border-indigo-500/30 space-y-3 flex flex-col justify-between">
                <div className="space-y-2">
                  <span className="px-2.5 py-1 bg-indigo-500/20 text-indigo-300 rounded-full text-[10px] font-extrabold tracking-wider uppercase inline-block">
                    TAHUKAH KAMU?
                  </span>
                  <p className="text-xs text-indigo-100 leading-relaxed font-medium">
                    {activeData.funFact}
                  </p>
                </div>
                <div className="pt-2 border-t border-indigo-500/20 text-[10px] text-indigo-300 font-semibold flex items-center gap-1">
                  <Sparkles size={12} />
                  <span>Fakta Edukatif Relevan</span>
                </div>
              </div>
            </div>

            {/* Interactive Quiz Section */}
            {activeData.quiz && activeData.quiz.length > 0 && (
              <div className="bg-slate-800/80 p-8 rounded-2xl border border-teal-500/30 space-y-6">
                <div className="flex items-center justify-between border-b border-slate-700 pb-3">
                  <h3 className="text-xl font-bold text-teal-300 flex items-center gap-2">
                    <HelpCircle size={20} />
                    <span>KUIS PEMAHAMAN INTERAKTIF</span>
                  </h3>
                  <span className="text-xs text-slate-400">Pilih Jawaban Kuis</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {activeData.quiz.map((q, qIdx) => {
                    const selected = selectedAnswers[qIdx];
                    const isAnswered = showQuizResults[qIdx];
                    const isCorrect = selected === q.correctIndex;

                    return (
                      <div key={qIdx} className="bg-slate-900 p-5 rounded-xl border border-slate-700 space-y-4 flex flex-col justify-between">
                        <div className="space-y-3">
                          <p className="text-xs font-bold text-teal-400">Soal {qIdx + 1}:</p>
                          <p className="text-sm font-semibold text-white leading-snug">{q.question}</p>
                          
                          <div className="space-y-2 pt-2">
                            {q.options?.map((opt, optIdx) => {
                              let optionStyle = "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700";
                              if (isAnswered) {
                                if (optIdx === q.correctIndex) {
                                  optionStyle = "bg-emerald-900/80 border-emerald-500 text-emerald-200 font-bold";
                                } else if (selected === optIdx) {
                                  optionStyle = "bg-rose-900/80 border-rose-500 text-rose-200 line-through";
                                } else {
                                  optionStyle = "bg-slate-900 opacity-40 text-slate-500 border-slate-800";
                                }
                              }

                              return (
                                <button
                                  key={optIdx}
                                  onClick={() => handleSelectAnswer(qIdx, optIdx)}
                                  className={`w-full p-3 rounded-lg border text-left text-xs transition-all flex items-center justify-between gap-2 ${optionStyle}`}
                                >
                                  <span>{String.fromCharCode(65 + optIdx)}. {opt}</span>
                                  {isAnswered && optIdx === q.correctIndex && <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />}
                                  {isAnswered && selected === optIdx && optIdx !== q.correctIndex && <XCircle size={16} className="text-rose-400 shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Feedback & Explanation */}
                        {isAnswered && (
                          <div className={`p-3 rounded-lg border text-xs leading-relaxed space-y-1 animate-fadeIn ${
                            isCorrect ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200' : 'bg-rose-950/60 border-rose-500/40 text-rose-200'
                          }`}>
                            <p className="font-bold flex items-center gap-1.5">
                              {isCorrect ? <CheckCircle2 size={14} className="text-emerald-400" /> : <XCircle size={14} className="text-rose-400" />}
                              <span>{isCorrect ? 'Jawaban Kamu Tepat!' : 'Jawaban Kurang Tepat'}</span>
                            </p>
                            <p className="opacity-90">{q.explanation}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Conclusions & Reflection Questions */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-800">
              {/* Conclusions */}
              <div className="bg-slate-800/60 p-6 rounded-2xl border border-slate-700 space-y-3">
                <h3 className="text-teal-400 font-bold text-sm uppercase tracking-wider">KESIMPULAN MATERI</h3>
                <ul className="space-y-2">
                  {activeData.conclusions?.map((c, i) => (
                    <li key={i} className="text-xs text-slate-200 flex items-start gap-2">
                      <span className="w-1.5 h-1.5 bg-teal-400 rounded-full mt-1.5 shrink-0" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Reflection Questions */}
              <div className="bg-slate-800/60 p-6 rounded-2xl border border-slate-700 space-y-3">
                <h3 className="text-amber-400 font-bold text-sm uppercase tracking-wider">PERTANYAAN PEMAHAMAN & REFLEKSI</h3>
                <ul className="space-y-2">
                  {activeData.understandingQuestions?.map((q, i) => (
                    <li key={i} className="text-xs text-slate-200 flex items-start gap-2">
                      <span className="font-bold text-amber-400 shrink-0">{i + 1}.</span>
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

          </div>
        )}

        {/* 2. MODE SLIDE PRESENTASI (Interactive Presentation View) */}
        {viewMode === 'slide' && (
          <div className="bg-slate-950 text-white rounded-3xl p-8 sm:p-12 shadow-2xl space-y-8 max-w-5xl mx-auto min-h-[500px] flex flex-col justify-between border border-slate-800">
            {/* Slide Navigation Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <span className="text-xs font-bold text-teal-400 uppercase tracking-widest">
                PRESENTASI MATERI • SLIDE {currentSlide + 1} DARI {totalSlides}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentSlide(prev => Math.max(0, prev - 1))}
                  disabled={currentSlide === 0}
                  className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={() => setCurrentSlide(prev => Math.min(totalSlides - 1, prev + 1))}
                  disabled={currentSlide === totalSlides - 1}
                  className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl disabled:opacity-30 transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>

            {/* Slide Content Body */}
            <div className="my-auto py-6">
              {currentSlide === 0 && (
                <div className="text-center space-y-6 max-w-3xl mx-auto">
                  <span className="px-4 py-1.5 bg-teal-500/20 text-teal-300 rounded-full text-xs font-bold uppercase tracking-wider border border-teal-500/30">
                    {activeData.jenjang} • MATERI PEMBELAJARAN
                  </span>
                  <h1 className="text-4xl sm:text-6xl font-black text-white tracking-tight leading-tight">
                    {activeData.topicTitle}
                  </h1>
                  <p className="text-slate-300 text-lg leading-relaxed">
                    {activeData.intro}
                  </p>
                  <div className="p-4 bg-slate-900 rounded-2xl border border-amber-500/30 text-amber-300 text-sm font-medium">
                    💡 Konsep Utama: {activeData.coreConcept}
                  </div>
                </div>
              )}

              {currentSlide > 0 && currentSlide <= (activeData.sections?.length || 0) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                  <div className="h-72 rounded-2xl overflow-hidden border border-slate-700 bg-slate-900 shadow-xl">
                    <img 
                      src={activeData.sections[currentSlide - 1].imageUrl} 
                      alt={activeData.sections[currentSlide - 1].subheading} 
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        const target = e.currentTarget;
                        if (!target.dataset.fallback) {
                          target.dataset.fallback = "true";
                          target.src = "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?q=80&w=1200&auto=format&fit=crop";
                        }
                      }}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="space-y-4">
                    <span className="text-xs font-bold text-teal-400 uppercase tracking-widest">
                      SUBTOPIK {currentSlide}
                    </span>
                    <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
                      {activeData.sections[currentSlide - 1].subheading}
                    </h2>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      {activeData.sections[currentSlide - 1].explanation}
                    </p>
                    <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 text-xs text-amber-300">
                      <strong>Contoh:</strong> {activeData.sections[currentSlide - 1].simpleExample}
                    </div>
                  </div>
                </div>
              )}

              {currentSlide === totalSlides - 1 && (
                <div className="space-y-6 max-w-3xl mx-auto">
                  <h2 className="text-3xl font-black text-teal-300 text-center">KESIMPULAN MATERI</h2>
                  <div className="space-y-3 bg-slate-900 p-6 rounded-2xl border border-slate-800">
                    {activeData.conclusions?.map((c, i) => (
                      <div key={i} className="flex items-start gap-3 text-sm text-slate-200">
                        <span className="w-2 h-2 bg-teal-400 rounded-full mt-2 shrink-0" />
                        <span>{c}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Slide Footer */}
            <div className="flex items-center justify-between text-xs text-slate-500 border-t border-slate-800 pt-4">
              <span>Kurikulum AI • Media Pembelajaran Interaktif</span>
              <span>Gunakan panah untuk berpindah slide</span>
            </div>
          </div>
        )}

        {/* 3. MODE POSTER (Printable Vertical Layout) */}
        {viewMode === 'poster' && (
          <div className="bg-white text-gray-900 rounded-3xl p-8 sm:p-12 shadow-xl space-y-8 max-w-4xl mx-auto border border-gray-200">
            <div className="text-center space-y-3 pb-6 border-b-2 border-teal-600">
              <span className="px-3 py-1 bg-teal-100 text-[#0f766e] rounded-full text-xs font-bold uppercase tracking-wider">
                POSTER EDUKASI • {activeData.jenjang}
              </span>
              <h1 className="text-3xl sm:text-4xl font-black text-[#141414]">
                {activeData.topicTitle}
              </h1>
              <p className="text-sm text-gray-600 max-w-2xl mx-auto">{activeData.intro}</p>
            </div>

            <div className="p-5 bg-amber-50 rounded-2xl border border-amber-200 text-xs text-amber-900">
              <strong className="text-amber-800 uppercase tracking-wider block mb-1">Konsep Utama:</strong>
              <p className="text-sm font-medium">{activeData.coreConcept}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {activeData.sections?.map((sec, idx) => (
                <div key={idx} className="bg-gray-50 p-5 rounded-2xl border border-gray-200 space-y-3">
                  <div className="h-40 rounded-xl overflow-hidden bg-gray-200">
                    <img 
                      src={sec.imageUrl} 
                      alt={sec.subheading} 
                      referrerPolicy="no-referrer" 
                      onError={(e) => {
                        const target = e.currentTarget;
                        if (!target.dataset.fallback) {
                          target.dataset.fallback = "true";
                          target.src = "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?q=80&w=1200&auto=format&fit=crop";
                        }
                      }}
                      className="w-full h-full object-cover" 
                    />
                  </div>
                  <h3 className="font-bold text-base text-gray-900">{sec.subheading}</h3>
                  <p className="text-xs text-gray-600 leading-relaxed">{sec.explanation}</p>
                </div>
              ))}
            </div>

            <div className="p-6 bg-teal-50 rounded-2xl border border-teal-200 space-y-2 text-xs text-teal-900">
              <strong className="text-sm text-[#0f766e]">Kesimpulan Ringkas:</strong>
              <ul className="list-disc list-inside space-y-1">
                {activeData.conclusions?.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* 4. MODE MATERI SISWA (Student Reading / Handout Format) */}
        {viewMode === 'student' && (
          <div className="bg-white text-gray-900 rounded-3xl p-8 sm:p-12 shadow-xl space-y-8 max-w-4xl mx-auto border border-gray-200">
            <div className="border-b pb-4 flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{activeData.topicTitle}</h1>
                <p className="text-xs text-gray-500">Bahan Bacaan & Lembar Kerja Siswa • Jenjang {activeData.jenjang}</p>
              </div>
              <span className="text-xs font-mono bg-gray-100 px-3 py-1 rounded-lg">Nama: ______________</span>
            </div>

            <div className="space-y-4">
              <h2 className="text-sm font-bold text-[#0f766e] uppercase tracking-wider">A. Ringkasan Pengantar</h2>
              <p className="text-xs text-gray-700 leading-relaxed">{activeData.intro}</p>
              <div className="p-4 bg-teal-50 rounded-xl text-xs text-teal-900 border border-teal-200">
                <strong>Inti Konsep:</strong> {activeData.coreConcept}
              </div>
            </div>

            <div className="space-y-6">
              <h2 className="text-sm font-bold text-[#0f766e] uppercase tracking-wider">B. Uraian Materi</h2>
              {activeData.sections?.map((sec, i) => (
                <div key={i} className="space-y-2 border-b pb-4">
                  <h3 className="text-xs font-bold text-gray-900">{i + 1}. {sec.subheading}</h3>
                  <p className="text-xs text-gray-700 leading-relaxed">{sec.explanation}</p>
                  <p className="text-xs text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200">
                    <strong>Contoh:</strong> {sec.simpleExample}
                  </p>
                </div>
              ))}
            </div>

            <div className="space-y-3 pt-2">
              <h2 className="text-sm font-bold text-[#0f766e] uppercase tracking-wider">C. Pertanyaan Latihan</h2>
              {activeData.understandingQuestions?.map((q, i) => (
                <div key={i} className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-800 space-y-2">
                  <p className="font-bold">{i + 1}. {q}</p>
                  <div className="h-12 border-b border-dashed border-gray-300" />
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
