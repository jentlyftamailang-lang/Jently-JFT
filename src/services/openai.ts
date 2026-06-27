/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MappingResult, Phase, TujuanPembelajaran, LearningModel, ModulAjar, AlurTujuanPembelajaran, ATPItem } from "../types";

// Re-define Type enum locally for client-side use to avoid importing from @google/genai in the browser
export enum Type {
  TYPE_UNSPECIFIED = "TYPE_UNSPECIFIED",
  STRING = "STRING",
  NUMBER = "NUMBER",
  INTEGER = "INTEGER",
  BOOLEAN = "BOOLEAN",
  ARRAY = "ARRAY",
  OBJECT = "OBJECT",
  NULL = "NULL",
}

function safeParseJson(text: string) {
  // 1. Pre-cleaning: Remove markdown code blocks and invisible characters
  let cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
  cleaned = cleaned.replace(/[\x00-\x1F\x7F-\x9F]/g, " "); // Remove control characters
  
  // 2. Direct Parse Attempt
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // 3. Heavy cleanup: Collapse excessive whitespace
    const collapsed = cleaned.replace(/\s+/g, " ").trim();
    try {
      return JSON.parse(collapsed);
    } catch (e2) {
      // 4. Extraction & Reconstruction
      const firstBrace = collapsed.indexOf('{');
      const firstBracket = collapsed.indexOf('[');
      let startIdx = -1;
      let endChar = '';

      if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        startIdx = firstBrace;
        endChar = '}';
      } else if (firstBracket !== -1) {
        startIdx = firstBracket;
        endChar = ']';
      }

      if (startIdx === -1) {
        throw new Error("AI tidak memberikan format data JSON yang bisa dikenali.");
      }

      const lastOccurrence = collapsed.lastIndexOf(endChar);
      let candidate = "";
      
      if (lastOccurrence > startIdx) {
        candidate = collapsed.substring(startIdx, lastOccurrence + 1);
      } else {
        // Truncated case
        candidate = collapsed.substring(startIdx);
      }

      // 5. Advanced Repair for Truncated JSON
      try {
        // Try cleaning trailing commas first
        const fixedCommas = candidate.replace(/,\s*([\}\]])/g, "$1");
        return JSON.parse(fixedCommas);
      } catch (e3) {
        // Try auto-closing braces/brackets
        let openBraces = 0;
        let openBrackets = 0;
        let inString = false;
        let escaped = false;

        for (let i = 0; i < candidate.length; i++) {
          const char = candidate[i];
          if (escaped) {
            escaped = false;
            continue;
          }
          if (char === '\\') {
            escaped = true;
            continue;
          }
          if (char === '"') {
            inString = !inString;
            continue;
          }
          if (!inString) {
            if (char === '{') openBraces++;
            else if (char === '}') openBraces--;
            else if (char === '[') openBrackets++;
            else if (char === ']') openBrackets--;
          }
        }

        let reconstructed = candidate;
        if (inString) reconstructed += '"';
        if (openBrackets > 0) reconstructed += ']'.repeat(openBrackets);
        if (openBraces > 0) reconstructed += '}'.repeat(openBraces);

        try {
          return JSON.parse(reconstructed.replace(/,\s*([\}\]])/g, "$1"));
        } catch (e4) {
          console.error("Critical JSON Parse Failure. Raw:", text);
          throw new Error("Hasil dari AI terpotong atau terlalu panjang. Coba perkecil teks input atau kurangi pilihan kelas.");
        }
      }
    }
  }
}

async function parseResponseJson(response: Response): Promise<any> {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    if (text.includes("<!doctype html") || text.includes("<html") || text.includes("<!DOCTYPE html")) {
      throw new Error("Layanan server sedang memuat ulang (server restart) atau tidak dapat dijangkau. Silakan tunggu beberapa saat lalu coba lagi.");
    }
    throw new Error(`Format balasan server tidak valid (bukan JSON): ${text.substring(0, 100)}`);
  }
  return response.json();
}

function extractKeysFromInvalidJson(text: string) {
  const result: Record<string, string> = {};
  const keys = ['lampiran', 'soal', 'materi', 'lkpd'];
  
  for (const key of keys) {
    const keyRef = `"${key}"`;
    const keyIdx = text.indexOf(keyRef);
    if (keyIdx === -1) continue;
    
    const colonIdx = text.indexOf(':', keyIdx + keyRef.length);
    if (colonIdx === -1) continue;
    
    const startQuoteIdx = text.indexOf('"', colonIdx + 1);
    if (startQuoteIdx === -1) continue;
    
    let content = "";
    let escaped = false;
    for (let i = startQuoteIdx + 1; i < text.length; i++) {
      const char = text[i];
      if (escaped) {
        content += char;
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
        content += char;
      } else if (char === '"') {
        break;
      } else {
        content += char;
      }
    }
    
    if (content) {
      if (content.endsWith('\\')) {
        content = content.slice(0, -1);
      }
      try {
        result[key] = JSON.parse(`"${content}"`);
      } catch (e) {
        result[key] = content
          .replace(/\\"/g, '"')
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\r/g, '\r')
          .replace(/\\\\/g, '\\');
      }
    }
  }
  return result;
}

async function robustFetch(url: string, options: RequestInit, retries = 3, delay = 1500): Promise<Response> {
  try {
    const response = await fetch(url, options);
    if ([502, 503, 504].includes(response.status) && retries > 0) {
      console.warn(`[Client] Received status ${response.status}. Retrying in ${delay}ms... (Remaining retries: ${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return robustFetch(url, options, retries - 1, delay * 2);
    }
    return response;
  } catch (err: any) {
    if (retries > 0) {
      console.warn(`[Client] Network error: ${err.message || 'Failed to fetch'}. Retrying in ${delay}ms... (Remaining retries: ${retries})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return robustFetch(url, options, retries - 1, delay * 2);
    }
    throw err;
  }
}

const TP_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    cpPerClass: {
      type: Type.ARRAY,
      description: "Pemetaan potongan CP yang relevan untuk SETIAP kelas",
      items: {
        type: Type.OBJECT,
        properties: {
          classId: { type: Type.STRING, description: "ID Kelas (harus salah satu dari list yang dipilih)" },
          cpSummary: { type: Type.STRING, description: "Ringkasan kompetensi spesifik untuk kelas tersebut" }
        },
        required: ["classId", "cpSummary"]
      }
    },
    tujuanPembelajaran: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          element: { type: Type.STRING, description: "Elemen/Domain CP (misal: Aljabar, Menyimak, dsb)" },
          statement: { type: Type.STRING, description: "Kalimat lengkap Tujuan Pembelajaran (TP)" },
          competency: { type: Type.STRING, description: "Kompetensi" },
          content: { type: Type.STRING, description: "Lingkup Materi" },
          classLevel: { type: Type.STRING, description: "Kelas (ID)" },
          kktp: { 
            type: Type.ARRAY, 
            items: { type: Type.STRING },
            description: "Daftar 3-4 kriteria ketercapaian (KKTP)"
          }
        },
        required: ["id", "element", "statement", "competency", "content", "classLevel", "kktp"]
      }
    }
  },
  required: ["cpPerClass", "tujuanPembelajaran"]
};

export async function generateTP(cpContent: string, phase: Phase, selectedClasses: string[], subject?: string): Promise<MappingResult> {
  const prompt = `
    Anda adalah pakar kurikulum Kurikulum Merdeka di Indonesia.
    Tugas: Analisis Capaian Pembelajaran (CP) Fase ${phase} secara MENDALAM dan KOMPREHENSIF. Petakan ke kelas: ${selectedClasses.join(', ')}.
    ${subject ? `\nMata Pelajaran Utama: ${subject}\nATURAN MUTLAK: Tujuan Pembelajaran (TP) dan lingkup materi yang dihasilkan HANYA BOLEH mengandung materi yang sesuai dengan mata pelajaran ${subject}. JANGAN memasukkan TP, materi, kompetensi, atau istilah dari mata pelajaran lain. JIKA CP TERLIHAT UMUM, ANDA WAJIB MENGKHUSUSKAN/MENAFSIRKANNYA KE DALAM KONTEKS MATA PELAJARAN ${subject} SAJA.` : ''}
    
    TEKS CP ASLI:
    "${cpContent.substring(0, 4000)}"
    
    INSTRUKSI OUTPUT (WAJIB DIPATUHI):
    1. ANALISIS KONTEN & MATERI (Langkah Pertama):
       - Baca Capaian Pembelajaran secara utuh.
       - Identifikasi "Kompetensi" (skill/kemampuan yang diukur) dan "Lingkup Materi" (topik/konsep esensial yang diajarkan).
       - Pemetaan kelas: Pastikan materi-materi tersebut dibagikan/didistribusikan ke kelas yang diminta (${selectedClasses.join(', ')}) berdasarkan tingkat kemudahannya (prasyarat diajarkan di kelas lebih rendah).
       - SANGAT PENTING (Kesesuaian Materi): PASTIKAN semua TP yang dipetakan dari CP HANYA MENGANDUNG MATERI YANG SESUAI dengan substansi pada mata pelajaran ${subject || 'terkait'}. ELIMINASI materi yang bukan dari mata pelajaran tersebut.
    2. cpPerClass: Tulis ulang (breakdown) teks CP asli menjadi ringkasan kompetensi dan lingkup materi yang DETAIL, SPESIFIK, dan KOMPREHENSIF untuk SETIAP kelas. 
       PASTIKAN TIDAK ADA MATERI ATAU KOMPETENSI DARI CP ASLI YANG HILANG.
       Gunakan ID kelas ini secara eksak dalam output: [${selectedClasses.join(', ')}].
    3. tujuanPembelajaran: Turunkan TP yang spesifik dan operasional berdasarkan lingkup materi yang telah di analisis di setiap kelas tersebut.
       ATURAN MUTLAK KESESUAIAN MATERI: Tujuan Pembelajaran (dan field "statement", "content") HANYA BOLEH mendeskripsikan materi / topik yang 100% merupakan murni kurikulum dari mata pelajaran ${subject || 'terkait'}. 
       Sertakan kolom "content" pada hasil JSON TP berisi inti materi yang relevan.
       JUMLAH TP: Pastikan jumlah TP mencakup SELURUH cakupan materi dalam CP (jangan terlalu sedikit).
       WAJIB: Field "classLevel" HARUS diisi dengan salah satu ID dari: [${selectedClasses.join(', ')}]. 
       Jangan pernah menggunakan kata "Kelas" di dalam field "classLevel", cukup ID-nya saja.
    4. IDENTIFIKASI ELEMEN: Teks CP yang diberikan dipisahkan berdasarkan baris baru (newline).
       - SANGAT PENTING: Setiap baris baru dalam teks CP asli MEREPRESENTASIKAN SATU ELEMEN/DOMAIN YANG BERBEDA.
       - Anda WAJIB membaca setiap baris sebagai Elemen yang terpisah dan mengidentifikasinya dengan tepat.
       - Setiap TP HARUS dikategorikan ke dalam Elemen yang sesuai berdasarkan baris aslinya di teks CP.
       - JANGAN membuat nama elemen baru, gunakan struktur baris yang ada.
    5. PROPORSI TP PER ELEMEN: Setiap Elemen (setiap baris dari teks CP) WAJIB memiliki TP yang memadai untuk mencakup seluruh isi kompetensinya di SETIAP kelas.
    6. kktp: **SANGAT PENTING & WAJIB**: Analisis dan susunlah Kriteria Ketercapaian Tujuan Pembelajaran (KKTP) secara mendalam menggunakan **Taksonomi Bloom** (tingkat kognitif C1 hingga C6). Berikan 3-4 kriteria ketercapaian yang konkret, terukur, dan detail untuk setiap TP. Di setiap butir KKTP, Anda **WAJIB** mencantumkan level/tingkat kognitif Bloom di dalam tanda kurung siku di awal kalimat secara eksplisit, misalnya:
       - "[C1 - Mengingat] Siswa mampu menyebutkan/mengingat..."
       - "[C2 - Memahami] Siswa mampu menjelaskan/mengidentifikasi..."
       - "[C3 - Menerapkan] Siswa mampu mengimplementasikan/menggunakan..."
       - "[C4 - Menganalisis] Siswa mampu menganalisis/membandingkan..."
       - "[C5 - Mengevaluasi] Siswa mampu mengevaluasi/mengkritisi/menilai..."
       - "[C6 - Menciptakan] Siswa mampu merancang/menciptakan/menyusun..."
       
       **ATURAN MUTLAK KKTP**: KKTP harus berupa pernyataan operasional yang terukur (pernyataan deklaratif, diawali dengan Kata Kerja Operasional seperti 'Siswa mampu...' atau 'Peserta didik dapat...'). **DILARANG KERAS MENGGUNAKAN KALIMAT TANYA, TANDA TANYA (?), ATAU BENTUK INSTRUMEN PERTANYAAN/SOAL**. KKTP adalah kriteria ketercapaian, bukan pertanyaan evaluasi atau latihan soal.
       
       Pastikan setiap kriteria ditulis dengan sangat detail, bervariasi tingkat kognitifnya sesuai dengan tingkat kedalaman TP, dan menggunakan Kata Kerja Operasional (KKO) yang tepat dan bervariasi. JANGAN disingkat. Berikan yang panjang dan deskriptif.
    7. Elemen Field: Isi field "element" dengan nama Elemen yang tepat dari teks CP.
    
    PENTING: Pastikan ID kelas dalam output sinkron dengan: [${selectedClasses.join(', ')}].
    OPTIMASI: Jangan melakukan simplifikasi berlebihan. Jika materi dalam CP luas, maka jumlah TP harus menyesuaikan luasnya materi tersebut agar tidak ada materi yang terlewat.
    USER NOTE: Elemen sudah dimasukkan dalam teks CP, pastikan Anda mengekstraknya dengan benar.
    
    ATURAN TEKNIS (CRITICAL): 
    - Output HARUS JSON murni tanpa ada teks tambahan sebelum/sesudah.
    - DILARANG KERAS menyertakan spasi baris baru (newline) atau tab berlebih di dalam nilai string. 
    - Pastikan JSON sepadat mungkin agar tidak menyentuh limit token atau menyebabkan error parsing.
  `;

  try {
    const requestBody = JSON.stringify({ prompt, schema: TP_SCHEMA });
    console.log(`[OpenAIService] Request size (TP): ${(requestBody.length / 1024).toFixed(2)} KB`);
    
    const response = await robustFetch("/api/openai/generate-tp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    }).catch(err => {
      console.error("Fetch implementation error details:", err);
      throw new Error(`Koneksi terputus: ${err.message || "Gagal menghubungkan ke server."}`);
    });

    if (!response.ok) {
      let errorMsg = `Layanan AI tidak merespon (Status ${response.status}).`;
      try {
        const errorData = await parseResponseJson(response);
        errorMsg = errorData.error || errorMsg;
      } catch (e) {
        // Fallback if not JSON
        const rawText = await response.text().catch(() => "");
        if (rawText.length > 0) {
          console.warn("Raw error response:", rawText);
          if (rawText.includes("<html>")) errorMsg = "Server mengalami gangguan teknis (HTML error).";
        }
      }
      throw new Error(errorMsg);
    }

    const { text } = await parseResponseJson(response);
    
    if (!text) throw new Error("AI tidak memberikan respon (kosong).");
    
    try {
      const parsed = safeParseJson(text);
      
      // Convert cpPerClass array back to map to maintain compatibility with App.tsx
      const cpMap: Record<string, string> = {};
      if (Array.isArray(parsed.cpPerClass)) {
        parsed.cpPerClass.forEach((item: any) => {
          if (item.classId && item.cpSummary) {
            cpMap[item.classId] = item.cpSummary;
          }
        });
      } else if (typeof parsed.cpPerClass === 'object' && parsed.cpPerClass !== null) {
        // Fallback in case AI ignored array schema and outputted object
        Object.assign(cpMap, parsed.cpPerClass);
      }

      return {
        cpOriginal: cpContent,
        phase,
        classes: selectedClasses,
        cpPerClass: cpMap,
        tujuanPembelajaran: parsed.tujuanPembelajaran || []
      };
    } catch (parseError: any) {
      console.error("Parse Error Raw Text:", text);
      throw new Error(`Gagal membaca hasil dari AI: ${parseError.message}`);
    }
  } catch (error: any) {
    console.error("OpenAI Service Error:", error);
    if (error.message?.includes('403') || error.message?.includes('400')) {
      throw new Error("Gagal menghubungkan ke AI. Ada masalah dengan format data atau kunci API.");
    }
    if (error.message?.includes('429') || error.message?.toLowerCase().includes('quota') || error.message?.toLowerCase().includes('limit')) {
      throw new Error(error.message);
    }
    throw new Error(error.message || "Gagal menghubungkan ke layanan AI.");
  }
}

const MATERIAL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    materials: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Daftar cakupan materi atau lingkup materi yang mendalam berdasarkan TP"
    },
    meetings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          session: { type: Type.NUMBER },
          activity: { type: Type.STRING, description: "Ringkasan aktivitas pembelajaran untuk pertemuan tersebut" }
        },
        required: ["session", "activity"]
      }
    }
  },
  required: ["materials", "meetings"]
};

export async function generateMaterials(tp: TujuanPembelajaran, jpPerWeek?: number, numberOfMeetings?: number, subject?: string): Promise<{ materials: string[], meetings: { session: number, activity: string }[] }> {
  const prompt = `
    Berdasarkan Tujuan Pembelajaran (TP) berikut:
    TP: ${tp.statement}
    Kriteria (KKTP): ${tp.kktp.join(', ')}
    ${subject ? `Mata Pelajaran: ${subject}` : ''}
    ${jpPerWeek ? `Alokasi Waktu Mata Pelajaran: ${jpPerWeek} JP per minggu.` : ''}
    ${numberOfMeetings ? `ATURAN WAJIB: Anda HARUS menjabarkan materi ini menjadi TEPAT ${numberOfMeetings} pertemuan (sesuai ATP).` : ''}
    
    Tugas:
    1. Tentukan Lingkup Materi (Scope) yang harus dipelajari agar TP ini tercapai secara mendalam. Jangan melewatkan detail penting.
    2. Berikan Rekomendasi Pertemuan beserta ringkasan aktivitas pembelajarannya.
       PENTING: Anda WAJIB memberikan jumlah pertemuan yang CUKUP dan LOGIS untuk menuntaskan materi secara mendalam. 
       Jangan membuat jumlah pertemuan menjadi terlalu sedikit jika materinya padat.
       ${numberOfMeetings ? `ATURAN WAJIB: Anda HARUS menjabarkan materi ini menjadi TEPAT ${numberOfMeetings} pertemuan.` : 'Tentukan jumlah pertemuan (misal 2-4 pertemuan) yang ideal untuk TP ini.'}
       Pastikan setiap pertemuan berurutan dan logis.
    
    Pastikan output adalah JSON murni yang padat tanpa spasi atau baris baru berlebih di dalam nilai string.
  `;

  try {
    const requestBody = JSON.stringify({ prompt, schema: MATERIAL_SCHEMA });
    console.log(`[OpenAIService] Request size (Materials): ${(requestBody.length / 1024).toFixed(2)} KB`);

    const response = await robustFetch("/api/openai/generate-materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    }).catch(err => {
      console.error("Fetch materials error details:", err);
      throw new Error(`Koneksi terputus: ${err.message || "Gagal menghubungkan ke server."}`);
    });

    if (!response.ok) {
      let errorMsg = "Gagal merekomendasikan materi.";
      try {
        const errorData = await parseResponseJson(response);
        errorMsg = errorData.error || errorMsg;
      } catch (e) {
        errorMsg = `Server error (${response.status}): ${response.statusText}`;
      }
      throw new Error(errorMsg);
    }

    const { text } = await parseResponseJson(response);
    if (!text) throw new Error("AI tidak memberikan respon (kosong).");
    
    return safeParseJson(text);
  } catch (error: any) {
    console.error("OpenAI Material Error:", error);
    if (error.message?.includes('429') || error.message?.toLowerCase().includes('quota') || error.message?.toLowerCase().includes('limit')) {
      throw new Error(error.message);
    }
    throw new Error(error.message || "Gagal merekomendasikan materi. Silakan coba lagi.");
  }
}

const MODUL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    tpStatement: { type: Type.STRING, description: "Kalimat Tujuan Pembelajaran (TP)" },
    targetStudents: { type: Type.STRING, description: "Jenjang dan kelas target (WAJIB SESUAI DENGAN KELAS INPUT, JANGAN MENGARANG)" },
    duration: { type: Type.STRING, description: "Alokasi waktu (WAJIB SESUAI JP YANG DIBERIKAN. misal jika 3 JP: '3 JP' atau '3 x 45 menit')" },
    ppp: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "Dimensi Profil Lulusan yang relevan"
    },
    media: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "Media, alat, dan bahan pembelajaran"
    },
    meaningfulUnderstanding: { type: Type.STRING, description: "Pemahaman Bermakna" },
    triggerQuestions: { 
      type: Type.ARRAY, 
      items: { type: Type.STRING },
      description: "Pertanyaan Pemantik"
    },
    model: { type: Type.STRING },
    meetingActivities: {
      type: Type.ARRAY,
      description: "Rincian kegiatan pembelajaran yang dipisah per pertemuan (sesi)",
      items: {
        type: Type.OBJECT,
        properties: {
          session: { type: Type.INTEGER, description: "Nomor pertemuan (misal: 1, 2, dst)" },
          activityTitle: { type: Type.STRING, description: "Fokus atau Topik Kegatan pada pertemuan tersebut" },
          steps: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                phase: { type: Type.STRING, description: "Nama tahapan atau sintaks kegiatan (misal: Pendahuluan, Atau nama SINTAKS kegiatan Inti sesuai model, Penutup)" },
                activity: { type: Type.STRING, description: "Penjelasan SANGAT RINCI tentang aktivitas apa yang dilakukan guru dan apa yang dilakukan siswa beserta dengan rentang waktu." }
              },
              required: ["phase", "activity"]
            }
          }
        },
        required: ["session", "activityTitle", "steps"]
      }
    },
    assessment: { type: Type.STRING, description: "Metode penilaian yang digunakan" },
    differentiation: { type: Type.STRING, description: "Strategi diferensiasi (konten/proses/produk)" },
    rubrics: { type: Type.STRING, description: "Rubrik penilaian dalam format HTML (tabel)" }
  },
  required: [
    "title", "tpStatement", "targetStudents", "duration", "ppp", "media", 
    "meaningfulUnderstanding", "triggerQuestions", "model", 
    "meetingActivities", "assessment", "differentiation", "rubrics"
  ]
};

export async function generateKelengkapanModulOtomatis(modul: ModulAjar): Promise<{lampiran?: string, soal?: string, materi?: string, lkpd?: string}> {
  const meetingDetails = modul.meetingActivities?.map(ma => {
    const stepsStr = ma.steps?.map(s => `- [${s.phase}] ${s.activity}`).join('\n') || '';
    return `Pertemuan Ke-${ma.session}: ${ma.activityTitle}\nLangkah Kegiatan:\n${stepsStr}`;
  }).join('\n\n') || 'Tidak ada detail aktivitas pertemuan khusus.';

  const prompt = `Anda adalah ahli kurikulum ahli dari Kemdikbudristek dengan standar penulisan bahan ajar tertinggi. Analisis Modul Ajar berjudul "${modul.title}" berikut ini.

Tujuan Pembelajaran: 
${modul.tpStatement}

Model Pembelajaran: 
${modul.model}

Asesmen (Awal/Formatif/Sumatif): 
${modul.assessment}

Diferensiasi: 
${modul.differentiation}

Rencana Kegiatan Pembelajaran per Pertemuan:
${meetingDetails}

Tugas Anda:
Lakukan analisis mendalam terhadap seluruh rangkaian kegiatan pembelajaran per pertemuan di atas. Kemudian buatlah semua kelengkapan modul berikut yang DIBUAT SECARA SANGAT LENGKAP, DETAIL, DAN SANGAT PROFESIONAL UNTUK ALUR TIAP PERTEMUAN.

PENTING UNTUK FORMATTING:
Anda WAJIB memisahkan konten (Materi, LKPD, Soal, Lampiran) dengan jelas berdasarkan Pertemuan-nya. Susunlah dengan judul menggunakan tag <h3> dengan format eksplisit: "Pertemuan 1", "Pertemuan 2", dst. Ini sangat krusial agar sistem dapat memisahkan lampiran berdasarkan pertemuan untuk di-render terpisah!

1. **Materi Ajar (materi)**:
   - Tuliskan materi ajar secara utuh dan mendalam, WAJIB disesuaikan dengan KKTP di setiap pertemuan. Jelaskan konsep, definisi, contoh kasus nyata, dan penjelasannya untuk setiap pertemuan secara SANGAT EKSPLISIT (misal: "<h3>Materi Pertemuan 1</h3>", "<h3>Materi Pertemuan 2</h3>", dst). Sertakan referensi/dasar pendapat ahli beserta tahunnya untuk memperkuat materi secara akademik. Jika terdapat bagian yang memerlukan visualisasi atau pendalaman, sertakan link video pembelajaran (YouTube) yang relevan dan dapat diakses untuk dipelajari siswa.
   - Pastikan panjang teks mencukupi untuk dibaca siswa sebagai bahan belajar utama (minimalkan penggunaan kalimat pemotong atau ringkasan dangkal).
   - Format HTML murni.

2. **Lembar Kerja Peserta Didik (LKPD) (lkpd)**:
   - Buat panduan kerja siswa, instruksi diskusi kelompok, aktivitas observasi, bahan analisis, dan form/tabel isian yang komplit untuk tiap pertemuan, WAJIB dipisahkan per pertemuan (misal: "<h3>LKPD Pertemuan 1</h3>", "<h3>LKPD Pertemuan 2</h3>", dst).
   - JANGAN menggunakan placeholder seperti "Tuliskan jawaban Anda di sini (dan seterusnya...)" atau "Mengerjakan tugas halaman 10...". Tuliskan kasus, skenario, tabel isian kosong secara eksplisit, dan panduan langkah demi langkah berproses yang riil dikerjakan di kelas.
   - Format HTML murni.

3. **Soal Evaluasi / Asesmen (soal)**:
   - Sediakan paket soal penguji pemahaman bertingkat (dari tingkat LOTS hingga HOTS), pisahkan juga pemetaannya per pertemuan jika relevan (misal: "<h3>Soal Pertemuan 1</h3>").
   - Tuliskan soal pilihan ganda (minimal 5 soal lengkap beserta pilihan A, B, C, D, E) dan soal esai (minimal 3 soal pemecahan masalah) secara lengkap.
   - PENTING: Pada bagian Asesmen Akhir, Anda WAJIB menyertakan teks naskah soal lengkap secara eksplisit beserta kunci jawaban dan pembahasan rasionalnya. Jangan hanya menulis abstrak/kriteria evaluasi atau metodologinya saja!
   - Kunci Jawaban dan pembahasan soal WAJIB sesuai dengan materi ajar yang telah disusun pada bagian "Materi Ajar (materi)".
   - Cantumkan Kunci Jawaban Lengkap dan Pembahasan logis dari masing-masing soal tersebut.
   - Format HTML murni.

4. **Lampiran (lampiran)**:
   - Buatlah format instrumen penilaian sikap (dimensi profil lulusan), rubrik penilaian unjuk kerja/proyek yang sangat detail (lengkap dengan tabel kriteria, indikator, dan skor/kondisi nilai 1-4), serta daftar lembar refleksi mandiri untuk siswa dan guru di setiap sesi pembelajaran. Berikan header jelas per pertemuan (misal: "<h3>Lampiran Pertemuan 1</h3>"). Rubrik penilaian WAJIB selaras dengan KKTP setiap pertemuan.
   - PENTING: Dalam rubrik Asesmen Akhir / Sumatif, Anda WAJIB menyisipkan naskah lembar/soal tes tertulis yang riil untuk dikerjakan siswa (misal: soal esai analisis kasus atau pilihan ganda) sebagai instrumen evaluasi utama yang terlampir.
   - Format HTML murni.

WAJIB - INTEGRASI DIAGRAM & GAMBAR VISUAL EDUKATIF:
Jika terdapat bagian materi, LKPD, soal, atau lampiran yang membutuhkan visualisasi (misal: siklus hidup, diagram alur, mind map, grafik koordinat/geometri, atau gambar penunjang pemahaman konten), Anda HARUS menyertakan salah satu dari media berikut secara langsung di dalam markup HTML:
a) **Gambar Vektor SVG Terintegrasi**: Buatlah diagram menggunakan tag \`<svg viewBox="..." class="mx-auto my-6 bg-slate-50 rounded-xl p-4 border" style="max-width:100%; height:auto;">\` yang lengkap dengan bentuk (rect, circle, line, path) berwarna pastel modern, teks label yang terbaca jelas, dan panah arusnya. Sangat cocok untuk model, siklus, diagram alir, dan bagan konsep.
b) **Gambar Ilustrasi Edukatif (Unsplash)**: Gunakan tag \`<img src="..." alt="..." referrerpolicy="no-referrer" class="w-full max-w-lg mx-auto rounded-2xl border my-6 shadow-sm bg-white" />\` dengan URL gambar pendidikan yang stabil dari Unsplash. Beberapa contoh keyword yang harus disesuaikan:
   - Untuk umum/kelas/guru: \`https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?auto=format&fit=crop&w=600&h=400\`
   - Untuk teknologi/komputer/koding: \`https://images.unsplash.com/photo-1542831371-29b0f74f9713?auto=format&fit=crop&w=600&h=400\`
   - Untuk sains/laboratorium/percobaan: \`https://images.unsplash.com/photo-1507668077129-56e32842fceb?auto=format&fit=crop&w=600&h=400\`
   - Untuk matematika/geometri/rumus: \`https://images.unsplash.com/photo-1635070041078-e363dbe005cb?auto=format&fit=crop&w=600&h=400\`
   - Untuk geografi/alam/bumi: \`https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=600&h=400\`
   - Untuk bahasa/buku/literasi: \`https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=600&h=400\`
   Pastikan tag img SELALU menyertakan atribut referrerpolicy="no-referrer" dan alt yang informatif.

KATA KUNCI KEKUATAN KONTEN:
- Hindari kata singkatan atau placeholder seperti "dsb.", "dan seterusnya", "dst.".
- Semua skenario dan latihan harus ditulis secara utuh, konkret, aplikatif, dan kontekstual.
- Tampilkan materi, instrumen, penugasan, dan rubrik asesmen dalam tabel yang terstruktur indah dengan garis tabel (\`border\`) yang terlihat rapi.

Ketentuan Pelengkap:
- Analisis apa saja yang BENAR-BENAR dibutuhkan (sesuai modul). Jika tidak dibutuhkan sama sekali untuk modul ini (misal tidak ada penugasan kelompok sehingga tidak butuh LKPD), jangan isi field tersebut (kosongkan nilainya).
- Gunakan markup HTML murni yang rapi dan terstruktur (seperti <h3>, <h4>, <p>, <ul>, <ol>, <li>, <table>, <tr>, <th>, <td>, <b>, <strong>).
- JANGAN membungkus hasil string dengan markdown triple backticks (\`\`\`html) agar tidak merusak formatting render.
- PENTING: Jangan menghasilkan spasi kosong, tab, atau baris baru (\n) yang berulang-ulang tanpa konten di bagian akhir data. Selesaikan dan tutup JSON dengan rapi dan rapat setelah tag penutup HTML terakhir selesai agar tidak terpotong.`;

  const schema = {
    type: Type.OBJECT,
    properties: {
      lampiran: { type: Type.STRING, description: "Isi lampiran penilaian/refleksi/rubrik per pertemuan dalam format HTML murni" },
      soal: { type: Type.STRING, description: "Isi soal evaluasi bertingkat beserta kunci jawaban dalam format HTML murni" },
      materi: { type: Type.STRING, description: "Isi teks materi ajar per-pertemuan dalam format HTML murni" },
      lkpd: { type: Type.STRING, description: "Isi LKPD interaktif per-pertemuan dengan instruksi jelas dalam format HTML murni" }
    },
    required: ["lampiran", "soal", "materi", "lkpd"]
  };

  const requestBody = JSON.stringify({
    prompt,
    schema
  });

  const response = await robustFetch("/api/openai/generate-kelengkapan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: requestBody,
  }).catch(err => {
    throw new Error(`Koneksi terputus: ${err.message}`);
  });

  if (!response.ok) {
    const errorData = await parseResponseJson(response).catch(() => ({}));
    throw new Error(errorData.error || "Layanan AI tidak merespon.");
  }

  const { text } = await parseResponseJson(response);
  if (!text) throw new Error("AI tidak memberikan respon.");
  
  let parsed: any = {};
  try {
    parsed = safeParseJson(text);
  } catch (err) {
    console.warn("safeParseJson failed, attempting extractKeysFromInvalidJson fallback...", err);
    parsed = extractKeysFromInvalidJson(text);
  }

  return {
    lampiran: parsed.lampiran || undefined,
    soal: parsed.soal || undefined,
    materi: parsed.materi || undefined,
    lkpd: parsed.lkpd || undefined
  };
}

export async function generateLampiran(modul: ModulAjar): Promise<string> {
  const meetingDetails = modul.meetingActivities?.map(ma => {
    const stepsStr = ma.steps?.map(s => `- [${s.phase}] ${s.activity}`).join('\n') || '';
    return `Pertemuan Ke-${ma.session}: ${ma.activityTitle}\nLangkah Kegiatan:\n${stepsStr}`;
  }).join('\n\n') || '';

  const prompt = `Anda adalah ahli kurikulum ahli Kemdikbudristek. Buat lampiran luar biasa lengkap dan profesional untuk Modul Ajar berjudul "${modul.title}".

Tujuan Pembelajaran: ${modul.tpStatement}
Rencana Kegiatan Pembelajaran per Pertemuan:
${meetingDetails}

Instruksi Pembuatan Mandat Spesifik:
1. **Rubrik Penilaian Unjuk Kerja/Proyek Lengkap**: Buatlah tabel rubrik dengan kriteria penilaian yang jelas, skala nilai (Sangat Baik [4], Baik [3], Cukup [2], Perlu Bimbingan [1]), beserta deskripsi capaian di setiap sel tabel. JANGAN mengosongkan sel atau menggunakan "dst.".
2. **Lembar Observasi Sikap Dimensi Profil Lulusan**: Sediakan lembar checklist rinci untuk menilai keimanan dan ketakwaan, kewargaan, bernalar kritis, kreativitas, kolaborasi, kemandirian, atau dimensi relevan lainnya.
3. **Instrumen Asesmen Akhir / Sumatif**: Anda WAJIB menyajikan naskah soal tes tertulis secara utuh dan lengkap (baik itu pilihan ganda maupun esai pemecahan masalah) sebagai bagian utama dari instrumen evaluasi ini, bukan sekadar teori/metode penilaian.
4. **Instrumen Refleksi Guru & Siswa**: Tuliskan minimal 5 pertanyaan refleksi yang mendalam bagi siswa, serta 5 aspek refleksi diagnostik bagi guru.
5. **Glosarium Istilah & Daftar Pustaka**: Tuliskan glosarium istilah-istilah sulit yang dipelajari beserta definisinya, dan daftar pustaka akademis formal sesuai jenjang.

WAJIB - DIAGRAM & GRAFIS VISUAL:
Jika relevan, Anda harus menyertakan diagram/visualisasi proses penilaian, siklus refleksi, atau bagan rubrik menggunakan tag <svg> (diagram vektor warna pastel yang menarik) ATAU menggunakan tag <img> dengan foto pendidikan Unsplash berkualitas tinggi (sertakan referrerpolicy="no-referrer" dan class penunjang seperti rounded-xl).

Sajikan dalam format HTML murni (gunakan tag seperti <h3>, <h4>, <p>, <ul>, <ol>, <li>, <table>, <tr>, <th>, <td>, <b> tanpa membungkus dengan melilit markup markdown). `;
  return await generateSimpleText(prompt);
}

export async function generateSoal(modul: ModulAjar): Promise<string> {
  const meetingDetails = modul.meetingActivities?.map(ma => {
    const stepsStr = ma.steps?.map(s => `- [${s.phase}] ${s.activity}`).join('\n') || '';
    return `Pertemuan Ke-${ma.session}: ${ma.activityTitle}\nLangkah Kegiatan:\n${stepsStr}`;
  }).join('\n\n') || '';

  const prompt = `Anda adalah ahli pengembang instrumen evaluasi pendidikan Kemdikbudristek. Buat soal evaluasi (Formatif & Sumatif) kelas secara lengkap, detail, dan profesional untuk Modul Ajar berjudul "${modul.title}".

Tujuan Pembelajaran: ${modul.tpStatement}
Asesmen yang direncanakan: ${modul.assessment}
Rencana Kegiatan Pembelajaran per Pertemuan:
${meetingDetails}

Instruksi Pembuatan Mandat Spesifik:
1. **Soal Pilihan Ganda Bertingkat**: Sediakan minimal 5 - 10 soal pilihan ganda yang komplit dengan opsi jawaban pilihan A, B, C, D, E. Soal harus berkisar dari soal mudah (LOTS) hingga analisis tinggi (HOTS).
2. **Soal Esai Analitis/Pemecahan Masalah**: Sediakan minimal 3 soal esai yang menuntut penalaran kritis, argumentasi ilmiah, dan analisis terapan.
3. **Kunci Jawaban & Rubrik Penilaian Soal**: Berikan kunci jawaban yang pasti untuk pilihan ganda & pedoman penskoran detail bagi soal esai.
4. **Pembahasan Terperinci**: Berikan alasan logis mengapa jawaban tersebut benar untuk mendukung umpan balik diagnostik siswa.

WAJIB - GAMBAR & VISUALISASI SOAL:
Jika salah satu soal (misalnya soal geometri, diagram sirkulasi, tabel data, silsilah keluarga, flowchart pilihan) membutuhkan ilustrasi/diagram gambar agar siswa dapat menjawab, Anda WAJIB membuat gambar tersebut menggunakan tag <svg> (vektor inline rapi dengan teks label jelas) atau tag <img> dengan gambar Unsplash yang tepat (sertakan referrerpolicy="no-referrer").

Berikan soal secara interaktif, berjenjang (LOTS hingga HOTS), beserta kunci jawabannya dalam format HTML murni (gunakan tag seperti <h3>, <p>, <ul>, <ol>, <li>, <b> tanpa melilit dengan markup markdown).`;
  return await generateSimpleText(prompt);
}

export async function generateMateri(modul: ModulAjar): Promise<string> {
  const meetingDetails = modul.meetingActivities?.map(ma => {
    const stepsStr = ma.steps?.map(s => `- [${s.phase}] ${s.activity}`).join('\n') || '';
    return `Pertemuan Ke-${ma.session}: ${ma.activityTitle}\nLangkah Kegiatan:\n${stepsStr}`;
  }).join('\n\n') || '';

  const prompt = `Anda adalah penulis buku teks pelajaran Kemdikbudristek. Tuliskan materi ajar lengkap, kaya informasi, dan sangat teoritis serta mudah dimengerti (buku teks mini komplit) untuk Modul Ajar berjudul "${modul.title}".

Tujuan Pembelajaran: ${modul.tpStatement}
Jenjang: ${modul.targetStudents}
Rencana Kegiatan Pembelajaran per Pertemuan:
${meetingDetails}

Instruksi Pembuatan Mandat Spesifik:
1. **Penjelasan Konseptual per Pertemuan**: Jabarkan materi ajar secara mendalam dan jelas untuk setiap pertemuan (Sesi Pertemuan 1, Sesi Pertemuan 2, dst). Berikan latar belakang, fakta, konsep utama, dan ulasan ilmiah yang mendalam.
2. **Ilustrasi Studi Kasus & Contoh Nyata**: Sajikan contoh aplikasi atau studi kasus kontekstual yang terjadi di kehidupan siswa sehari-hari untuk mempermudah visualisasi materi.
3. **Catatan Penting & Tips Belajar**: Berikan kotak informasi/warning khusus (seperti <blockquote> atau <div class="bg-yellow-50 p-4 border-l-4">) tentang konsep kritis yang sering memicu miskonsepsi.

WAJIB - DIAGRAM & ILUSTRASI MATERI:
Agar materi ajar sangat mendalam dan profesional, Anda WAJIB menyertakan diagram konseptual atau silsilah materi menggunakan elemen <svg> inline yang bergaya modern/pastel, atau menyisipkan tag <img> Unsplash yang spesifik dengan topik materi ini (contoh: ilustrasi eksperimen sains, peta, atau koordinat kartesian). Pastikan ada referrerpolicy="no-referrer" di tag img.

Sajikan dalam format HTML murni (gunakan tag seperti <h3>, <p>, <ul>, <ol>, <li>, <b> tanpa melilit dengan markup markdown) yang rapi, menarik, dan mudah dipahami siswa.`;
  return await generateSimpleText(prompt);
}

export async function generateLKPD(modul: ModulAjar): Promise<string> {
  const meetingDetails = modul.meetingActivities?.map(ma => {
    const stepsStr = ma.steps?.map(s => `- [${s.phase}] ${s.activity}`).join('\n') || '';
    return `Pertemuan Ke-${ma.session}: ${ma.activityTitle}\nLangkah Kegiatan:\n${stepsStr}`;
  }).join('\n\n') || '';

  const prompt = `Anda adalah ahli kurikulum ahli pengembang Lembar Kegiatan Siswa. Buat Lembar Kerja Peserta Didik (LKPD) yang berdiferensiasi secara sangat lengkap, detail, dan sistematis untuk Modul Ajar berjudul "${modul.title}".

Tujuan Pembelajaran: ${modul.tpStatement}
Model Pembelajaran: ${modul.model}
Strategi Diferensiasi: ${modul.differentiation}
Rencana Kegiatan Pembelajaran per Pertemuan:
${meetingDetails}

Instruksi Pembuatan Mandat Spesifik:
1. **LKPD Berjenjang per Pertemuan**: Sediakan panduan pengerjaan khusus untuk Pertemuan 1, Pertemuan 2, dst. Setiap bagian LKPD tidak boleh hanya berupa perintah satu baris, namun harus mencakup:
   - **Tujuan Aktivitas**: Apa target kerja yang ingin dicapai siswa.
   - **Alat & Bahan / Sumber Belajar**: Daftar hal-hal yang perlu disiapkan siswa di kelas.
   - **Langkah-langkah Kerja Eksploratif**: Instruksi runtut bagaimana siswa berdiskusi, bereksperimen, atau melakukan telaah pustaka.
   - **Tabel Isian Hasil Pengamatan**: Tabel kerja yang dikosongkan agar siswa dapat langsung mengisikan data observasi atau gagasan mereka di kelas.
   - **Pertanyaan Pemandu Diskusi**: Minimal 3 sampai 5 pertanyaan bernalar kritis mengenai pengolahan data atau penyimpulan hasil kerja.
2. **Diferensiasi Tugas**: Pisahkan atau sediakan petunjuk alternatif bagi kategori siswa (misal: Kelompok Belajar Mandiri, Kelompok yang Butuh Bimbingan Tambahan, kelompok pengayaan) di akhir LKPD agar strategi diferensiasi berjalan nyata.

WAJIB - DIAGRAM & LEMBAR ISIAN VISUAL:
Model LKPD harus interaktif dan profesional! Jika penugasan melibatkan diagram/pengisian bagan (misal siklus air, peta pikiran, atau tabel pengamatan), buatlah visualisasi berupa <svg> yang atraktif untuk dianalisis siswa, atau sediakan tabel/ruang kosong yang atraktif. Jikalau butuh ilustrasi foto pendukung kegiatan praktikum, gunakan tag <img> dengan foto Unsplash yang relevan (sertakan referrerpolicy="no-referrer").

Sajikan LKPD per tahapan lengkap dengan ruang jawaban dalam format HTML murni (gunakan tag seperti <h3>, <p>, <ul>, <ol>, <li>, <b> tanpa melilit dengan markup markdown).`;
  return await generateSimpleText(prompt);
}

async function generateSimpleText(prompt: string): Promise<string> {
  const schema = {
    type: Type.OBJECT,
    properties: {
      result: { type: Type.STRING, description: "Teks HTML konten murni yang dihasilkan AI" }
    },
    required: ["result"]
  };

  const requestBody = JSON.stringify({
    prompt,
    schema
  });

  const response = await robustFetch("/api/openai/generate-simple", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: requestBody,
  }).catch(err => {
    throw new Error(`Koneksi terputus: ${err.message}`);
  });

  if (!response.ok) {
    const errorData = await parseResponseJson(response).catch(() => ({}));
    throw new Error(errorData.error || "Layanan AI tidak merespon.");
  }

  const { text } = await parseResponseJson(response);
  if (!text) throw new Error("AI tidak memberikan respon.");
  
  const parsed = safeParseJson(text);
  return parsed.result || "";
}
export async function generateModulAjarFromATP(
  atpItem: ATPItem,
  phase: string,
  jpPerWeek: number,
  subject?: string
): Promise<ModulAjar> {
  const prompt = `
    Buatlah MODUL AJAR (RPP) PROFESIONAL DAN SANGAT DETAIL dalam format "Pembelajaran Mendalam" (Deep Learning).
    Patuhi pedoman terbaru dari BSKAP Kemdikbudristek tentang Panduan Pembelajaran dan Asesmen Kurikulum Merdeka.
    ${subject ? `Mata Pelajaran: ${subject}\nWAJIB: Seluruh konten modul harus sangat sesuai untuk mata pelajaran ${subject}.` : ''}
    Kelas/Fase: Kelas ${atpItem.classLevel} / Fase ${phase}
    
    KONTEKS ATP:
    Tujuan Pembelajaran: ${atpItem.tpStatement}
    Indikator Ketercapaian (KKTP): ${atpItem.kktp.join(', ')}
    Materi Inti: ${atpItem.content}
    Jumlah JP (Alokasi) untuk Modul ini: ${atpItem.jp} JP (Dalam ${atpItem.numberOfMeetings} kali pertemuan. Asumsi ${jpPerWeek} JP per minggu/pertemuan)
    
    INSTRUKSI UTAMA PENYUSUNAN ACARA PEMBELAJARAN (WAJIB DIPATUHI SECARA EKSPLISIT):
    1. Tentukan MODEL PEMBELAJARAN (LearningModel) terbaik yang PALING SESUAI dengan karakteristik Materi Inti tersebut. (Pilih salah satu: Problem Based Learning (PBL), Project Based Learning (PjBL), Inquiry Learning, Discovery Learning, atau Cooperative Learning). WAJIB TEPAT. Letakkan nama model ini di field "model".
    2. Modul ini digunakan untuk total waktu ${atpItem.jp} JP (sekitar ${atpItem.numberOfMeetings} pertemuan). Bagi langkah-langkah tersebut menjadi beberapa pertemuan dan masukkan ke dalam array "meetingActivities".
       **PERHATIAN KRUSIAL**: Anda WAJIB menggunakan nilai 'numberOfMeetings' yang DITERIMA DARI KONTEKS ATP (${atpItem.numberOfMeetings}) sebagai jumlah pertemuan mutlak di modul ini. JANGAN mengubah jumlah pertemuan.
       Masing-masing "meetingActivities" harus memiliki:
       - "session": dari angka 1 hingga ${atpItem.numberOfMeetings}
       - "activityTitle": Fokus atau topik spesifik apa yang akan dipelajari pada pertemuan ini.
       - "steps": AKTIVITAS HARUS SANGAT RINCI DAN LENGKAP! Langkah-langkah kegiatan belajar di sesi tersebut WAJIB dibagi menjadi 3 bagian utama dengan ketentuan berikut:
         
         a) **Pendahuluan**:
            - **WAJIB MENCAKUP**: Guru melakukan **Salam pembuka**, **Membuka kegiatan dengan Doa**, melakukan kehadiran siswa, melakukan **Apersepsi** yang relevan dengan materi, serta **Guru menyampaikan Tujuan Pembelajaran** secara jelas kepada siswa.
            - **Pertanyaan Pemantik**: Pertanyaan Pemantik wajib dicantumkan dalam langkah kegiatan (bisa diletakkan di bagian Pendahuluan untuk memicu rasa ingin tahu awal siswa, ATAU diletakkan di awal Kegiatan Inti sebagai orientasi masalah). Selaraskan ini dengan alur pembelajaran.
         
         b) **Kegiatan Inti**:
            - **WAJIB MENCAKUP SINTAKS MODEL PEMBELAJARAN**: Jabarkan langkah-langkah kegiatan inti secara terperinci tahap demi tahap sesuai dengan sintaks/fase asli dari Model Pembelajaran yang dipilih (PBL, PjBL, Inquiry, Discovery, atau Cooperative).
            - **AKTIVITAS GURU DAN SISWA**: Pada setiap fase sintaks, tuliskan dengan sangat jelas dan terpisah tentang **Apa yang harus dilakukan Guru** (instruksional, bimbingan, fasilitasi) dan **Apa yang harus dilakukan oleh Siswa** (eksplorasi, diskusi, eksperimen, analisis) beserta alokasi waktu menitnya. JANGAN membuat kalimat singkat/umum.
            - **Diferensiasi**: Pastikan ada implementasi strategi diferensiasi proses/konten yang terintegrasi secara praktis dalam langkah kegiatan inti ini.
         
         c) **Penutup**:
            - **WAJIB MENCAKUP**: Melakukan **Refleksi** bersama antara guru dan siswa, merumuskan **Kesimpulan** materi secara mendalam, serta ditutup dengan **Doa pulang/Doa penutup** dan salam.
        
        ATURAN FORMAT PENULISAN LANGKAH KEGIATAN PEMBELAJARAN (SANGAT KRUSIAL):
        - Di setiap field 'activity' untuk 'steps', Anda **WAJIB** menuliskan rangkaian rincian rute aktivitas belajar mengajar dalam bentuk **daftar penomoran berurutan dari atas ke bawah (mulai 1, 2, 3, dst.)**.
        - Setiap nomor aktivitas **WAJIB** dilengkapi dengan alokasi estimasi waktu spesifik di dalam tanda kurung, misalnya: '(... menit)'.
        - Contoh format penulisan 'activity' pada Pendahuluan/Kegiatan Inti/Penutup:
          1. Guru membuka pembelajaran dengan salam santun dan mengajak siswa berdoa bersama dipimpin ketua kelas (3 menit).
          2. Guru mengecek kehadiran siswa dan kesiapan ruang kelas (2 menit).
          3. Guru memberikan apersepsi menyenangkan dan mengaitkannya dengan topik hari ini (5 menit).
          4. Guru mendiskusikan pertanyaan pemantik untuk memicu keterlibatan aktif siswa (3 menit).
          5. Guru menyajikan tujuan pembelajaran secara jelas di papan tulis (2 menit).
        - Aturan penomoran baris (1, 2, 3...) dan pencantuman waktu per sub-aktivitas di atas adalah **WAJIB MUTLAK** untuk isi Pendahuluan, seluruh sintaks Kegiatan Inti, dan isi Penutup. JANGAN menyajikan teks dalam satu paragraf panjang atau bullet points.
            
    3. Tentukan "duration". Tuliskan "Total ${atpItem.jp} JP (${atpItem.numberOfMeetings} Pertemuan)".
    4. Isi field "targetStudents": "Kelas ${atpItem.classLevel}".
    5. WAJIB MENGGUNAKAN: Capaian Pembelajaran (CP) lengkap dan resmi dari Keputusan BSKAP terbaru (bukan diringkas).
    6. WAJIB MENGGUNAKAN: Dimensi Profil Lulusan terbaru: Keimanan dan ketakwaan, Kewargaan, Bernalar kritis, Kreativitas, Kolaborasi, dan Kemandirian. Sertakan Pemahaman Bermakna dan Pertanyaan Pemantik yang relevan dan mendalam.
    7. WAJIB MENGGUNAKAN: KKTP sebagai pernyataan operasional yang terukur (contoh: "Peserta didik mampu menjelaskan...", "Peserta didik mampu mengidentifikasi..."), BUKAN kalimat tanya/soal.
    8. WAJIB MENGGUNAKAN: Asesmen Sumatif secara spesifik (sebutkan jenis soal, jumlah soal, dan materi yang dicakup).
    9. WAJIB MENGGUNAKAN: Sumber Belajar resmi: Buku IPS SMP Kelas VII Kurikulum Merdeka (Kemendikbud), Portal Rumah Belajar, atau Video Pembelajaran resmi Kemendikbud.
    10. Field "differentiation": Jelaskan dengan SANGAT SPESIFIK bentuk diferensiasi Konten, Proses, dan Produk yang digunakan pada modul ini.
    11. Field "rubrics": Buatlah rubrik penilaian yang detail (aspek, skor 1-4, deskripsi) dalam format tabel HTML untuk asesmen formatif dan sumatif.
    
    Output harus berupa JSON murni tanpa spasi/baris baru berlebih di dalam nilai string.
  `;

  try {
    const requestBody = JSON.stringify({ prompt, schema: MODUL_SCHEMA });

    const response = await robustFetch("/api/openai/generate-modul", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    }).catch(err => {
      console.error("Fetch modul error details:", err);
      throw new Error(`Koneksi terputus: ${err.message || "Gagal menghubungkan ke server."}`);
    });

    if (!response.ok) {
      let errorMsg = "Gagal membuat modul ajar.";
      try {
        const errorData = await parseResponseJson(response);
        errorMsg = errorData.error || errorMsg;
      } catch (e) {
        errorMsg = `Server error (${response.status}): ${response.statusText}`;
      }
      throw new Error(errorMsg);
    }

    const { text } = await parseResponseJson(response);
    if (!text) throw new Error("AI tidak memberikan respon (kosong).");
    
    try {
      const parsed = safeParseJson(text);
      return parsed as ModulAjar;
    } catch (parseError: any) {
      console.error("JSON parse error:", parseError, "Raw text:", text);
      throw new Error(`Format respon AI tidak valid: ${parseError.message}`);
    }
  } catch (error: any) {
    if (error.message?.includes('429') || error.message?.toLowerCase().includes('quota') || error.message?.toLowerCase().includes('limit')) {
      throw new Error("Batas penggunaan API/Token bulanan telah tercapai. Harap periksa tagihan Anda di OpenAI.");
    }
    throw new Error(error.message || "Gagal membuat modul ajar.");
  }
}

export async function generateModulAjar(
  tp: TujuanPembelajaran, 
  session: number, 
  activity: string, 
  model: LearningModel,
  jpPerWeek?: number,
  subject?: string
): Promise<ModulAjar> {
  const prompt = `
    Buatlah MODUL AJAR (RPP) PROFESIONAL DAN SANGAT DETAIL dalam format "Pembelajaran Mendalam" (Deep Learning) untuk Pertemuan ke-${session}.
    Patuhi pedoman terbaru dari BSKAP Kemdikbudristek tentang Panduan Pembelajaran dan Asesmen Kurikulum Merdeka.
    ${subject ? `Mata Pelajaran: ${subject}` : ''}
    Kelas/Fase: Kelas ${tp.classLevel}
    
    KONTEKS:
    Tujuan Pembelajaran: ${tp.statement}
    Kriteria (KKTP): ${tp.kktp.join(', ')}
    Aktivitas Fokus: ${activity}
    Model Pembelajaran yang Diminta: ${model}
    ${jpPerWeek ? `Alokasi Waktu Mata Pelajaran: ${jpPerWeek} JP per minggu.` : ''}
    
    INSTRUKSI UTAMA PENYUSUNAN ACARA PEMBELAJARAN (WAJIB DIPATUHI SECARA EKSPLISIT):
    1. Elaborasi aktivitas fokus menjadi langkah-langkah pembelajaran yang SANGAT RINCI, DINAMIS, dan PROFESIONAL. Masukkan rincian kegiatan ini ke dalam array "meetingActivities" dengan "session" diisi ${session}. Langkah-langkah kegiatan belajar di sesi tersebut WAJIB dibagi menjadi 3 bagian utama dengan ketentuan berikut:
       
       a) **Pendahuluan (Pembuka)**:
          - **WAJIB MENCAKUP**: Guru melakukan **Salam pembuka**, **Membuka kegiatan dengan Doa**, memeriksa kehadiran siswa, melakukan **Apersepsi** hangat yang relevan dengan materi, serta **Guru menyampaikan Tujuan Pembelajaran** yang akan dicapai secara jelas kepada siswa.
          - **Pertanyaan Pemantik**: Pertanyaan Pemantik wajib dicantumkan dalam langkah kegiatan (bisa diletakkan di bagian Pendahuluan untuk memicu ketertarikan awal, ATAU diletakkan di awal Kegiatan Inti sebagai dasar pemikiran kritis/studi kasus). Selaraskan ini secara kontekstual.
       
       b) **Kegiatan Inti**:
          - **WAJIB MENCAKUP SINTAKS MODEL PEMBELAJARAN**: Tuliskan eksplisit setiap tahap/sintaks asli dari model pembelajaran yang diminta (${model}) satu demi satu secara berurutan.
          - **AKTIVITAS GURU DAN SISWA**: Pada setiap fase sintaks, jelaskan dengan sangat rinci tentang **Apa yang harus dilakukan Guru** (membimbing, mengamati, memandu diskusi, memberikan scaffolding) dan **Apa yang harus dilakukan oleh Siswa** (bekerja kelompok, menganalisis data, mempresentasikan hasil, melakukan eksplorasi mandiri) beserta waktu pengerjaannya (dalam menit). Hindari generalisasi umum.
          - **Diferensiasi**: Pastikan ada implementasi strategi diferensiasi proses/konten yang terintegrasi di dalam kegiatan inti ini.
          - **RUBRIK PENILAIAN HARIAN**: WAJIB sertakan rubrik penilaian harian (format tabel) untuk kegiatan di pertemuan ini.
       
       c) **Penutup**:
          - **WAJIB MENCAKUP**: Guru dan siswa bersama-sama melakukan **Refleksi** pembelajaran, merumuskan **Kesimpulan** materi yang bermakna dan mendalam, serta ditutup dengan **Doa pulang/Doa penutup** dan salam hangat.
         
        ATURAN FORMAT PENULISAN LANGKAH KEGIATAN PEMBELAJARAN (SANGAT KRUSIAL):
        - Di setiap field 'activity' untuk 'steps', Anda **WAJIB** menuliskan rangkaian rincian rute aktivitas belajar mengajar dalam bentuk **daftar penomoran berurutan dari atas ke bawah (mulai 1, 2, 3, dst.)**.
        - Setiap nomor aktivitas **WAJIB** dilengkapi dengan alokasi estimasi waktu spesifik di dalam tanda kurung, misalnya: '(... menit)'.
        - Contoh format penulisan 'activity' pada Pendahuluan/Kegiatan Inti/Penutup:
          1. Guru membuka pembelajaran dengan salam santun dan mengajak siswa berdoa bersama dipimpin ketua kelas (3 menit).
          2. Guru mengecek kehadiran siswa dan kesiapan ruang kelas (2 menit).
          3. Guru memberikan apersepsi menyenangkan dan mengaitkannya dengan topik hari ini (5 menit).
          4. Guru mendiskusikan pertanyaan pemantik untuk memicu keterlibatan aktif siswa (3 menit).
          5. Guru menyajikan tujuan pembelajaran secara jelas di papan tulis (2 menit).
        - Aturan penomoran baris (1, 2, 3...) dan pencantuman waktu per sub-aktivitas di atas adalah **WAJIB MUTLAK** untuk isi Pendahuluan, seluruh sintaks Kegiatan Inti, dan isi Penutup. JANGAN menyajikan teks dalam satu paragraf panjang atau bullet points.
          
    2. Sertakan Tujuan Pembelajaran (tpStatement) dalam bentuk POIN-POIN (bullet points) yang dipisahkan baris baru.
    3. Tentukan "duration" (alokasi waktu per pertemuan). WAJIB TEPAT ${jpPerWeek || 3} JP (Jam Pelajaran). Tulis dalam format "${jpPerWeek || 3} JP".
    4. Isi field "targetStudents" DENGAN TEPAT SESUAI KELAS: "Kelas ${tp.classLevel}".
    5. MUST INCLUDE: Dimensi Profil Lulusan, Pemahaman Bermakna, dan Pertanyaan Pemantik.
    6. MUST INCLUDE: Pendekatan Asesmen Awal Pembelajaran (Kognitif/Non-kognitif) pada bagian awal Kegiatan Pembelajaran (Pendahuluan), Asesmen Formatif selama inti pembelajaran, dan atau Asesmen Sumatif. Jika terdapat asesmen sumatif, WAJIB sertakan butir soal secara lengkap.
    7. MUST INCLUDE: Implementasi Pembelajaran Berdiferensiasi (Konten/Proses/Produk). Field "differentiation" HARUS mendeskripsikan ini secara jelas.
    8. **KORELASI LANGKAH & LAMPIRAN**: Anda **WAJIB** memastikan bahwa seluruh instrumen asesmen (soal, rubrik, lembar kerja) yang disebutkan atau direncanakan dalam langkah-langkah pembelajaran (kegiatan inti/sumatif) **harus ditampilkan secara utuh** di bagian Lampiran Modul.
    9. Pastikan pembelajarannya mencerminkan prinsip Pembelajaran Mendalam (Deep Learning) melalui aktivitas yang merangsang analisis kritis, kolaborasi, dan penalaran.
    
    Output harus berupa JSON murni tanpa spasi/baris baru berlebih di dalam nilai string.
  `;

  try {
    const requestBody = JSON.stringify({ tp, session, activity, model, jpPerWeek, prompt, schema: MODUL_SCHEMA });
    console.log(`[OpenAIService] Request size (Modul): ${(requestBody.length / 1024).toFixed(2)} KB`);

    const response = await robustFetch("/api/openai/generate-modul", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    }).catch(err => {
      console.error("Fetch modul error details:", err);
      throw new Error(`Koneksi terputus: ${err.message || "Gagal menghubungkan ke server."}`);
    });

    if (!response.ok) {
      let errorMsg = "Gagal membuat modul ajar.";
      try {
        const errorData = await parseResponseJson(response);
        errorMsg = errorData.error || errorMsg;
      } catch (e) {
        errorMsg = `Server error (${response.status}): ${response.statusText}`;
      }
      throw new Error(errorMsg);
    }

    const { text } = await parseResponseJson(response);
    if (!text) throw new Error("AI tidak memberikan respon (kosong).");
    
    return safeParseJson(text);
  } catch (error: any) {
    console.error("OpenAI Modul Error:", error);
    if (error.message?.includes('429') || error.message?.toLowerCase().includes('quota') || error.message?.toLowerCase().includes('limit')) {
      throw new Error(error.message);
    }
    throw new Error(error.message || "Gagal membuat Modul Ajar. Silakan coba lagi.");
  }
}

const ATP_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          tpId: { type: Type.STRING },
          tpStatement: { type: Type.STRING },
          cp: { type: Type.STRING, description: "Potongan Capaian Pembelajaran (CP) yang relevan" },
          element: { type: Type.STRING },
          competency: { type: Type.STRING },
          content: { type: Type.STRING, description: "Konten/Materi pembelajaran" },
          kktp: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Indikator Ketercapaian (KKTP)" },
          jp: { type: Type.NUMBER, description: "Alokasi waktu dalam Jam Pelajaran (JP)" },
          assessment: { type: Type.STRING, description: "Jenis penilaian dan instrumennya" },
          flow: { type: Type.NUMBER, description: "Urutan logis (1, 2, 3...)" },
          resources: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Sumber belajar spesifik" },
          keywords: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Kata-kata kunci materi" },
          p3: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Dimensi Profil Lulusan" },
          classLevel: { type: Type.STRING },
          numberOfMeetings: { type: Type.NUMBER, description: "Jumlah pertemuan yang dibutuhkan untuk TP ini" },
          semester: { type: Type.INTEGER, description: "Semester 1 (Ganjil) atau 2 (Genap)" },
          startWeek: { type: Type.INTEGER, description: "Minggu pelaksanaan dimulai (Semester 1: minggu 1-18, Semester 2: minggu 1-18/19-36)" },
          endWeek: { type: Type.INTEGER, description: "Minggu pelaksanaan berakhir" }
        },
        required: ["tpId", "tpStatement", "cp", "element", "competency", "content", "kktp", "jp", "assessment", "flow", "resources", "keywords", "p3", "classLevel", "numberOfMeetings", "semester", "startWeek", "endWeek"]
      }
    },
    rationale: { type: Type.STRING, description: "Rasionalisasi urutan alur tujuan pembelajaran" }
  },
  required: ["items", "rationale"]
};

export async function generateATP(mapping: MappingResult, jpPerWeek: number, meetingsPerWeek: number, subject?: string): Promise<AlurTujuanPembelajaran> {
  // Extract unique class levels from the mapping
  const classLevels = [...new Set(mapping.tujuanPembelajaran.map(t => t.classLevel))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  
  if (classLevels.length === 0) {
    throw new Error("Tidak ada data Tujuan Pembelajaran untuk disusun.");
  }
  
  const generateForClass = async (classLevel: string) => {
    const tpsForClass = mapping.tujuanPembelajaran.filter(t => t.classLevel === classLevel);
    const tpList = tpsForClass.map(t => `- ID: ${t.id}, TP: ${t.statement}, Elemen: ${t.element}, Kelas: ${t.classLevel}`).join('\n');
    
    const prompt = `
      Anda adalah pakar kurikulum senior Kurikulum Merdeka di Indonesia.
      Tugas: Susunlah ALUR TUJUAN PEMBELAJARAN (ATP) yang SANGAT DETAIL dan LENGKAP untuk Fase ${mapping.phase} Kelas ${classLevel}.
      ${subject ? `Mata Pelajaran: ${subject}` : ''}
      
      KONTEKS:
      Daftar Tujuan Pembelajaran (TP) untuk Kelas ${classLevel}:
      ${tpList}
      
      Alokasi Waktu Mata Pelajaran: ${jpPerWeek} JP per minggu.
      Jumlah Pertemuan per Minggu: ${meetingsPerWeek} pertemuan.
      
      INSTRUKSI PENYUSUNAN ATP PROFESIONAL (TERMASUK PROTA & PROSEM):
      1. Urutkan TP secara logis dan pedagogis (misal: prasyarat -> materi inti -> pengayaan).
      2. WAJIB: PASTIKAN SEMUA TP DALAM DAFTAR DI ATAS MASUK KE DALAM OUTPUT. JANGAN ADA YANG TERLEWAT.
      3. JUMLAH JP & PERTEMUAN (ATURAN MATEMATIS SANGAT KETAT!): 
         - 1 Tahun Ajaran memiliki 36 Minggu efektif (Semester 1 = 18 minggu, Semester 2 = 18 minggu).
         - TOTAL KESELURUHAN field "numberOfMeetings" dari SEMUA TP di Kelas ${classLevel} INI WAJIB MENCAPAI ANGKA 36.
         - ATURAN PERHITUNGAN MINGGU (WAJIB DIPATUHI): Jumlah Minggu (numberOfMeetings) = (Total JP per TP / ${jpPerWeek}) * ${meetingsPerWeek}.
         - Hasil pembagian HARUS dibulatkan ke atas jika tidak bulat (Math.ceil).
         - Contoh: Jika Total JP per TP adalah 36, ${jpPerWeek} JP/minggu, dan ${meetingsPerWeek} pertemuan/minggu, maka numberOfMeetings = (36 / ${jpPerWeek}) * ${meetingsPerWeek}.
         - Field "jp" di setiap TP adalah total JP yang dialokasikan untuk TP tersebut.
         - **PERHATIAN KRUSIAL**: Nilai 'numberOfMeetings' (minggu) yang Anda tentukan di ATP INI akan menjadi jumlah minggu MUTLAK yang WAJIB digunakan sebagai dasar perhitungan di Modul Ajar, Prota, dan Prosem. DAN HARUS SAMA DENGAN (endWeek - startWeek + 1).
      4. PROGRAM TAHUNAN & SEMESTER (PROTA/PROSEM):
         - Alokasikan TP secara berurutan. TP awal masuk "semester": 1 (Ganjil), TP berikutnya "semester": 2 (Genap). Semester 1 maksimal menggunakan 18 minggu efektif.
         - Hitung startWeek dan endWeek secara kumulatif berdasarkan numberOfMeetings. Rumus: Jika TP sebelumnya berakhir di endWeek X, maka: startWeek = X + 1, endWeek = X + numberOfMeetings.
         - **WAJIB**: Pastikan total jumlah minggu di prosem sesuai dengan total numberOfMeetings. StartWeek dan endWeek harus konsisten dengan jumlah pertemuan.
      5. CP & ELEMEN: 
         - Cantumkan potongan Capaian Pembelajaran (CP) asli yang relevan dengan TP tersebut.
         - Pastikan "element" (nama elemen) sesuai dengan kategori yang sudah ditentukan di TP.
      6. Konten/Materi: Jabarkan materi pembelajaran secara spesifik dan mendalam yang SANGAT RELEVAN.
      7. KKTP (Indikator): Pembuatan Kriteria Ketercapaian Tujuan Pembelajaran (KKTP) wajib dianalisis secara mendalam menggunakan **Taksonomi Bloom** (tingkat kognitif C1 s.d. C6). Berikan 3-4 kriteria/indikator ketercapaian yang konkret, detail, dan terukur untuk setiap TP. Di setiap butir KKTP, Anda **WAJIB** mencantumkan level kognitif Bloom di dalam tanda kurung siku di awal kalimat secara eksplisit (misalnya: [C1 - Mengingat], [C2 - Memahami], [C3 - Menerapkan], [C4 - Menganalisis], [C5 - Mengevaluasi], [C6 - Menciptakan]) diikuti penjelasan detail kemampuan siswa dengan Kata Kerja Operasional (KKO) yang relevan, spesifik, dan tidak disingkat.
         
         **ATURAN MUTLAK KKTP**: KKTP harus berupa pernyataan operasional yang terukur (pernyataan deklaratif, diawali dengan KKO seperti 'Peserta didik mampu...' atau 'Siswa dapat...'). **DILARANG KERAS MENGGUNAKAN KALIMAT TANYA, TANDA TANYA (?), ATAU BENTUK INSTRUMEN PERTANYAAN/SOAL**. KKTP adalah kriteria ketercapaian, bukan pertanyaan evaluasi atau latihan soal.
      8. Assessment: Sebutkan jenis asesmen (Formatif/Sumatif) yang variatif.
      9. Sumber Belajar & Dimensi Profil Lulusan: Berikan sumber belajar dan Dimensi Profil Lulusan yang relevan.
      
      Output HARUS JSON murni mengikuti skema.
    `;

    const requestBody = JSON.stringify({ prompt, schema: ATP_SCHEMA });
    console.log(`[OpenAIService] Request size (Class ${classLevel}): ${(requestBody.length / 1024).toFixed(2)} KB`);
    
    const response = await robustFetch("/api/openai/generate-atp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    }).catch(err => {
      console.error(`Fetch ATP error details for class ${classLevel}:`, err);
      throw new Error(`Koneksi terputus: ${err.message || "Gagal menghubungkan ke server."}`);
    });

    if (!response.ok) {
      let errorMsg = `Gagal menyusun ATP Kelas ${classLevel}.`;
      try {
        const errorData = await parseResponseJson(response);
        errorMsg = errorData.error || errorMsg;
      } catch (e) {
        errorMsg = `Server error (${response.status}): ${response.statusText}`;
      }
      throw new Error(errorMsg);
    }

    const { text } = await parseResponseJson(response);
    if (!text) throw new Error(`AI tidak memberikan respon (kosong) untuk Kelas ${classLevel}.`);
    return safeParseJson(text);
  };

  try {
    const results = [];
    for (const cls of classLevels) {
      const res = await generateForClass(cls);
      
      // Auto-correct / Distribusi paksa bila total pertemuan di bawah 24
      if (res.items && res.items.length > 0) {
        let totalMeetings = res.items.reduce((sum: number, item: any) => sum + (item.numberOfMeetings || 0), 0);
        while (totalMeetings < 24) {
          // Tambahkan 1 pertemuan ke item secara round-robin sampai mencapai 24
          for (const item of res.items) {
            item.numberOfMeetings = (item.numberOfMeetings || 1) + 1;
            item.jp = item.numberOfMeetings * jpPerWeek;
            totalMeetings++;
            if (totalMeetings >= 24) break;
          }
        }
      }

      results.push(res);
    }
    
    const combinedItems = results.flatMap(r => r.items || []);
    const combinedRationale = results.map((r, i) => `**Kelas ${classLevels[i]}**\n${r.rationale || ''}`).join('\n\n');

    return {
      phase: mapping.phase,
      classes: mapping.classes,
      items: combinedItems,
      rationale: combinedRationale
    };
  } catch (error: any) {
    console.error("OpenAI ATP Error:", error);
    if (error.message?.includes('429') || error.message?.toLowerCase().includes('quota') || error.message?.toLowerCase().includes('limit')) {
      throw new Error(error.message);
    }
    throw new Error(error.message || "Gagal menyusun ATP. Silakan coba lagi.");
  }
}
